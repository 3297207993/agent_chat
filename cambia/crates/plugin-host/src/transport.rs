//! The control plane's transport: frames in, frames out, and the bookkeeping the protocol demands.
//!
//! This is the layer `docs/design/plugin-host.md` decided must live here rather than in TS — the frame
//! loop, the **outbound** id table, the timeout and the cancellation. The reason is a queue that cannot
//! be removed from the design: a frontend plugin that spins blocks the JS main thread, and a timer
//! living there would stop being punctual exactly when a backend is waiting on it. Routing is
//! deliberately *not* here: method names belong to the host (kernel.md 1.9), so an inbound request is
//! handed over untouched and its answer is written back with the id the peer chose.
//!
//! Shape: one reader task, one writer task, and a `Transport` that is cheap to clone. The reader task
//! is detached on purpose — it ends at EOF or on a frame that cannot be trusted, and the supervisor
//! guarantees the process dies, which guarantees the EOF. The writer task owns the child's stdin, so
//! closing it is what makes the backend see "the host does not want you any more" (protocol.md §8).

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::sync::{mpsc, oneshot};
use tokio::time::Instant;

use crate::error_codes::ErrorCode;
use crate::protocol::{
  self, cancel_params, cancelled_id, ErrorObject, FrameError, Id, Message, METHOD_CANCEL,
  METHOD_INITIALIZE, METHOD_SHUTDOWN,
};

/// What an inbound request is answered with. `Err` becomes an error frame the peer can read.
pub type InboundResult = Result<serde_json::Value, ErrorObject>;

/// The future an inbound request is answered with.
pub type InboundFuture = Pin<Box<dyn Future<Output = InboundResult> + Send>>;

/// What the host does with what the backend says.
///
/// The defaults are the protocol's own answers: every request gets `PROTOCOL_METHOD_NOT_FOUND` (nobody
/// routes it yet) and notifications are ignored. `$/cancel` never reaches this — the transport handles
/// it, because it is about this transport's own id table.
#[derive(Clone)]
pub struct Dispatch {
  /// Answers a request from the backend. The method name arrives exactly as it was sent.
  pub request: Arc<dyn Fn(String, serde_json::Value) -> InboundFuture + Send + Sync>,
  /// Observes a notification from the backend.
  pub notification: Arc<dyn Fn(String, serde_json::Value) + Send + Sync>,
}

impl Default for Dispatch {
  fn default() -> Self {
    Self {
      request: Arc::new(|method, _| {
        Box::pin(async move {
          Err(ErrorObject::from_code(
            ErrorCode::ProtocolMethodNotFound,
            format!("this host routes no method named \"{method}\""),
          ))
        })
      }),
      notification: Arc::new(|_, _| {}),
    }
  }
}

/// Failure of one call, as the caller sees it.
#[derive(Debug, Clone, PartialEq)]
pub struct CallError {
  /// The spec code to report. A remote error whose code this version does not know becomes
  /// `PROTOCOL_INTERNAL_ERROR`; `remote` still carries the original object verbatim.
  pub code: ErrorCode,
  /// Human-readable detail.
  pub message: String,
  /// Set when the peer answered with an error frame.
  pub remote: Option<ErrorObject>,
}

impl CallError {
  fn local(code: ErrorCode, message: impl Into<String>) -> Self {
    Self {
      code,
      message: message.into(),
      remote: None,
    }
  }

  fn from_remote(error: ErrorObject) -> Self {
    Self {
      code: error
        .known_code()
        .unwrap_or(ErrorCode::ProtocolInternalError),
      message: error.message.clone(),
      remote: Some(error),
    }
  }
}

impl std::fmt::Display for CallError {
  fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    write!(formatter, "{}: {}", self.code, self.message)
  }
}

impl std::error::Error for CallError {}

