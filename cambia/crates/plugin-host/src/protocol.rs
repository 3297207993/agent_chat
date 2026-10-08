//! The control-plane protocol: frames, messages, and what a frame means.
//!
//! The normative document is [`spec/v1/protocol.md`](../../spec/v1/protocol.md); this module is its
//! executable form and must not add rules on its own. Three of those rules shape everything here:
//!
//! - **Direction is decided by shape**, not by a role marker: a frame with `method` is something the
//!   peer is asking of me, a frame with `result`/`error` is an answer to something I asked. So the two
//!   directions keep **separate id spaces** and neither side renumbers what it receives.
//! - **A response with an unknown id is dropped silently.** Treating it as a protocol error would turn
//!   "the answer to a call I already timed out" into a dead connection.
//! - **The frame cap is enforced by both ends**: the sender must refuse before writing, the receiver
//!   must disconnect. Large payloads stay out of the protocol entirely (kernel.md 3.3).

use serde_json::{Map, Value};

use crate::error_codes::ErrorCode;

/// The only protocol version this implementation speaks.
pub const PROTOCOL_VERSION: u32 = 1;

/// The protocol name that goes in `parts.backend.protocol` (kernel.md 3.3).
pub const PROTOCOL_NAME: &str = "jsonrpc-stdio";

/// `MAX_FRAME_BYTES` from protocol.md §1: one line, 1 MiB.
pub const MAX_FRAME_BYTES: usize = 1024 * 1024;

/// Handshake, sent by the host and answered by the backend. Its round trip **is** the readiness
/// signal (protocol.md §5).
pub const METHOD_INITIALIZE: &str = "$/initialize";
/// Graceful shutdown request.
pub const METHOD_SHUTDOWN: &str = "$/shutdown";
/// Best-effort cancellation, sent in both directions.
pub const METHOD_CANCEL: &str = "$/cancel";

/// A JSON-RPC id. Both forms are legal on the wire; this crate allocates numbers only.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum Id {
  /// The form this crate allocates: monotonic integers, one space per direction.
  Number(i64),
  /// Accepted so a peer written in another language can pick strings.
  Text(String),
}

impl Id {
  fn from_value(value: &Value) -> Option<Self> {
    match value {
      Value::Number(number) => number.as_i64().map(Id::Number),
      Value::String(text) => Some(Id::Text(text.clone())),
      _ => None,
    }
  }

  fn to_value(&self) -> Value {
    match self {
      Id::Number(number) => Value::Number((*number).into()),
      Id::Text(text) => Value::String(text.clone()),
    }
  }
}

/// A JSON-RPC error object as it travels on the wire.
///
/// Two levels, per protocol.md §6: `code` is the numeric classification, `data_code` is the Cambia
/// string code from `spec/v1/error-codes.json`. The string is kept as it arrived — a peer may report a
/// code this version does not know, and that must survive rather than be flattened to "unknown".
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ErrorObject {
  /// JSON-RPC numeric code.
  pub code: i64,
  /// Human-readable, for logs.
  pub message: String,
  /// `error.data.code`, when the peer sent one.
  pub data_code: Option<String>,
}

impl ErrorObject {
  /// The Cambia code, when the peer sent one this version knows.
  pub fn known_code(&self) -> Option<ErrorCode> {
    let wanted = self.data_code.as_deref()?;
    ErrorCode::ALL
      .iter()
      .copied()
      .find(|code| code.as_str() == wanted)
  }

  /// Build an error from one of our own codes, using the numeric classification protocol.md assigns.
  pub fn from_code(code: ErrorCode, message: impl Into<String>) -> Self {
    Self {
      code: numeric_for(code),
      message: message.into(),
      data_code: Some(code.as_str().to_string()),
    }
  }
}

/// The numeric code protocol.md §6 assigns to a Cambia code.
pub fn numeric_for(code: ErrorCode) -> i64 {
  match code {
    ErrorCode::ProtocolParseError => -32700,
    ErrorCode::ProtocolInvalidMessage => -32600,
    ErrorCode::ProtocolMethodNotFound => -32601,
    ErrorCode::ProtocolInvalidParams => -32602,
    ErrorCode::ProtocolInternalError => -32603,
    ErrorCode::ProtocolVersionUnsupported => -32000,
    ErrorCode::ProtocolCallTimeout => -32001,
    ErrorCode::ProtocolCancelled => -32002,
    ErrorCode::ProtocolFrameTooLarge => -32003,
    ErrorCode::ProcessExited => -32004,
    ErrorCode::ProtocolTooManyInFlight => -32005,
    // Every other code is a host-side verdict, not a protocol classification; if one ever crosses the
    // wire it travels as an internal error rather than as an invented classification.
    _ => -32603,
  }
}

