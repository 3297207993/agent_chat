//! The backend supervisor: spawn, handshake, generations, exit codes, restart, reclaim.
//!
//! The normative description is `docs/design/plugin-host.md`'s "进程与控制面" and "进程" sections. Four
//! decisions from there shape every line below:
//!
//! - **The handshake is the readiness signal.** `spawn` succeeding only means an executable started;
//!   the instance is `Ready` when `$/initialize` has been answered (protocol.md §5). A supervision layer
//!   built on "the process is running" would report success for a backend that instantly exits.
//! - **Every instance has a generation**, and late exit events are dropped by generation. Without it,
//!   the exit of a process we already replaced would look like a crash of its replacement — and earn it
//!   one extra restart.
//! - **The values are the host's, the timing is ours.** `RestartPolicy` (attempts, delays) comes from
//!   TS; *when* to retry is decided here, because this is the layer that sees exec failures and exit
//!   codes, and a retry does not need a round trip through the WebView.
//! - **Nothing here asks JS for permission to clean up.** Reclaiming is a job object / process group
//!   plus a `KillOnDrop` wrapper; the `RunEvent` hook in the adapter is the other half of that belt.

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[cfg(unix)]
use process_wrap::tokio::ProcessGroup;
use process_wrap::tokio::{ChildWrapper, CommandWrap, KillOnDrop};
use tokio::process::ChildStderr;
use tokio::sync::{broadcast, mpsc, oneshot};

use crate::error_codes::ErrorCode;
use crate::protocol::PROTOCOL_VERSION;
use crate::transport::{Transport, TransportConfig};

/// The identity of one running instance: the plugin it belongs to, and which generation it is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BackendId {
  /// The plugin id from the manifest.
  pub plugin: String,
  /// Monotonic per plugin; every spawn gets a new one.
  pub generation: u64,
}

/// What to run, in the two forms kernel.md 3.3 allows.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CommandTarget {
  /// A path relative to the install root (the manifest's `bin` value was a string).
  Relative(String),
  /// An argv whose `argv[0]` is looked up in `PATH` (the manifest's value was an array).
  Argv(Vec<String>),
}

/// The host's own identity, passed through to the backend in `$/initialize`.
#[derive(Debug, Clone)]
pub struct HostInfo {
  /// Host application name.
  pub name: String,
  /// Host version.
  pub version: String,
}

/// Everything needed to start one backend.
#[derive(Debug, Clone)]
pub struct SpawnSpec {
  /// Plugin id; also the key everything is looked up by.
  pub plugin: String,
  /// The plugin's own version, for the handshake.
  pub plugin_version: String,
  /// What to run.
  pub target: CommandTarget,
  /// The install root a [`CommandTarget::Relative`] path is resolved against.
  pub root: PathBuf,
  /// Who is asking.
  pub host: HostInfo,
}

/// The host's restart policy. The values are the host's decision (docs/design/host.md); this crate
/// only *applies* them, because it is the side that sees exec failures and exit codes.
#[derive(Debug, Clone, Copy)]
pub struct RestartPolicy {
  /// How many consecutive start attempts are allowed before the episode is given up.
  pub max_attempts: u32,
  /// First backoff step; the delay doubles from there.
  pub base_delay: Duration,
  /// Ceiling for one backoff step.
  pub max_delay: Duration,
  /// Spread the delay, so a fleet of plugins that failed together does not return together.
  pub jitter: bool,
}

impl Default for RestartPolicy {
  fn default() -> Self {
    Self {
      max_attempts: 3,
      base_delay: Duration::from_millis(200),
      max_delay: Duration::from_secs(5),
      jitter: true,
    }
  }
}

/// How long a start may take, and what to do when it keeps failing.
#[derive(Debug, Clone, Copy)]
pub struct StartPolicy {
  /// One budget for exec **and** the handshake: the only question a caller has is "did it come up".
  pub start_timeout: Duration,
  /// Attempts and delays for the start itself.
  pub restart: RestartPolicy,
}

impl Default for StartPolicy {
  fn default() -> Self {
    Self {
      start_timeout: Duration::from_secs(10),
      restart: RestartPolicy::default(),
    }
  }
}