/// Transport policy. The values are the host's (docs/design/host.md); this type only carries them.
#[derive(Debug, Clone, Copy)]
pub struct TransportConfig {
  /// In-flight outbound requests allowed before a call fails at once (protocol.md §9).
  pub max_in_flight: usize,
  /// Capacity of the write queue. Bounded on purpose: a slow pipe must push back on the caller
  /// instead of growing a queue nobody measured.
  pub write_queue: usize,
}

impl Default for TransportConfig {
  fn default() -> Self {
    Self {
      max_in_flight: 64,
      write_queue: 64,
    }
  }
}

/// One thing to do on the write side. `Close` is how the stdin gets closed promptly: the sender alone
/// cannot do it, because the reader task keeps the channel alive for its own answers.
enum WriteCommand {
  Line(String),
  Close,
}

type Pending = HashMap<Id, oneshot::Sender<Result<serde_json::Value, CallError>>>;

struct Inner {
  config: TransportConfig,
  to_writer: mpsc::Sender<WriteCommand>,
  pending: Mutex<Pending>,
  next_id: AtomicI64,
  closed: Mutex<Option<ErrorCode>>,
  dispatch: Mutex<Dispatch>,
}

/// The control-plane transport for one backend process.
pub struct Transport {
  inner: Arc<Inner>,
}

impl std::fmt::Debug for Transport {
  /// Prints what is worth knowing about a transport: whether it still has a peer.
  fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    formatter
      .debug_struct("Transport")
      .field("closed", &self.closed_code())
      .finish_non_exhaustive()
  }
}

impl Clone for Transport {
  fn clone(&self) -> Self {
    Self {
      inner: Arc::clone(&self.inner),
    }
  }
}

impl Transport {
  /// Start the two tasks over an already-connected pair of streams.
  ///
  /// `reader` is the child's stdout and `writer` its stdin; the supervisor does the splitting.
  pub fn new<R, W>(reader: R, writer: W, config: TransportConfig) -> Self
  where
    R: AsyncRead + Send + Unpin + 'static,
    W: AsyncWrite + Send + Unpin + 'static,
  {
    let (to_writer, mut commands) = mpsc::channel::<WriteCommand>(config.write_queue);

    tokio::spawn(async move {
      let mut writer = writer;
      while let Some(command) = commands.recv().await {
        let line = match command {
          WriteCommand::Line(line) => line,
          WriteCommand::Close => break,
        };

        let mut bytes = line.into_bytes();
        bytes.push(b'\n');
        if writer.write_all(&bytes).await.is_err() {
          break;
        }
      }
      // Dropping `writer` here is the point: the backend sees stdin reach EOF.
      let _ = writer.shutdown().await;
    });

    let inner = Arc::new(Inner {
      config,
      to_writer,
      pending: Mutex::new(Pending::new()),
      next_id: AtomicI64::new(1),
      closed: Mutex::new(None),
      dispatch: Mutex::new(Dispatch::default()),
    });

    tokio::spawn(read_loop(reader, Arc::clone(&inner)));

    Self { inner }
  }

  /// Install what the host wants done with inbound requests and notifications.
  pub fn set_dispatch(&self, dispatch: Dispatch) {
    *self.inner.dispatch.lock().unwrap() = dispatch;
  }