/// One parsed frame.
#[derive(Debug, Clone, PartialEq)]
pub enum Message {
  /// The peer is asking something of me.
  Request {
    /// Allocated by the sender; the peer owns it, so we echo it back untouched.
    id: Id,
    /// The method name. `$/…` is reserved by this protocol; everything else belongs to the host.
    method: String,
    /// `params`, or `Value::Null` when the frame carried none.
    params: Value,
  },
  /// An answer to something I asked. `Err` carries the peer's error object.
  Response {
    /// The id I allocated for the request this answers.
    id: Id,
    /// The peer's result, or its error object.
    result: Result<Value, ErrorObject>,
  },
  /// Fire and forget, in either direction. `$/cancel` travels this way.
  Notification {
    /// The method name, with the same `$/` rule as a request.
    method: String,
    /// `params`, or `Value::Null` when the frame carried none.
    params: Value,
  },
}

impl Message {
  /// Serialize to one line, without the trailing newline (the writer adds it).
  ///
  /// Fails with `PROTOCOL_FRAME_TOO_LARGE` when the line exceeds the cap: the **sender** refuses, per
  /// protocol.md §1 — writing it and letting the peer disconnect would only move the failure.
  pub fn to_line(&self) -> Result<String, FrameError> {
    let value = match self {
      Message::Request { id, method, params } => json_object(vec![
        ("jsonrpc", Value::String("2.0".into())),
        ("id", id.to_value()),
        ("method", Value::String(method.clone())),
        ("params", params.clone()),
      ]),
      Message::Response { id, result } => {
        let mut fields = vec![
          ("jsonrpc", Value::String("2.0".into())),
          ("id", id.to_value()),
        ];
        match result {
          Ok(value) => fields.push(("result", value.clone())),
          Err(error) => fields.push(("error", error_to_value(error))),
        }
        json_object(fields)
      }
      Message::Notification { method, params } => json_object(vec![
        ("jsonrpc", Value::String("2.0".into())),
        ("method", Value::String(method.clone())),
        ("params", params.clone()),
      ]),
    };

    let line = value.to_string();
    if line.len() > MAX_FRAME_BYTES {
      return Err(FrameError {
        code: ErrorCode::ProtocolFrameTooLarge,
        message: format!(
          "frame is {} bytes, over the {MAX_FRAME_BYTES} byte cap",
          line.len()
        ),
      });
    }

    Ok(line)
  }

  /// Parse one frame. The returned error tells the caller which classification to send back and, for
  /// parse and oversize failures, that the channel is no longer trustworthy (protocol.md §8).
  pub fn parse(line: &str) -> Result<Self, FrameError> {
    if line.len() > MAX_FRAME_BYTES {
      return Err(FrameError {
        code: ErrorCode::ProtocolFrameTooLarge,
        message: format!(
          "frame is {} bytes, over the {MAX_FRAME_BYTES} byte cap",
          line.len()
        ),
      });
    }

    let value: Value = serde_json::from_str(line).map_err(|error| FrameError {
      code: ErrorCode::ProtocolParseError,
      message: error.to_string(),
    })?;

    let object = value.as_object().ok_or_else(|| FrameError {
      code: ErrorCode::ProtocolInvalidMessage,
      message: "a frame must be a JSON object".into(),
    })?;

    if object.get("jsonrpc").and_then(Value::as_str) != Some("2.0") {
      return Err(FrameError {
        code: ErrorCode::ProtocolInvalidMessage,
        message: "a frame must carry jsonrpc: \"2.0\"".into(),
      });
    }

    match object.get("method") {
      // Direction is decided here and nowhere else: a method makes it the peer's request or
      // notification, an id decides which.
      Some(method) => {
        let method = method.as_str().ok_or_else(|| FrameError {
          code: ErrorCode::ProtocolInvalidMessage,
          message: "method must be a string".into(),
        })?;

        let params = object.get("params").cloned().unwrap_or(Value::Null);

        match object.get("id") {
          None | Some(Value::Null) => Ok(Message::Notification {
            method: method.to_string(),
            params,
          }),
          Some(id) => Ok(Message::Request {
            id: Id::from_value(id).ok_or_else(|| FrameError {
              code: ErrorCode::ProtocolInvalidMessage,
              message: "id must be a number or a string".into(),
            })?,
            method: method.to_string(),
            params,
          }),
        }
      }
      None => {
        let id = object
          .get("id")
          .and_then(Id::from_value)
          .ok_or_else(|| FrameError {
            code: ErrorCode::ProtocolInvalidMessage,
            message: "a response needs an id, and a method or a result/error".into(),
          })?;

        let result = match (object.get("result"), object.get("error")) {
          (Some(value), None) => Ok(value.clone()),
          (None, Some(error)) => Err(parse_error_object(error)?),
          _ => {
            return Err(FrameError {
              code: ErrorCode::ProtocolInvalidMessage,
              message: "a response carries exactly one of result / error".into(),
            })
          }
        };

        Ok(Message::Response { id, result })
      }
    }
  }
}