/// Supervisor-wide settings.
#[derive(Debug, Clone)]
pub struct SupervisorConfig {
  /// Transport policy handed to every instance.
  pub transport: TransportConfig,
  /// Where `stderr` files go, as `<log_dir>/<plugin>/<generation>.log`. `None` discards them — the
  /// stream is still drained, because a full pipe would block the backend.
  pub log_dir: Option<PathBuf>,
  /// How long `reclaim_all` gives one instance to leave on its own before the tree is taken down.
  pub reclaim_timeout: Duration,
}

impl Default for SupervisorConfig {
  fn default() -> Self {
    Self {
      transport: TransportConfig::default(),
      log_dir: None,
      reclaim_timeout: Duration::from_secs(2),
    }
  }
}

/// Where an instance is, as far as anyone can see from outside.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BackendStatus {
  /// Exec started or the handshake is in progress.
  Starting,
  /// `$/initialize` was answered: the only state that means "usable".
  Ready,
  /// We asked it to leave.
  Stopping,
  /// It is gone, with the reason.
  Exited(ExitReason),
}

/// Why an instance stopped.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExitReason {
  /// Which instance this is about; late reports for an older generation are ignored.
  pub generation: u64,
  /// The exit code, when there was one.
  pub code: Option<i32>,
  /// The signal, on Unix, when there was one.
  pub signal: Option<i32>,
  /// `true` when we asked for the exit — the difference between "stopped" and "crashed".
  pub expected: bool,
}

/// A usable backend, handed to the caller: the transport plus what it took to get here.
#[derive(Debug, Clone)]
pub struct Backend {
  /// Which instance this is.
  pub id: BackendId,
  /// The protocol version the peer reported during the handshake.
  pub protocol_version: u32,
  /// The control-plane transport, already past the handshake.
  pub transport: Transport,
  /// Where this instance's stderr went, when logging was configured.
  pub stderr_path: Option<PathBuf>,
}

/// A start that never reached `Ready`.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{code}: {message}")]
pub struct StartError {
  /// The spec code to report.
  pub code: ErrorCode,
  /// Human-readable detail.
  pub message: String,
  /// How many attempts were made before giving up (1 means "not retried").
  pub attempts: u32,
}

/// What a stop did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StopOutcome {
  /// The instance exited (cleanly or not — `expected` is on the reason).
  Exited(ExitReason),
  /// There was nothing running.
  NotRunning,
}

/// What the host is told about, so it can decide what to do next.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SupervisorEvent {
  /// An instance reached `Ready`.
  Started(BackendId),
  /// An instance exited. `expected` tells "we stopped it" from "it crashed".
  Exited(BackendId, ExitReason),
  /// The restart budget ran out. Whether to disable the backend permanently is the host's call.
  RestartExhausted {
    /// The plugin whose attempts ran out.
    plugin: String,
    /// How many attempts were made in the episode.
    attempts: u32,
  },
}

/// The plugin's supervisor: one task per plugin owns that plugin's process, so a crashing backend can
/// never be observed by two owners at once.
#[derive(Clone)]
pub struct Supervisor {
  inner: Arc<Inner>,
}

struct Inner {
  config: SupervisorConfig,
  plugins: Mutex<HashMap<String, mpsc::UnboundedSender<Command>>>,
  status: Mutex<HashMap<String, (u64, BackendStatus)>>,
  generations: Mutex<HashMap<String, u64>>,
  events: broadcast::Sender<SupervisorEvent>,
  sequence: AtomicU64,
}

enum Command {
  Start {
    spec: Box<SpawnSpec>,
    policy: StartPolicy,
    reply: oneshot::Sender<Result<Backend, StartError>>,
  },
  Stop {
    timeout: Duration,
    reply: oneshot::Sender<StopOutcome>,
  },
}

struct Instance {
  id: BackendId,
  transport: Transport,
  child: Box<dyn ChildWrapper>,
  stderr_path: Option<PathBuf>,
}

impl Instance {
  fn handle(&self) -> Backend {
    Backend {
      id: self.id.clone(),
      protocol_version: PROTOCOL_VERSION,
      transport: self.transport.clone(),
      stderr_path: self.stderr_path.clone(),
    }
  }
}

impl Supervisor {
  /// Create a supervisor. Nothing is spawned until [`Supervisor::start`] is called: "which plugin
  /// should run" is host policy, and policy does not live in this crate.
  pub fn new(config: SupervisorConfig) -> Self {
    let (events, _) = broadcast::channel(64);
    Self {
      inner: Arc::new(Inner {
        config,
        plugins: Mutex::new(HashMap::new()),
        status: Mutex::new(HashMap::new()),
        generations: Mutex::new(HashMap::new()),
        events,
        sequence: AtomicU64::new(0),
      }),
    }
  }