  /// Ask the peer something and wait for its answer.
  ///
  /// `timeout` is required and never defaulted here: two defaults is how "who owns the timeout" turns
  /// into a bug (protocol.md §7). The clock starts **before the frame is queued**, so a peer that never
  /// answers and a pipe that never drains are covered by the same deadline. Timing out does not touch
  /// the process: it cancels the request and reports the failure.
  pub async fn call(
    &self,
    method: &str,
    params: serde_json::Value,
    timeout: Duration,
  ) -> Result<serde_json::Value, CallError> {
    if let Some(code) = self.closed_code() {
      return Err(CallError::local(
        code,
        "the transport is closed; the peer is gone",
      ));
    }

    let (sender, receiver) = oneshot::channel();
    let id = {
      let mut pending = self.inner.pending.lock().unwrap();
      if pending.len() >= self.inner.config.max_in_flight {
        return Err(CallError::local(
          ErrorCode::ProtocolTooManyInFlight,
          format!("{} requests are already in flight", pending.len()),
        ));
      }

      let id = Id::Number(self.inner.next_id.fetch_add(1, Ordering::SeqCst));
      pending.insert(id.clone(), sender);
      id
    };

    let request = Message::Request {
      id: id.clone(),
      method: method.to_string(),
      params,
    };

    let deadline = Instant::now() + timeout;
    let outcome = tokio::time::timeout_at(deadline, async {
      self.send(request).await?;
      match receiver.await {
        Ok(answer) => answer,
        // The sender is dropped when the reader loop ends, or when the id is cancelled.
        Err(_) => Err(CallError::local(
          ErrorCode::ProcessExited,
          "the transport closed while this request was in flight",
        )),
      }
    })
    .await;

    match outcome {
      Ok(answer) => answer,
      Err(_elapsed) => {
        self.inner.pending.lock().unwrap().remove(&id);
        // Best effort: a peer that is already gone does not need to hear about it.
        let cancel = Message::Notification {
          method: METHOD_CANCEL.to_string(),
          params: cancel_params(&id),
        };
        let _ = self.send(cancel).await;

        Err(CallError::local(
          ErrorCode::ProtocolCallTimeout,
          format!("\"{method}\" did not answer within {timeout:?}"),
        ))
      }
    }
  }

  /// Send a notification. Nothing is expected back, so there is nothing to wait for.
  pub async fn notify(&self, method: &str, params: serde_json::Value) -> Result<(), CallError> {
    self
      .send(Message::Notification {
        method: method.to_string(),
        params,
      })
      .await
  }

  /// The handshake. Its round trip **is** the readiness signal (protocol.md §5).
  pub async fn initialize(
    &self,
    params: serde_json::Value,
    timeout: Duration,
  ) -> Result<serde_json::Value, CallError> {
    self.call(METHOD_INITIALIZE, params, timeout).await
  }

  /// The graceful shutdown request. What to do when the peer stays silent is the caller's decision.
  pub async fn shutdown(&self, timeout: Duration) -> Result<(), CallError> {
    self
      .call(METHOD_SHUTDOWN, serde_json::Value::Null, timeout)
      .await
      .map(|_| ())
  }

  /// Close the write side: the backend sees EOF and should exit on its own (protocol.md §8).
  pub fn close(&self) {
    self.close_with(ErrorCode::ProcessExited);
    let _ = self.inner.to_writer.try_send(WriteCommand::Close);
  }

  /// Why the transport lost its peer, if it did.
  pub fn closed_code(&self) -> Option<ErrorCode> {
    *self.inner.closed.lock().unwrap()
  }

  async fn send(&self, message: Message) -> Result<(), CallError> {
    if let Some(code) = self.closed_code() {
      return Err(CallError::local(
        code,
        "the transport is closed; the peer is gone",
      ));
    }

    let line = message
      .to_line()
      .map_err(|error: FrameError| CallError::local(error.code, error.message))?;

    self
      .inner
      .to_writer
      .send(WriteCommand::Line(line))
      .await
      .map_err(|_| CallError::local(ErrorCode::ProcessExited, "the write side is gone"))
  }

  /// Mark the transport closed and fail everything still waiting. The first reason wins: the first
  /// thing that went wrong is the one worth reporting.
  fn close_with(&self, code: ErrorCode) {
    let first = self.inner.closed.lock().unwrap().replace(code).is_none();
    if !first {
      return;
    }

    let pending = std::mem::take(&mut *self.inner.pending.lock().unwrap());
    for (_, sender) in pending {
      let _ = sender.send(Err(CallError::local(
        code,
        "the transport closed with this request in flight",
      )));
    }
  }
}