/// A frame that could not be turned into a message, with the classification protocol.md §6 assigns.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{code}: {message}")]
pub struct FrameError {
  /// Which spec code to report.
  pub code: ErrorCode,
  /// Detail, for logs and for the `message` field of the error frame.
  pub message: String,
}

/// What a frame is, seen by the side that received it — used to decide who owns the id.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
  /// The peer sent it: we answer it, or drop it if it is a notification.
  Inbound,
  /// It answers something we sent.
  Outbound,
}

impl Message {
  /// The side that owns this frame, per protocol.md §2.
  pub fn direction(&self) -> Direction {
    match self {
      Message::Request { .. } | Message::Notification { .. } => Direction::Inbound,
      Message::Response { .. } => Direction::Outbound,
    }
  }
}

/// `{ "id": … }` — the params of `$/cancel` (protocol.md §5).
pub fn cancel_params(id: &Id) -> Value {
  json_object(vec![("id", id.to_value())])
}

/// The `id` out of a `$/cancel` notification's params.
pub fn cancelled_id(params: &Value) -> Option<Id> {
  params.get("id").and_then(Id::from_value)
}

fn json_object(fields: Vec<(&str, Value)>) -> Value {
  let mut map = Map::new();
  for (key, value) in fields {
    map.insert(key.to_string(), value);
  }
  Value::Object(map)
}

fn error_to_value(error: &ErrorObject) -> Value {
  let mut data = Map::new();
  if let Some(code) = &error.data_code {
    data.insert("code".into(), Value::String(code.clone()));
  }

  json_object(vec![
    ("code", Value::Number(error.code.into())),
    ("message", Value::String(error.message.clone())),
    ("data", Value::Object(data)),
  ])
}

fn parse_error_object(value: &Value) -> Result<ErrorObject, FrameError> {
  let object = value.as_object().ok_or_else(|| FrameError {
    code: ErrorCode::ProtocolInvalidMessage,
    message: "error must be an object".into(),
  })?;

  let code = object
    .get("code")
    .and_then(Value::as_i64)
    .ok_or_else(|| FrameError {
      code: ErrorCode::ProtocolInvalidMessage,
      message: "error.code must be a number".into(),
    })?;

  let message = object
    .get("message")
    .and_then(Value::as_str)
    .unwrap_or_default()
    .to_string();

  let data_code = object
    .get("data")
    .and_then(|data| data.get("code"))
    .and_then(Value::as_str)
    .map(str::to_string);

  Ok(ErrorObject {
    code,
    message,
    data_code,
  })
}

#[cfg(test)]
mod tests {
  use super::*;

  fn value(text: &str) -> Value {
    serde_json::from_str(text).unwrap()
  }

