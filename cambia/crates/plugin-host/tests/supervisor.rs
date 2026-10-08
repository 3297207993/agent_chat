//! The supervisor against real processes.
//!
//! No fake child here on purpose: the whole point of this module is process behaviour — a handshake
//! that never comes, an exit code, a tree that has to be taken down — and a stub would prove that the
//! stub works. The backends are `node -e` one-liners and, for the happy path, the real Node SDK from
//! `examples/`, which is also what the conformance suite drives.
//!
//! If Node is missing these tests **fail with an explanation** rather than skipping: skipping is how
//! "the process layer is tested" quietly becomes untrue. Locally, skip them on purpose with
//! `cargo test -- --skip supervisor`.

use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;

use cambia_plugin_host::error_codes::ErrorCode;
use cambia_plugin_host::process::{
  BackendStatus, CommandTarget, HostInfo, RestartPolicy, SpawnSpec, StartPolicy, StopOutcome,
  Supervisor, SupervisorConfig, SupervisorEvent,
};
use tokio::sync::broadcast::error::RecvError;
use tokio::time::timeout;

fn require_node() {
  let found = Command::new("node").arg("--version").output().is_ok();
  assert!(
    found,
    "these tests drive real backends with Node; install it, or skip them with `cargo test -- --skip supervisor`"
  );
}

/// Whether a pid is still running. Used to prove that a failed start left nothing behind — the
/// requirement is about processes, so the assertion has to be about processes rather than about a
/// callback a hard kill would never run.
fn is_alive(pid: u32) -> bool {
  #[cfg(windows)]
  {
    let output = Command::new("tasklist")
      .args(["/FI", &format!("PID eq {pid}"), "/NH"])
      .output();
    match output {
      Ok(output) => String::from_utf8_lossy(&output.stdout).contains(&pid.to_string()),
      Err(_) => false,
    }
  }
  #[cfg(unix)]
  {
    Command::new("kill")
      .args(["-0", &pid.to_string()])
      .status()
      .map(|status| status.success())
      .unwrap_or(false)
  }
}

fn inline(script: &str) -> CommandTarget {
  CommandTarget::Argv(vec!["node".into(), "-e".into(), script.into()])
}

fn sdk() -> CommandTarget {
  let path =
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../examples/backend-sdk-node/backend.mjs");
  CommandTarget::Argv(vec!["node".into(), path.to_string_lossy().into_owned()])
}

fn spec(plugin: &str, target: CommandTarget) -> SpawnSpec {
  SpawnSpec {
    plugin: plugin.into(),
    plugin_version: "0.0.0-test".into(),
    target,
    root: PathBuf::from(env!("CARGO_MANIFEST_DIR")),
    host: HostInfo {
      name: "cambia-tests".into(),
      version: "0.0.0-test".into(),
    },
  }
}

fn policy(attempts: u32, start_timeout: Duration) -> StartPolicy {
  StartPolicy {
    start_timeout,
    restart: RestartPolicy {
      max_attempts: attempts,
      base_delay: Duration::from_millis(30),
      max_delay: Duration::from_millis(60),
      // Deterministic on purpose: a jittered delay makes a timing assertion a coin flip.
      jitter: false,
    },
  }
}

fn supervisor() -> Supervisor {
  Supervisor::new(SupervisorConfig {
    reclaim_timeout: Duration::from_secs(1),
    ..SupervisorConfig::default()
  })
}