async fn read_loop<R>(reader: R, inner: Arc<Inner>)
where
  R: AsyncRead + Send + Unpin + 'static,
{
  let mut reader = BufReader::new(reader);
  let mut frame: Vec<u8> = Vec::new();

  loop {
    match read_frame(&mut reader, &mut frame).await {
      Ok(Some(line)) => {
        if let Err(error) = handle_line(&line, &inner).await {
          // An unparseable frame ends the conversation (protocol.md §8): the stream can no longer be
          // trusted, and continuing would mean guessing where the next message starts.
          close(&inner, error.code);
          return;
        }
      }
      // EOF: as far as this channel is concerned, the process is gone.
      Ok(None) => {
        close(&inner, ErrorCode::ProcessExited);
        return;
      }
      Err(error) => {
        close(&inner, error.code);
        return;
      }
    }
  }
}

fn close(inner: &Arc<Inner>, code: ErrorCode) {
  let first = inner.closed.lock().unwrap().replace(code).is_none();
  if !first {
    return;
  }

  let pending = std::mem::take(&mut *inner.pending.lock().unwrap());
  for (_, sender) in pending {
    let _ = sender.send(Err(CallError::local(
      code,
      "the peer went away with this request in flight",
    )));
  }
}

/// Read one `\n`-terminated frame, refusing anything over the cap.
///
/// The cap is enforced **while** reading instead of after: `read_line` would happily buffer a gigabyte
/// of "one line" before anyone could object (protocol.md §1).
async fn read_frame<R>(
  reader: &mut BufReader<R>,
  frame: &mut Vec<u8>,
) -> Result<Option<String>, FrameError>
where
  R: AsyncRead + Unpin,
{
  frame.clear();

  loop {
    let available = reader.fill_buf().await.map_err(|error| FrameError {
      code: ErrorCode::ProcessExited,
      message: error.to_string(),
    })?;

    if available.is_empty() {
      return Ok(None);
    }

    let newline = available.iter().position(|byte| *byte == b'\n');
    let take = newline.unwrap_or(available.len());

    if frame.len() + take > protocol::MAX_FRAME_BYTES {
      return Err(FrameError {
        code: ErrorCode::ProtocolFrameTooLarge,
        message: format!("a frame exceeded {} bytes", protocol::MAX_FRAME_BYTES),
      });
    }

    frame.extend_from_slice(&available[..take]);
    reader.consume(take + usize::from(newline.is_some()));

    if newline.is_some() {
      break;
    }
  }

  // `\r\n` is legal (protocol.md §1), so the trailing carriage return goes before parsing.
  let text = String::from_utf8_lossy(frame);
  Ok(Some(text.trim_end_matches('\r').to_string()))
}

async fn handle_line(line: &str, inner: &Arc<Inner>) -> Result<(), FrameError> {
  // Blank lines carry nothing (protocol.md §1).
  if line.trim().is_empty() {
    return Ok(());
  }

  match Message::parse(line)? {
    Message::Response { id, result } => {
      // A missing id is dropped on purpose. It answers something already cancelled or timed out, and
      // treating it as a protocol error would kill a healthy connection (protocol.md §3).
      if let Some(sender) = inner.pending.lock().unwrap().remove(&id) {
        let answer = match result {
          Ok(value) => Ok(value),
          Err(error) => Err(CallError::from_remote(error)),
        };
        let _ = sender.send(answer);
      }

      Ok(())
    }

    Message::Notification { method, params } => {
      if method == METHOD_CANCEL {
        if let Some(id) = cancelled_id(&params) {
          if let Some(sender) = inner.pending.lock().unwrap().remove(&id) {
            let _ = sender.send(Err(CallError::local(
              ErrorCode::ProtocolCancelled,
              "the peer cancelled this request",
            )));
          }
        }

        return Ok(());
      }

      let dispatch = inner.dispatch.lock().unwrap().clone();
      (dispatch.notification)(method, params);
      Ok(())
    }

    Message::Request { id, method, params } => {
      let dispatch = inner.dispatch.lock().unwrap().clone();
      let inner = Arc::clone(inner);

      tokio::spawn(async move {
        let result = (dispatch.request)(method, params).await;

        // A response too large to send is reported as an error frame rather than dropped: the peer
        // must learn why it is not getting an answer. If even that frame cannot be built, the line
        // goes out empty — and a blank line is defined to carry nothing (protocol.md §1), so the
        // connection stays parseable.
        let line = match (Message::Response {
          id: id.clone(),
          result,
        })
        .to_line()
        {
          Ok(line) => line,
          Err(error) => Message::Response {
            id,
            result: Err(ErrorObject::from_code(error.code, error.message)),
          }
          .to_line()
          .unwrap_or_default(),
        };

        let _ = inner.to_writer.send(WriteCommand::Line(line)).await;
      });

      Ok(())
    }
  }
}

