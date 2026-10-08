//! The two-sided conformance suite: **one set of assertions, driven against both SDKs**.
//!
//! The acceptance criterion is "two languages, same verdicts" (plan.md's K2.6 row). The way to make
//! that mean something is not to run two suites and compare reports — it is to run *this* function
//! twice, once per backend, so "the same" is mechanical: identical assertions, identical expectations.
//!
//! A missing interpreter fails the test with an explanation instead of skipping it. Skipping is how
//! "the protocol is implementable in a second language" quietly becomes a claim nobody checks; if you
//! genuinely cannot install Python, skip deliberately with `cargo test -- --skip protocol`.

use std::path::PathBuf;
use std::process::Command;
use std::sync::Arc;
use std::time::Duration;

use cambia_plugin_host::error_codes::ErrorCode;
use cambia_plugin_host::process::{
  CommandTarget, HostInfo, RestartPolicy, SpawnSpec, StartPolicy, StopOutcome, Supervisor,
  SupervisorConfig,
};
use cambia_plugin_host::protocol::ErrorObject;
use cambia_plugin_host::transport::Dispatch;

/// Runs the interpreter for real. A Windows Store stub for `python3` starts, prints nothing and exits,
/// so "the binary exists" is not a strong enough check — the probe runs code and looks for its output.
fn runs_code(program: &str, probe_args: &[&str]) -> bool {
  Command::new(program)
    .args(probe_args)
    .output()
    .map(|output| String::from_utf8_lossy(&output.stdout).contains("ok"))
    .unwrap_or(false)
}

const NODE_PROBE: &[&str] = &["-e", "process.stdout.write('ok')"];
const PYTHON_PROBE: &[&str] = &["-c", "print('ok')"];

fn node_program() -> String {
  assert!(
    runs_code("node", NODE_PROBE),
    "the conformance suite drives the Node SDK; install Node, or skip it with `cargo test -- --skip protocol`"
  );

  "node".into()
}

fn python_program() -> String {
  for candidate in ["python3", "python"] {
    if runs_code(candidate, PYTHON_PROBE) {
      return candidate.into();
    }
  }

  panic!("the conformance suite drives the Python SDK; install Python, or skip it with `cargo test -- --skip protocol`");
}

fn sdk(program: &str, file: &str) -> CommandTarget {
  let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
    .join("../../examples")
    .join(file);

  CommandTarget::Argv(vec![program.into(), path.to_string_lossy().into_owned()])
}

fn spec(target: CommandTarget) -> SpawnSpec {
  SpawnSpec {
    plugin: "conformance".into(),
    plugin_version: "0.0.0-test".into(),
    target,
    root: PathBuf::from(env!("CARGO_MANIFEST_DIR")),
    host: HostInfo {
      name: "cambia-tests".into(),
      version: "0.0.0-test".into(),
    },
  }
}

fn policy() -> StartPolicy {
  StartPolicy {
    start_timeout: Duration::from_secs(10),
    restart: RestartPolicy {
      max_attempts: 1,
      base_delay: Duration::from_millis(30),
      max_delay: Duration::from_millis(60),
      jitter: false,
    },
  }
}

/// Everything both SDKs must agree on. Called once per language.
async fn conformance(target: CommandTarget, language: &str) {
  let supervisor = Supervisor::new(SupervisorConfig::default());

  // The handshake is the start: reaching this line means `$/initialize` was answered (protocol.md §5).
  let backend = supervisor
    .start(spec(target), policy())
    .await
    .unwrap_or_else(|error| panic!("the {language} SDK did not come up: {error}"));
  assert_eq!(backend.protocol_version, 1, "{language}");

  // The host's routing table. One method, answering with whatever it was given.
  backend.transport.set_dispatch(Dispatch {
    request: Arc::new(|method, params| {
      Box::pin(async move {
        if method == "host/echo" {
          Ok(params)
        } else {
          Err(ErrorObject::from_code(
            ErrorCode::ProtocolMethodNotFound,
            format!("this host routes no method named \"{method}\""),
          ))
        }
      })
    }),
    notification: Arc::new(|_, _| {}),
  });

  // 1. host → backend.
  let echoed = backend
    .transport
    .call(
      "test/echo",
      serde_json::json!({ "round": 1 }),
      Duration::from_secs(5),
    )
    .await
    .unwrap_or_else(|error| panic!("{language}: test/echo failed: {error}"));
  assert_eq!(echoed, serde_json::json!({ "round": 1 }), "{language}");

  // 2. A method nobody implements: the peer's own code travels back, unwrapped.
  let unknown = backend
    .transport
    .call(
      "no/such/method",
      serde_json::Value::Null,
      Duration::from_secs(5),
    )
    .await
    .expect_err("the peer should refuse a method it does not have");
  assert_eq!(
    unknown.code,
    ErrorCode::ProtocolMethodNotFound,
    "{language}"
  );
  assert_eq!(
    unknown.remote.and_then(|error| error.known_code()),
    Some(ErrorCode::ProtocolMethodNotFound),
    "{language}: the peer's own data.code must survive the trip"
  );

  // 3. backend → host: the SDK calls `host/echo` and hands the answer back.
  let reversed = backend
    .transport
    .call(
      "test/call-host",
      serde_json::json!({ "round": 2 }),
      Duration::from_secs(5),
    )
    .await
    .unwrap_or_else(|error| panic!("{language}: the reverse call failed: {error}"));
  assert_eq!(reversed, serde_json::json!({ "round": 2 }), "{language}");

  // 4. A call nobody answers times out — and the process is untouched, which the next call proves.
  let timed_out = backend
    .transport
    .call(
      "test/hang",
      serde_json::Value::Null,
      Duration::from_millis(200),
    )
    .await
    .expect_err("a silent peer cannot answer");
  assert_eq!(timed_out.code, ErrorCode::ProtocolCallTimeout, "{language}");

  let alive = backend
    .transport
    .call(
      "test/echo",
      serde_json::json!("still here"),
      Duration::from_secs(5),
    )
    .await
    .unwrap_or_else(|error| panic!("{language}: a timeout must not kill the process: {error}"));
  assert_eq!(alive, serde_json::json!("still here"), "{language}");

  // 5. A graceful stop is an expected exit with code 0.
  match supervisor.stop("conformance", Duration::from_secs(5)).await {
    StopOutcome::Exited(reason) => {
      assert!(reason.expected, "{language}: we asked for this exit");
      assert_eq!(
        reason.code,
        Some(0),
        "{language}: the SDK answers $/shutdown and leaves with 0"
      );
    }
    StopOutcome::NotRunning => panic!("{language}: the backend was running"),
  }
}

#[tokio::test]
async fn the_node_sdk_conforms() {
  let program = node_program();
  conformance(sdk(&program, "backend-sdk-node/backend.mjs"), "node").await;
}

#[tokio::test]
async fn the_python_sdk_conforms() {
  let program = python_program();
  conformance(sdk(&program, "backend-sdk-python/backend.py"), "python").await;
}