  /// Listen for lifecycle events.
  pub fn subscribe(&self) -> broadcast::Receiver<SupervisorEvent> {
    self.inner.events.subscribe()
  }

  /// Start a backend and wait until it is `Ready`, or until the start is given up on.
  ///
  /// Called while the plugin already has a running instance, it answers with that instance's handle
  /// instead of starting a second one — "start" is a request for a usable backend, not for a process.
  pub async fn start(&self, spec: SpawnSpec, policy: StartPolicy) -> Result<Backend, StartError> {
    let sender = self.sender_for(&spec.plugin);
    let (reply, answer) = oneshot::channel();

    let command = Command::Start {
      spec: Box::new(spec),
      policy,
      reply,
    };

    if sender.send(command).is_err() {
      // The task is gone (it only stops when the supervisor is dropped), so there is no honest way to
      // start anything: report it instead of pretending.
      return Err(StartError {
        code: ErrorCode::ProcessSpawnFailed,
        message: "the supervisor task for this plugin is not running".into(),
        attempts: 0,
      });
    }

    answer.await.unwrap_or_else(|_| {
      Err(StartError {
        code: ErrorCode::ProcessSpawnFailed,
        message: "the supervisor task dropped the start request".into(),
        attempts: 0,
      })
    })
  }

  /// Stop the plugin's backend, gracefully if it cooperates and by taking down the tree if it does not.
  pub async fn stop(&self, plugin: &str, timeout: Duration) -> StopOutcome {
    let sender = self.inner.plugins.lock().unwrap().get(plugin).cloned();
    let Some(sender) = sender else {
      return StopOutcome::NotRunning;
    };

    let (reply, answer) = oneshot::channel();
    if sender.send(Command::Stop { timeout, reply }).is_err() {
      return StopOutcome::NotRunning;
    }

    answer.await.unwrap_or(StopOutcome::NotRunning)
  }

  /// What the supervisor currently believes about a plugin, as a **view**: the authority is the task
  /// and, below it, the process table (docs/design/plugin-host.md).
  pub fn status(&self, id: &BackendId) -> Option<BackendStatus> {
    let status = self.inner.status.lock().unwrap();
    match status.get(&id.plugin) {
      // A report about an older generation is not this instance's status.
      Some((generation, status)) if *generation == id.generation => Some(status.clone()),
      _ => None,
    }
  }

  /// Take every instance down. This is what the adapter's exit hook calls, and it is deliberately the
  /// impatient path: the application is leaving, so a backend that will not go gets taken down.
  pub async fn reclaim_all(&self) {
    let plugins: Vec<String> = self.inner.plugins.lock().unwrap().keys().cloned().collect();
    for plugin in plugins {
      let _ = self.stop(&plugin, self.inner.config.reclaim_timeout).await;
    }
  }

  fn sender_for(&self, plugin: &str) -> mpsc::UnboundedSender<Command> {
    let mut plugins = self.inner.plugins.lock().unwrap();
    plugins
      .entry(plugin.to_string())
      .or_insert_with(|| {
        let (sender, receiver) = mpsc::unbounded_channel();
        tokio::spawn(plugin_task(
          plugin.to_string(),
          receiver,
          Arc::clone(&self.inner),
        ));
        sender
      })
      .clone()
  }
}

impl Inner {
  fn next_generation(&self, plugin: &str) -> u64 {
    let mut generations = self.generations.lock().unwrap();
    let generation = generations.entry(plugin.to_string()).or_insert(0);
    *generation += 1;
    *generation
  }

  fn set_status(&self, plugin: &str, generation: u64, status: BackendStatus) {
    self
      .status
      .lock()
      .unwrap()
      .insert(plugin.to_string(), (generation, status));
  }

  fn emit(&self, event: SupervisorEvent) {
    // A send error only means nobody is listening; the event is not the state.
    let _ = self.events.send(event);
  }

  fn stderr_path(&self, plugin: &str, generation: u64) -> Option<PathBuf> {
    self
      .config
      .log_dir
      .as_ref()
      .map(|dir| dir.join(plugin).join(format!("{generation}.log")))
  }

