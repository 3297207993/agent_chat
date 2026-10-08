#!/usr/bin/env python3
"""The minimal backend of the Python SDK (spec/v1/protocol.md §11).

Same five responsibilities as the Node one — one JSON object per line, answer with the id you were
given, allocate your own outbound ids, drop unknown-id responses, fail in flight before exiting — and
nothing else. The shape is deliberately different from the Node SDK (a reader thread feeding a queue
instead of promises), because the spec fixes the wire, not the concurrency model; two languages landing
on the same verdicts is exactly the evidence the acceptance criterion asks for.

Standard library only.
"""

import json
import queue
import sys
import threading
import time

PROTOCOL_VERSION = 1

next_id = 1
pending = {}

# One reader thread feeds this queue. `select` would be the Unix way to wait with a timeout, but on
# Windows it refuses anything that is not a socket, so the blocking read lives in a thread instead.
lines = queue.Queue()


def send(message):
    """One frame per line; stdout is the protocol channel, stderr is for logs."""
    sys.stdout.write(json.dumps(message) + "\n")
    sys.stdout.flush()


def respond(message_id, result):
    send({"jsonrpc": "2.0", "id": message_id, "result": result})


def respond_error(message_id, code, text, data_code=None):
    error = {"code": code, "message": text}
    if data_code is not None:
        error["data"] = {"code": data_code}
    send({"jsonrpc": "2.0", "id": message_id, "error": error})


def call(method, params, timeout_seconds):
    """Ask the host something and wait for the answer.

    The id is this side's, and a timeout fails only this call (protocol.md §7).
    """
    global next_id

    message_id = next_id
    next_id += 1

    send({"jsonrpc": "2.0", "id": message_id, "method": method, "params": params})

    deadline = time.monotonic() + timeout_seconds

    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            send({"jsonrpc": "2.0", "method": "$/cancel", "params": {"id": message_id}})
            raise TimeoutError('"%s" did not answer within %ss' % (method, timeout_seconds))

        try:
            line = lines.get(timeout=remaining)
        except queue.Empty:
            send({"jsonrpc": "2.0", "method": "$/cancel", "params": {"id": message_id}})
            raise TimeoutError('"%s" did not answer within %ss' % (method, timeout_seconds))

        message = parse_line(line)
        if message is None:
            continue

        if message.get("method") is None:
            if message.get("id") != message_id:
                continue  # a response to nobody: dropped (protocol.md §3)
            if "error" in message:
                raise RuntimeError(message["error"].get("message", "remote error"))
            return message.get("result")

        # Something for the main path arrived while we were waiting. Handle it here rather than drop it.
        handle_incoming(message)


def handle_request(message):
    method = message["method"]
    message_id = message["id"]

    if method == "$/initialize":
        if message.get("params", {}).get("protocolVersion") != PROTOCOL_VERSION:
            respond_error(message_id, -32000, "unsupported protocol version", "PROTOCOL_VERSION_UNSUPPORTED")
        else:
            respond(message_id, {"protocolVersion": PROTOCOL_VERSION})
    elif method == "$/shutdown":
        respond(message_id, None)
        # Answer first, then leave: the host waits for the exit, not for the answer.
        sys.stdout.flush()
        sys.exit(0)
    elif method == "test/echo":
        respond(message_id, message.get("params"))
    elif method == "test/hang":
        # Deliberately never answers: the conformance suite uses it to prove that a call timeout does
        # not touch the process (protocol.md §7).
        pass
    elif method == "test/call-host":
        try:
            respond(message_id, call("host/echo", message.get("params"), 5))
        except Exception as error:  # a minimal SDK reports whatever went wrong
            respond_error(message_id, -32000, str(error), "PROTOCOL_INTERNAL_ERROR")
    else:
        respond_error(message_id, -32601, "no such method: %s" % method, "PROTOCOL_METHOD_NOT_FOUND")


def handle_incoming(message):
    """Route one parsed frame that came from the main path (not from a nested call)."""
    if message.get("method") is None:
        return  # a response to a nested call; that call's own loop takes it

    if message.get("id") is None:
        # A notification. `$/cancel` can only refer to a request of ours, and ours are awaited inline,
        # so there is nothing to do here.
        return

    handle_request(message)


def parse_line(line):
    text = line.rstrip("\r\n")
    if text.strip() == "":
        return None  # blank lines carry nothing (protocol.md §1)

    try:
        return json.loads(text)
    except ValueError:
        # An unparseable frame ends the conversation: the stream can no longer be trusted.
        sys.exit(1)


def read_stdin():
    for line in sys.stdin:
        lines.put(line)

    # EOF: the host closed the stream, so this process has nothing left to serve.
    lines.put(None)


def main():
    threading.Thread(target=read_stdin, daemon=True).start()

    while True:
        line = lines.get()
        if line is None:
            break

        message = parse_line(line)
        if message is not None:
            handle_incoming(message)


if __name__ == "__main__":
    main()