/// The method names this protocol reserves. Exported so a host can tell "a method the protocol owns"
/// from "a method of mine" without hard-coding strings.
pub const RESERVED_METHODS: [&str; 3] = [METHOD_INITIALIZE, METHOD_SHUTDOWN, METHOD_CANCEL];

#[cfg(test)]
mod tests {
  use super::*;

  use std::sync::atomic::AtomicUsize;
  use tokio::io::{AsyncReadExt, DuplexStream, ReadHalf, WriteHalf};
  use tokio::time::timeout as deadline;

  /// Both ends of one pipe, with the transport driving one side.
  struct Pipe {
    transport: Transport,
    peer_in: WriteHalf<DuplexStream>,
    peer_out: BufReader<ReadHalf<DuplexStream>>,
  }

  fn pipe_with(config: TransportConfig) -> Pipe {
    let (transport_side, peer_side) = tokio::io::duplex(64 * 1024);
    let (transport_read, transport_write) = tokio::io::split(transport_side);
    let (peer_read, peer_write) = tokio::io::split(peer_side);

    Pipe {
      transport: Transport::new(transport_read, transport_write, config),
      peer_in: peer_write,
      peer_out: BufReader::new(peer_read),
    }
  }

  fn pipe() -> Pipe {
    pipe_with(TransportConfig::default())
  }

  impl Pipe {
    async fn write(&mut self, message: &Message) {
      let mut bytes = message.to_line().unwrap().into_bytes();
      bytes.push(b'\n');
      self.peer_in.write_all(&bytes).await.unwrap();
    }

    async fn read(&mut self) -> Message {
      let mut line = String::new();
      deadline(Duration::from_secs(5), self.peer_out.read_line(&mut line))
        .await
        .expect("the transport should have written something")
        .unwrap();
      Message::parse(line.trim_end()).expect("the transport writes parseable frames")
    }

    async fn read_request(&mut self) -> (Id, String) {
      match self.read().await {
        Message::Request { id, method, .. } => (id, method),
        other => panic!("expected a request, got {other:?}"),
      }
    }
  }

  #[tokio::test]
  async fn a_call_is_answered_by_the_peer() {
    let mut pipe = pipe();

    let call = {
      let transport = pipe.transport.clone();
      tokio::spawn(async move {
        transport
          .call(
            "test/echo",
            serde_json::json!({ "n": 1 }),
            Duration::from_secs(5),
          )
          .await
      })
    };

    let (id, method) = pipe.read_request().await;
    assert_eq!(method, "test/echo");
    assert_eq!(id, Id::Number(1), "the transport allocates its own ids");

    pipe
      .write(&Message::Response {
        id,
        result: Ok(serde_json::json!({ "ok": true })),
      })
      .await;

    assert_eq!(
      call.await.unwrap().unwrap(),
      serde_json::json!({ "ok": true })
    );
  }