  /// Delay before the n-th retry: base × 2ⁿ⁻¹, capped, optionally jittered.
  fn backoff(&self, attempt: u32, policy: &RestartPolicy) -> Duration {
    let factor = 2u32.saturating_pow(attempt.saturating_sub(1));
    let delay = policy
      .base_delay
      .saturating_mul(factor)
      .min(policy.max_delay);

    if !policy.jitter {
      return delay;
    }

    // Cheap, dependency-free spread: ±25% derived from a counter, which is enough to decorrelate
    // plugins that failed together (and keeps tests deterministic by turning jitter off).
    let ticket = self.sequence.fetch_add(1, Ordering::Relaxed);
    let numerator = 75 + (ticket % 51); // 75 ..= 125
    delay.mul_f64(numerator as f64 / 100.0)
  }
}

/// One task per plugin: it owns that plugin's current instance, so the exit of one process can never be
/// observed by two owners at once.
async fn plugin_task(
  plugin: String,
  mut commands: mpsc::UnboundedReceiver<Command>,
  inner: Arc<Inner>,
) {
  let mut running: Option<Instance> = None;
  let mut episode: Option<(SpawnSpec, StartPolicy)> = None;
  let mut attempts: u32 = 0;

  loop {
    if running.is_none() {
      let Some(command) = commands.recv().await else {
        break;
      };

      match command {
        Command::Start {
          spec,
          policy,
          reply,
        } => {
          let result = start_instance(&spec, &policy, &inner).await;
          match result {
            Ok(instance) => {
              inner.set_status(&plugin, instance.id.generation, BackendStatus::Ready);
              inner.emit(SupervisorEvent::Started(instance.id.clone()));
              let handle = instance.handle();
              episode = Some((*spec, policy));
              attempts = 0;
              running = Some(instance);
              let _ = reply.send(Ok(handle));
            }
            Err(error) => {
              let _ = reply.send(Err(error));
            }
          }
        }
        Command::Stop { reply, .. } => {
          let _ = reply.send(StopOutcome::NotRunning);
        }
      }

      continue;
    }

    // An instance is running: wait for either its exit or the next command.
    let step = {
      let instance = running.as_mut().expect("checked above");
      let wait = instance.child.wait();
      tokio::pin!(wait);

      tokio::select! {
        status = &mut wait => Step::Exited(status),
        command = commands.recv() => Step::Command(command),
      }
    };

    match step {
      Step::Exited(status) => {
        let instance = running.take().expect("checked above");
        let reason = exit_reason(status.ok(), instance.id.generation, false);

        instance.transport.close();
        inner.set_status(
          &plugin,
          instance.id.generation,
          BackendStatus::Exited(reason.clone()),
        );
        inner.emit(SupervisorEvent::Exited(instance.id.clone(), reason));

        let Some((spec, policy)) = episode.clone() else {
          continue;
        };

        attempts += 1;
        if attempts > policy.restart.max_attempts {
          inner.emit(SupervisorEvent::RestartExhausted {
            plugin: plugin.clone(),
            attempts,
          });
          continue;
        }

        let delay = inner.backoff(attempts, &policy.restart);
        tokio::time::sleep(delay).await;

        match start_instance(&spec, &policy, &inner).await {
          Ok(instance) => {
            inner.set_status(&plugin, instance.id.generation, BackendStatus::Ready);
            inner.emit(SupervisorEvent::Started(instance.id.clone()));
            // `attempts` is deliberately **not** reset here: a backend that comes up and immediately
            // crashes again would otherwise restart forever, and "restart until the budget is spent"
            // would never be reachable. The budget counts restarts within one episode; an episode
            // starts when the host asks for a start and ends when the budget is spent, so a crash loop
            // ends in `RestartExhausted` and the host decides what that means.
            running = Some(instance);
          }
          Err(_) => {
            inner.emit(SupervisorEvent::RestartExhausted {
              plugin: plugin.clone(),
              attempts,
            });
          }
        }
      }

      Step::Command(Some(Command::Stop { timeout, reply })) => {
        let instance = running.take().expect("checked above");
        inner.set_status(&plugin, instance.id.generation, BackendStatus::Stopping);
        let outcome = stop_instance(instance, timeout).await;
        if let StopOutcome::Exited(reason) = &outcome {
          inner.set_status(
            &plugin,
            reason.generation,
            BackendStatus::Exited(reason.clone()),
          );
        }
        // An explicit stop ends the episode: nothing restarts behind the caller's back.
        episode = None;
        attempts = 0;
        let _ = reply.send(outcome);
      }

      Step::Command(Some(Command::Start {
        spec,
        policy,
        reply,
      })) => {
        // Already running: "start" asked for a usable backend, and there is one.
        let handle = running.as_ref().expect("checked above").handle();
        episode = Some((*spec, policy));
        let _ = reply.send(Ok(handle));
      }

      Step::Command(None) => break,
    }
  }
}