#[tokio::test]
async fn start_reaches_ready_and_the_control_plane_answers() {
  require_node();
  let supervisor = supervisor();

  let backend = supervisor
    .start(spec("happy", sdk()), policy(1, Duration::from_secs(10)))
    .await
    .expect("the SDK should come up");

  assert_eq!(backend.id.plugin, "happy");
  assert_eq!(
    backend.id.generation, 1,
    "the first instance is generation 1"
  );
  assert_eq!(backend.protocol_version, 1);

  let echoed = backend
    .transport
    .call(
      "test/echo",
      serde_json::json!({ "n": 1 }),
      Duration::from_secs(5),
    )
    .await
    .expect("the control plane should answer");
  assert_eq!(echoed, serde_json::json!({ "n": 1 }));

  let outcome = supervisor.stop("happy", Duration::from_secs(5)).await;
  match outcome {
    StopOutcome::Exited(reason) => {
      assert!(reason.expected, "we asked for this exit");
      assert_eq!(
        reason.code,
        Some(0),
        "the SDK answers $/shutdown and leaves with 0"
      );
    }
    StopOutcome::NotRunning => panic!("the backend was running"),
  }
}

/// Waits for a backend to write its pid, then returns it.
async fn await_pid(marker: &std::path::Path) -> u32 {
  timeout(Duration::from_secs(5), async {
    loop {
      if let Ok(text) = std::fs::read_to_string(marker) {
        if let Ok(pid) = text.trim().parse() {
          return pid;
        }
      }
      tokio::time::sleep(Duration::from_millis(20)).await;
    }
  })
  .await
  .expect("the backend should have written its pid file")
}

#[tokio::test]
async fn a_handshake_that_never_comes_times_out_and_the_process_is_taken_down() {
  require_node();
  let supervisor = supervisor();

  let marker = std::env::temp_dir().join(format!("cambia-handshake-{}.pid", std::process::id()));
  let _ = std::fs::remove_file(&marker);

  // Reports its pid, then reads forever and never answers the handshake.
  let script = format!(
    "require('fs').writeFileSync({}, String(process.pid)); process.stdin.resume();",
    serde_json::to_string(&marker.to_string_lossy()).unwrap()
  );

  let error = supervisor
    .start(
      spec("mute", inline(&script)),
      policy(1, Duration::from_millis(300)),
    )
    .await
    .expect_err("a backend that never answers cannot be usable");

  assert_eq!(error.code, ErrorCode::ProcessStartTimeout);
  assert_eq!(error.attempts, 1);

  // The process must be gone, not merely abandoned: an orphan is exactly what this batch promises
  // never to leave behind.
  let pid = await_pid(&marker).await;
  let taken_down = timeout(Duration::from_secs(10), async {
    while is_alive(pid) {
      tokio::time::sleep(Duration::from_millis(50)).await;
    }
  })
  .await;

  assert!(
    taken_down.is_ok(),
    "the failed backend (pid {pid}) should have been taken down"
  );
  let _ = std::fs::remove_file(&marker);
}

#[tokio::test]
async fn a_backend_that_rejects_the_version_is_not_retried() {
  require_node();
  let supervisor = supervisor();

  // Answers every request with PROTOCOL_VERSION_UNSUPPORTED.
  let script = r#"
    const rl = require('readline').createInterface({ input: process.stdin });
    rl.on('line', (line) => {
      const message = JSON.parse(line);
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0',
        id: message.id,
        error: { code: -32000, message: 'nope', data: { code: 'PROTOCOL_VERSION_UNSUPPORTED' } },
      }) + '\n');
    });
  "#;

  // Three attempts are allowed, but a rejected version is deterministic: retrying only wastes them.
  let error = supervisor
    .start(
      spec("old", inline(script)),
      policy(3, Duration::from_secs(5)),
    )
    .await
    .expect_err("a version the host does not speak is not usable");

  assert_eq!(error.code, ErrorCode::ProtocolVersionUnsupported);
  assert_eq!(
    error.attempts, 1,
    "a deterministic refusal must not be retried"
  );
}

#[tokio::test]
async fn an_executable_that_does_not_exist_fails_the_start() {
  let supervisor = supervisor();

  let error = supervisor
    .start(
      spec(
        "missing",
        CommandTarget::Argv(vec!["cambia-definitely-not-a-real-program".into()]),
      ),
      policy(1, Duration::from_secs(2)),
    )
    .await
    .expect_err("nothing to run, nothing to report as ready");

  assert_eq!(error.code, ErrorCode::ProcessSpawnFailed);
}