  #[tokio::test]
  async fn a_slow_peer_gets_a_cancel_and_not_a_kill() {
    let mut pipe = pipe();

    let error = pipe
      .transport
      .call(
        "test/never",
        serde_json::Value::Null,
        Duration::from_millis(50),
      )
      .await
      .unwrap_err();

    assert_eq!(error.code, ErrorCode::ProtocolCallTimeout);
    assert_eq!(
      pipe.transport.closed_code(),
      None,
      "a timeout must not touch the process"
    );

    let (_, method) = pipe.read_request().await;
    assert_eq!(method, "test/never");

    let cancel = match pipe.read().await {
      Message::Notification { method, .. } => method,
      other => panic!("expected the cancel notification, got {other:?}"),
    };
    assert_eq!(cancel, METHOD_CANCEL);
  }

  #[tokio::test]
  async fn an_answer_to_an_unknown_id_is_dropped_and_the_connection_survives() {
    let mut pipe = pipe();

    let call = {
      let transport = pipe.transport.clone();
      tokio::spawn(async move {
        transport
          .call("test/echo", serde_json::Value::Null, Duration::from_secs(5))
          .await
      })
    };

    // The late answer belongs to nobody, so it must be ignored rather than kill the link.
    pipe
      .write(&Message::Response {
        id: Id::Number(9999),
        result: Ok(serde_json::json!("too late")),
      })
      .await;

    let (id, _) = pipe.read_request().await;
    pipe
      .write(&Message::Response {
        id,
        result: Ok(serde_json::json!("right on time")),
      })
      .await;

    assert_eq!(
      call.await.unwrap().unwrap(),
      serde_json::json!("right on time")
    );
    assert_eq!(pipe.transport.closed_code(), None);
  }

  #[tokio::test]
  async fn a_cancel_from_the_peer_fails_the_pending_call_with_cancelled() {
    let mut pipe = pipe();

    let call = {
      let transport = pipe.transport.clone();
      tokio::spawn(async move {
        transport
          .call(
            "test/slow",
            serde_json::Value::Null,
            Duration::from_secs(30),
          )
          .await
      })
    };

    let (id, _) = pipe.read_request().await;
    pipe
      .write(&Message::Notification {
        method: METHOD_CANCEL.to_string(),
        params: cancel_params(&id),
      })
      .await;

    let error = call.await.unwrap().unwrap_err();
    assert_eq!(error.code, ErrorCode::ProtocolCancelled);
  }

  #[tokio::test]
  async fn the_in_flight_cap_fails_fast_instead_of_queueing() {
    let mut pipe = pipe_with(TransportConfig {
      max_in_flight: 1,
      ..TransportConfig::default()
    });

    let first = {
      let transport = pipe.transport.clone();
      tokio::spawn(async move {
        transport
          .call(
            "test/never",
            serde_json::Value::Null,
            Duration::from_secs(30),
          )
          .await
      })
    };

    // Once its frame is on the wire the first call is registered, so this is not a race.
    pipe.read_request().await;

    let error = pipe
      .transport
      .call(
        "test/never",
        serde_json::Value::Null,
        Duration::from_secs(1),
      )
      .await
      .unwrap_err();
    assert_eq!(error.code, ErrorCode::ProtocolTooManyInFlight);

    first.abort();
  }

  #[tokio::test]
  async fn losing_the_peer_fails_what_is_in_flight_and_everything_after() {
    let mut pipe = pipe();
    let transport = pipe.transport.clone();

    let call = {
      let transport = transport.clone();
      tokio::spawn(async move {
        transport
          .call(
            "test/never",
            serde_json::Value::Null,
            Duration::from_secs(30),
          )
          .await
      })
    };

    pipe.read_request().await;

    // The peer's side disappears entirely; EOF is all the reader loop needs to see.
    drop(pipe);

    let error = deadline(Duration::from_secs(5), call)
      .await
      .unwrap()
      .unwrap()
      .unwrap_err();
    assert_eq!(error.code, ErrorCode::ProcessExited);

    let after = transport
      .call("test/echo", serde_json::Value::Null, Duration::from_secs(1))
      .await
      .unwrap_err();
    assert_eq!(after.code, ErrorCode::ProcessExited);
    assert_eq!(transport.closed_code(), Some(ErrorCode::ProcessExited));
  }