enum Step {
  Exited(std::io::Result<std::process::ExitStatus>),
  Command(Option<Command>),
}

/// Start an instance and wait for the handshake, retrying per policy.
///
/// A rejected protocol version is *not* retried: it is a deterministic answer, and hammering a backend
/// that just said "I cannot speak this" only wastes the budget (docs/design/plugin-host.md's failure
/// table).
async fn start_instance(
  spec: &SpawnSpec,
  policy: &StartPolicy,
  inner: &Arc<Inner>,
) -> Result<Instance, StartError> {
  let mut attempts = 0;

  loop {
    attempts += 1;

    match spawn_once(spec, policy, inner).await {
      Ok(instance) => return Ok(instance),
      Err(error) => {
        let deterministic = error.code == ErrorCode::ProtocolVersionUnsupported;
        if deterministic || attempts >= policy.restart.max_attempts.max(1) {
          return Err(StartError { attempts, ..error });
        }

        tokio::time::sleep(inner.backoff(attempts, &policy.restart)).await;
      }
    }
  }
}

async fn spawn_once(
  spec: &SpawnSpec,
  policy: &StartPolicy,
  inner: &Arc<Inner>,
) -> Result<Instance, StartError> {
  let (program, args) = resolve_command(spec)?;
  let generation = inner.next_generation(&spec.plugin);

  inner.set_status(&spec.plugin, generation, BackendStatus::Starting);

  let mut command = CommandWrap::with_new(&program, |command| {
    command
      .args(&args)
      .stdin(Stdio::piped())
      .stdout(Stdio::piped())
      .stderr(Stdio::piped());
  });

  // The tree, not just the process: a backend may start children of its own, and only the OS can be
  // trusted to collect them (implementation.md 3.3(e), fact 9).
  #[cfg(windows)]
  command.wrap(process_wrap::tokio::JobObject);
  #[cfg(unix)]
  command.wrap(ProcessGroup::leader());
  // Makes the job object fatal-on-close, which is the half of "no orphans" that survives our own exit
  // hook never running.
  command.wrap(KillOnDrop);

  let mut child = command.spawn().map_err(|error| StartError {
    code: ErrorCode::ProcessSpawnFailed,
    message: format!("could not start {program:?}: {error}"),
    attempts: 0,
  })?;

  let stderr_path = inner.stderr_path(&spec.plugin, generation);
  let stderr = child.stderr().take();
  if let Some(stderr) = stderr {
    tokio::spawn(drain_stderr(stderr, stderr_path.clone()));
  }

  // The transport wants owned halves; a missing pipe would mean the child was not set up as asked.
  let (Some(stdout), Some(stdin)) = (child.stdout().take(), child.stdin().take()) else {
    kill_tree(&mut child).await;
    return Err(StartError {
      code: ErrorCode::ProcessSpawnFailed,
      message: "the child has no stdio pipes, so no control plane can exist".into(),
      attempts: 0,
    });
  };

  let transport = Transport::new(stdout, stdin, inner.config.transport);

  let handshake = serde_json::json!({
    "protocolVersion": PROTOCOL_VERSION,
    "plugin": { "id": spec.plugin, "version": spec.plugin_version },
    "host": { "name": spec.host.name, "version": spec.host.version },
  });

  match transport.initialize(handshake, policy.start_timeout).await {
    Ok(answer) => {
      let reported = answer
        .get("protocolVersion")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0);

      // A peer that answers with a version this host does not speak is not usable, even though it is
      // alive: disable rather than guess, the same way an unknown `bin` platform key is handled.
      if reported != u64::from(PROTOCOL_VERSION) {
        kill_tree(&mut child).await;
        transport.close();

        return Err(StartError {
          code: ErrorCode::ProtocolVersionUnsupported,
          message: format!("the peer answered with protocol version {reported}"),
          attempts: 0,
        });
      }

      Ok(Instance {
        id: BackendId {
          plugin: spec.plugin.clone(),
          generation,
        },
        transport,
        child,
        stderr_path,
      })
    }
    Err(error) => {
      // The handshake failed, so this process has no owner: take it down rather than leave a stray
      // backend that never joined the control plane.
      kill_tree(&mut child).await;
      transport.close();

      // A handshake that did not finish is a **start** failure, not a slow method call: the question
      // the caller asked was "did it come up" (docs/design/plugin-host.md's failure table separates the
      // two codes for exactly this reason). Other transport verdicts — the peer vanished mid-handshake,
      // for instance — keep their own code.
      let code = if error.code == ErrorCode::ProtocolCallTimeout {
        ErrorCode::ProcessStartTimeout
      } else {
        error.code
      };

      Err(StartError {
        code,
        message: error.message,
        attempts: 0,
      })
    }
  }
}