#[tokio::test]
async fn a_crashing_backend_comes_back_in_a_new_generation_until_the_budget_is_gone() {
  require_node();
  let supervisor = supervisor();
  let mut events = supervisor.subscribe();

  // Comes up, then dies with code 7 shortly after — every time.
  let script = r#"
    const rl = require('readline').createInterface({ input: process.stdin });
    rl.on('line', (line) => {
      const message = JSON.parse(line);
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: 1 } }) + '\n');
      setTimeout(() => process.exit(7), 50);
    });
  "#;

  let started = supervisor
    .start(
      spec("crasher", inline(script)),
      policy(2, Duration::from_secs(5)),
    )
    .await
    .expect("the first instance does come up");
  assert_eq!(started.id.generation, 1);

  let mut starts = Vec::new();
  let mut exits = Vec::new();
  let mut exhausted = None;

  while exhausted.is_none() {
    match timeout(Duration::from_secs(10), events.recv()).await {
      Ok(Ok(SupervisorEvent::Started(id))) => starts.push(id.generation),
      Ok(Ok(SupervisorEvent::Exited(_, reason))) => exits.push(reason),
      Ok(Ok(SupervisorEvent::RestartExhausted { attempts, .. })) => exhausted = Some(attempts),
      Ok(Err(RecvError::Lagged(_))) => continue,
      Ok(Err(RecvError::Closed)) => break,
      Err(_) => panic!("the restart episode never reached a verdict"),
    }
  }

  // max_attempts = 2 => generations 1, 2 and 3, then the budget is spent.
  assert_eq!(starts, vec![1, 2, 3]);
  assert_eq!(exits.len(), 3, "each instance reported its own exit");
  assert!(exits.iter().all(|reason| reason.code == Some(7)));
  assert!(
    exits.iter().all(|reason| !reason.expected),
    "these were crashes"
  );
  assert_eq!(
    exhausted,
    Some(3),
    "the third failure is the one over budget"
  );
}

#[tokio::test]
async fn reclaim_all_takes_every_instance_down() {
  require_node();
  let supervisor = supervisor();

  // Comes up and then just sits there, ignoring $/shutdown.
  let script = r#"
    const rl = require('readline').createInterface({ input: process.stdin });
    rl.on('line', (line) => {
      const message = JSON.parse(line);
      if (message.method === '$/initialize') {
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: 1 } }) + '\n');
      }
    });
  "#;

  let first = supervisor
    .start(
      spec("stubborn-a", inline(script)),
      policy(1, Duration::from_secs(5)),
    )
    .await
    .expect("it comes up");
  let second = supervisor
    .start(
      spec("stubborn-b", inline(script)),
      policy(1, Duration::from_secs(5)),
    )
    .await
    .expect("it comes up too");

  supervisor.reclaim_all().await;

  for id in [&first.id, &second.id] {
    match supervisor.status(id) {
      Some(BackendStatus::Exited(reason)) => {
        assert!(reason.expected, "reclaiming is us asking, not a crash");
      }
      other => panic!("{id:?} should be gone, status is {other:?}"),
    }
  }
}

#[tokio::test]
async fn starting_an_already_running_plugin_hands_back_the_same_instance() {
  require_node();
  let supervisor = supervisor();

  let first = supervisor
    .start(spec("twice", sdk()), policy(1, Duration::from_secs(10)))
    .await
    .expect("first start");
  let second = supervisor
    .start(spec("twice", sdk()), policy(1, Duration::from_secs(10)))
    .await
    .expect("second start");

  assert_eq!(
    first.id, second.id,
    "start asks for a usable backend, not for a second process"
  );

  let _ = supervisor.stop("twice", Duration::from_secs(5)).await;
}
