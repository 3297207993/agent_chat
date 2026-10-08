#!/usr/bin/env node
'use strict'

/**
 * The minimal backend of the Node SDK (spec/v1/protocol.md §11).
 *
 * It exists to prove the protocol is implementable in a second language, not to be a framework: zero
 * dependencies, one file, and the five responsibilities the spec lists.
 *
 *   1. read and write one JSON object per line
 *   2. answer the host's requests, echoing the id it sent
 *   3. allocate its own outbound ids and keep them in a table (for timeouts and $/cancel)
 *   4. drop responses whose id it does not know
 *   5. fail everything in flight before it exits
 *
 * On top of those it carries exactly two test methods — `test/echo` and `test/call-host` — so the
 * conformance suite can exercise both directions. No domain vocabulary lives here: method names belong
 * to the host (kernel.md 1.9).
 */

import { createInterface } from 'node:readline'

const PROTOCOL_VERSION = 1

/** The outbound id table: this side allocates these, and only these. */
let nextId = 1
const pending = new Map()

/** One frame per line, and nothing else: stdout is the protocol channel (protocol.md §1). */
function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function respond(id, result) {
  send({ jsonrpc: '2.0', id, result })
}

function respondError(id, code, message, dataCode) {
  send({ jsonrpc: '2.0', id, error: { code, message, ...(dataCode ? { data: { code: dataCode } } : {}) } })
}

/**
 * Ask the host something. The id comes from this side's space, and a timeout means this request failed —
 * not that the host died (protocol.md §7).
 */
function call(method, params, timeoutMs) {
  const id = nextId++
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      send({ jsonrpc: '2.0', method: '$/cancel', params: { id } })
      reject(new Error(`"${method}" did not answer within ${timeoutMs}ms`))
    }, timeoutMs)

    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      reject: (error) => {
        clearTimeout(timer)
        reject(error)
      },
    })

    send({ jsonrpc: '2.0', id, method, params })
  })
}

async function handleRequest(message) {
  switch (message.method) {
    case '$/initialize':
      if (message.params?.protocolVersion !== PROTOCOL_VERSION) {
        respondError(message.id, -32000, 'unsupported protocol version', 'PROTOCOL_VERSION_UNSUPPORTED')
        return
      }
      respond(message.id, { protocolVersion: PROTOCOL_VERSION })
      return

    case '$/shutdown':
      respond(message.id, null)
      // Answer first, then leave: the host waits for the exit, not for the answer (protocol.md §5).
      process.stdout.write('', () => process.exit(0))
      return

    case 'test/echo':
      respond(message.id, message.params ?? null)
      return

    case 'test/hang':
      // Deliberately never answers: the conformance suite uses it to prove that a call timeout does
      // not touch the process (protocol.md §7).
      return

    case 'test/call-host':
      try {
        respond(message.id, await call('host/echo', message.params ?? null, 5000))
      } catch (error) {
        respondError(message.id, -32000, String(error.message ?? error), 'PROTOCOL_INTERNAL_ERROR')
      }
      return

    default:
      respondError(message.id, -32601, `no such method: ${message.method}`, 'PROTOCOL_METHOD_NOT_FOUND')
  }
}

function handleNotification(message) {
  if (message.method !== '$/cancel') return

  const entry = pending.get(message.params?.id)
  if (!entry) return

  // The host cancelled our request: the protocol calls that a failure of the call, nothing more.
  pending.delete(message.params.id)
  entry.reject(new Error('PROTOCOL_CANCELLED'))
}

function handleResponse(message) {
  // An unknown id is dropped, never treated as an error: it answers a call that has already timed out
  // or been cancelled (protocol.md §3).
  const entry = pending.get(message.id)
  if (!entry) return

  pending.delete(message.id)
  if (message.error) entry.reject(new Error(message.error.message ?? 'remote error'))
  else entry.resolve(message.result)
}

function handleLine(line) {
  const text = line.replace(/\r$/, '')
  if (text.trim() === '') return // blank lines carry nothing (protocol.md §1)

  let message
  try {
    message = JSON.parse(text)
  } catch {
    // A frame that cannot be parsed ends the conversation: the stream is no longer trustworthy.
    process.exit(1)
  }

  if (message.method === undefined) {
    handleResponse(message)
    return
  }

  if (message.id === undefined) {
    handleNotification(message)
    return
  }

  // Only requests are serialised, so a slow one cannot overtake a fast one. Answers must not go
  // through the queue: a request handler that is waiting for the host (test/call-host) would otherwise
  // be queued in front of the very response it is waiting for.
  queue = queue.then(() => handleRequest(message)).catch(() => process.exit(1))
}

/** Requests are handled in arrival order. */
let queue = Promise.resolve()

const reader = createInterface({ input: process.stdin, crlfDelay: Infinity })
reader.on('line', handleLine)

/** Before leaving, everything still in flight must fail rather than hang forever (protocol.md §11). */
function failInFlight() {
  for (const entry of pending.values()) entry.reject(new Error('PROCESS_EXITED'))
  pending.clear()
}

process.on('exit', failInFlight)