async fn stop_instance(instance: Instance, timeout: Duration) -> StopOutcome {
  let Instance {
    id,
    transport,
    mut child,
    ..
  } = instance;

  // Ask nicely first: a backend that answers `$/shutdown` can flush and close its own files.
  let graceful = timeout.min(Duration::from_secs(5));
  let _ = transport.shutdown(graceful).await;

  let status = match tokio::time::timeout(timeout, child.wait()).await {
    Ok(status) => status.ok(),
    Err(_) => {
      // Nothing came back in time, so the tree goes down the hard way — still the whole tree.
      kill_tree(&mut child).await;
      child.try_wait().ok().flatten()
    }
  };

  transport.close();
  StopOutcome::Exited(exit_reason(status, id.generation, true))
}

fn resolve_command(spec: &SpawnSpec) -> Result<(PathBuf, Vec<String>), StartError> {
  match &spec.target {
    CommandTarget::Relative(path) => {
      let resolved = spec.root.join(path);

      // The manifest layer already rejects escapes (K2.1); this is the guard at the point where a
      // path becomes a process, and `join` with an absolute path would silently replace the root.
      if !resolved.starts_with(&spec.root) {
        return Err(StartError {
          code: ErrorCode::ManifestPathEscape,
          message: format!("\"{path}\" resolves outside the install root"),
          attempts: 0,
        });
      }

      Ok((resolved, Vec::new()))
    }
    CommandTarget::Argv(argv) => match argv.split_first() {
      Some((program, args)) => Ok((PathBuf::from(program), args.to_vec())),
      None => Err(StartError {
        code: ErrorCode::ProcessSpawnFailed,
        message: "the argv form needs at least a program name".into(),
        attempts: 0,
      }),
    },
  }
}

fn exit_reason(
  status: Option<std::process::ExitStatus>,
  generation: u64,
  expected: bool,
) -> ExitReason {
  #[cfg(unix)]
  let signal = status.and_then(|status| std::os::unix::process::ExitStatusExt::signal(&status));
  #[cfg(not(unix))]
  let signal = None;

  ExitReason {
    generation,
    code: status.and_then(|status| status.code()),
    signal,
    expected,
  }
}

/// Take the whole process tree down and wait for it.
///
/// The wrappers hand back boxed futures, which cannot be awaited directly — `Box<dyn Future>` has no
/// `Future` impl of its own (the impl needs `Unpin`). `Box::into_pin` is the one conversion that gives
/// a future which can be awaited.
async fn kill_tree(child: &mut Box<dyn ChildWrapper>) {
  let _ = Box::into_pin(child.kill()).await;
}

/// Drain the backend's stderr into its log file.
///
/// Always draining matters even when nothing is logged: a backend that writes more than the pipe holds
/// would block forever on a full buffer, and we would be the ones not reading it.
async fn drain_stderr(stderr: ChildStderr, path: Option<PathBuf>) {
  let mut stderr = stderr;

  let Some(path) = path else {
    let _ = tokio::io::copy(&mut stderr, &mut tokio::io::sink()).await;
    return;
  };

  if let Some(dir) = path.parent() {
    let _ = tokio::fs::create_dir_all(dir).await;
  }

  match tokio::fs::File::create(&path).await {
    Ok(mut file) => {
      let _ = tokio::io::copy(&mut stderr, &mut file).await;
    }
    Err(_) => {
      let _ = tokio::io::copy(&mut stderr, &mut tokio::io::sink()).await;
    }
  }
}