  #[test]
  fn a_request_round_trips() {
    let message = Message::Request {
      id: Id::Number(7),
      method: "tools/execute".into(),
      params: value(r#"{"name":"ls"}"#),
    };

    assert_eq!(
      Message::parse(&message.to_line().unwrap()).unwrap(),
      message
    );
  }

  #[test]
  fn a_response_round_trips_in_both_shapes() {
    let ok = Message::Response {
      id: Id::Number(1),
      result: Ok(value(r#"{"ok":true}"#)),
    };
    let failed = Message::Response {
      id: Id::Text("abc".into()),
      result: Err(ErrorObject::from_code(
        ErrorCode::ProtocolMethodNotFound,
        "no such method",
      )),
    };

    assert_eq!(Message::parse(&ok.to_line().unwrap()).unwrap(), ok);
    assert_eq!(Message::parse(&failed.to_line().unwrap()).unwrap(), failed);
  }

  #[test]
  fn a_notification_has_no_id_and_round_trips() {
    let message = Message::Notification {
      method: METHOD_CANCEL.into(),
      params: cancel_params(&Id::Number(42)),
    };

    assert_eq!(
      Message::parse(&message.to_line().unwrap()).unwrap(),
      message
    );
    assert_eq!(
      cancelled_id(&cancel_params(&Id::Number(42))),
      Some(Id::Number(42))
    );
  }

  #[test]
  fn a_missing_id_makes_a_notification_rather_than_a_request() {
    // The distinction the whole id story rests on: no id = nobody is waiting for an answer.
    let parsed = Message::parse(r#"{"jsonrpc":"2.0","method":"test/event"}"#).unwrap();
    assert_eq!(
      parsed,
      Message::Notification {
        method: "test/event".into(),
        params: Value::Null
      }
    );
    assert_eq!(parsed.direction(), Direction::Inbound);
  }

  #[test]
  fn direction_comes_from_the_shape_not_from_a_flag() {
    let request = Message::parse(r#"{"jsonrpc":"2.0","id":1,"method":"a/b"}"#).unwrap();
    let response = Message::parse(r#"{"jsonrpc":"2.0","id":1,"result":null}"#).unwrap();
    let error =
      Message::parse(r#"{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"x"}}"#).unwrap();

    assert_eq!(request.direction(), Direction::Inbound);
    assert_eq!(response.direction(), Direction::Outbound);
    assert_eq!(error.direction(), Direction::Outbound);
  }

  #[test]
  fn bad_json_is_a_parse_error() {
    let error = Message::parse("{not json").unwrap_err();
    assert_eq!(error.code, ErrorCode::ProtocolParseError);
  }

  #[test]
  fn shaped_wrong_frames_are_invalid_messages() {
    for line in [
      r#"[]"#,                                                                  // not an object
      r#"{"id":1,"method":"a/b"}"#,                                             // no jsonrpc
      r#"{"jsonrpc":"1.0","id":1,"method":"a/b"}"#,                             // wrong version
      r#"{"jsonrpc":"2.0","id":1}"#, // neither method nor result
      r#"{"jsonrpc":"2.0","id":1,"result":1,"error":{"code":1,"message":""}}"#, // both
      r#"{"jsonrpc":"2.0","id":{},"method":"a/b"}"#, // id is neither number nor string
      r#"{"jsonrpc":"2.0","id":1,"error":{"message":"x"}}"#, // error without a numeric code
    ] {
      let error = Message::parse(line).unwrap_err();
      assert_eq!(
        error.code,
        ErrorCode::ProtocolInvalidMessage,
        "line: {line}"
      );
    }
  }

  #[test]
  fn an_oversize_frame_is_refused_by_the_sender_and_the_receiver() {
    let huge = Message::Notification {
      method: "test/echo".into(),
      params: Value::String("x".repeat(MAX_FRAME_BYTES)),
    };

    let refused = huge.to_line().unwrap_err();
    assert_eq!(refused.code, ErrorCode::ProtocolFrameTooLarge);

    let received = Message::parse(&"x".repeat(MAX_FRAME_BYTES + 1)).unwrap_err();
    assert_eq!(received.code, ErrorCode::ProtocolFrameTooLarge);
  }

  #[test]
  fn a_peer_error_keeps_its_code_even_when_this_version_does_not_know_it() {
    let parsed = Message::parse(
      r#"{"jsonrpc":"2.0","id":1,"error":{"code":-32000,"message":"nope","data":{"code":"SOMETHING_NEW"}}}"#,
    )
    .unwrap();

    let Message::Response {
      result: Err(error), ..
    } = parsed
    else {
      panic!("expected an error response");
    };

    assert_eq!(error.data_code.as_deref(), Some("SOMETHING_NEW"));
    assert_eq!(
      error.known_code(),
      None,
      "an unknown code must survive, not be flattened"
    );
  }

  #[test]
  fn our_own_codes_carry_the_numeric_classification_the_spec_assigns() {
    let error = ErrorObject::from_code(ErrorCode::ProtocolCallTimeout, "too slow");
    assert_eq!(error.code, -32001);
    assert_eq!(error.data_code.as_deref(), Some("PROTOCOL_CALL_TIMEOUT"));
    assert_eq!(error.known_code(), Some(ErrorCode::ProtocolCallTimeout));
  }
}