  #[tokio::test]
  async fn inbound_requests_are_answered_by_the_dispatch_with_the_peer_id() {
    let mut pipe = pipe();
    let seen = Arc::new(AtomicUsize::new(0));

    let counted = Arc::clone(&seen);
    pipe.transport.set_dispatch(Dispatch {
      request: Arc::new(move |method, params| {
        counted.fetch_add(1, Ordering::SeqCst);
        Box::pin(async move {
          assert_eq!(method, "sessions/append");
          Ok(params)
        })
      }),
      notification: Arc::new(|_, _| {}),
    });

    pipe
      .write(&Message::Request {
        id: Id::Text("from-backend".into()),
        method: "sessions/append".into(),
        params: serde_json::json!({ "text": "hi" }),
      })
      .await;

    match pipe.read().await {
      Message::Response { id, result } => {
        assert_eq!(
          id,
          Id::Text("from-backend".into()),
          "the id is echoed, never renumbered"
        );
        assert_eq!(result.unwrap(), serde_json::json!({ "text": "hi" }));
      }
      other => panic!("expected a response, got {other:?}"),
    }

    assert_eq!(seen.load(Ordering::SeqCst), 1);
  }

  #[tokio::test]
  async fn an_unrouted_request_gets_method_not_found() {
    let mut pipe = pipe();

    pipe
      .write(&Message::Request {
        id: Id::Number(3),
        method: "nobody/routes/this".into(),
        params: serde_json::Value::Null,
      })
      .await;

    match pipe.read().await {
      Message::Response {
        result: Err(error), ..
      } => {
        assert_eq!(error.known_code(), Some(ErrorCode::ProtocolMethodNotFound));
      }
      other => panic!("expected an error response, got {other:?}"),
    }
  }

  #[tokio::test]
  async fn blank_lines_are_ignored_and_crlf_is_tolerated() {
    let mut pipe = pipe();
    let (sender, mut receiver) = mpsc::channel::<String>(4);

    pipe.transport.set_dispatch(Dispatch {
      request: Arc::new(|method, _| Box::pin(async move { Ok(serde_json::Value::String(method)) })),
      notification: Arc::new(move |method, _| {
        let _ = sender.try_send(method);
      }),
    });

    pipe.peer_in.write_all(b"\n").await.unwrap();
    pipe.peer_in.write_all(b"   \n").await.unwrap();
    pipe
      .peer_in
      .write_all(b"{\"jsonrpc\":\"2.0\",\"method\":\"test/event\"}\r\n")
      .await
      .unwrap();

    let method = deadline(Duration::from_secs(5), receiver.recv())
      .await
      .unwrap()
      .unwrap();
    assert_eq!(method, "test/event");
  }

  #[tokio::test]
  async fn closing_the_transport_gives_the_peer_eof() {
    let mut pipe = pipe();
    pipe.transport.close();

    let mut rest = String::new();
    let read = deadline(
      Duration::from_secs(5),
      pipe.peer_out.read_to_string(&mut rest),
    )
    .await;

    // Reading to the end returns as soon as the write side is closed, which is the signal the backend
    // is supposed to act on (protocol.md §8).
    assert!(read.is_ok(), "the peer should see the end of the stream");
  }

  #[test]
  fn the_reserved_method_names_are_the_ones_the_spec_defines() {
    assert_eq!(
      RESERVED_METHODS,
      ["$/initialize", "$/shutdown", "$/cancel"],
      "the `$/` namespace is the protocol's; changing it is a protocol change"
    );
  }
}
