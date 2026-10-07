/**
 * `engines` verdicts (kernel.md 3: the manifest declares a kernel range and a host range).
 *
 * Reuse, not re-invention: range semantics come from `semver@7`, and the Rust side aligns to it
 * through `node-semver@2` (implementation.md 3.2(b)) — the point of that pair is that "decided at
 * install time (Rust)" and "decided at load time (JS)" cannot disagree.
 *
 * What this module may decide: "does the range admit this version, and if not, which constraint".
 * What it may not decide: "is installing an incompatible plugin allowed" — that is host policy.
 * Prereleases follow plain semver: a range only admits them when it names a prerelease itself.
 */

import semver from 'semver'
import { ERROR_CODES } from './errors'
import type { Manifest } from './manifest'

const HOST_ENGINE_SEPARATOR = '@'

/** `true` when `value` is a plain semver version (`1.2.3`, `1.2.3-rc.1`, …). */
export function isValidVersion(value: string): boolean {
  return semver.valid(value) !== null
}

/**
 * `true` when `value` is a valid semver range (`^0.1`, `>=1 <2`, …).
 *
 * The empty range is rejected on purpose: `semver.validRange('')` reads it as `*` (verified), and
 * "no constraint declared" is not something a manifest is allowed to mean.
 */
export function isValidRange(value: string): boolean {
  return value.trim() !== '' && semver.validRange(value) !== null
}

/** The parsed `<host id>@<range>` form of `engines.host`. */
export interface HostEngine {
  host: string
  range: string
}

/**
 * Parses `engines.host` (`agent-chat@^0.1`). Splits at the **last** `@` so scoped host ids
 * (`@scope/app@^1`) survive. Returns `null` for anything else — the caller decides whether that is
 * a manifest error (`MANIFEST_FIELD_INVALID`) or just an unsatisfiable constraint.
 */
export function parseHostEngine(value: string): HostEngine | null {
  const separator = value.lastIndexOf(HOST_ENGINE_SEPARATOR)
  if (separator <= 0 || separator === value.length - 1) return null
  const host = value.slice(0, separator)
  const range = value.slice(separator + 1)
  if (host === '' || !isValidRange(range)) return null
  return { host, range }
}

/** Versions of the running host: the kernel version, and `<host id>@<version>` of the application. */
export interface RuntimeVersions {
  /** e.g. `0.1.0` — the version of `@cambia/core` the host runs */
  cambia: string
  /** e.g. `agent-chat@0.1.0` */
  host: string
}

/** Which of the two constraints failed, and why. */
export interface EngineMismatch {
  subject: 'cambia' | 'host-id' | 'host-version' | 'host-range'
  detail: string
}

export type EnginesVerdict = { ok: true } | { ok: false; code: 'ENGINE_INCOMPATIBLE'; mismatches: EngineMismatch[] }

/**
 * The intersection test of implementation.md 3.2(b): both declared ranges must admit the running
 * versions. Total by construction — a malformed range or `engines.host` comes back as a mismatch
 * instead of throwing, so this can be called on input that has not been validated yet.
 */
export function checkEngines(manifest: Manifest, runtime: RuntimeVersions): EnginesVerdict {
  const mismatches: EngineMismatch[] = []
  const { cambia, host } = manifest.engines

  if (!isValidRange(cambia)) {
    mismatches.push({ subject: 'cambia', detail: `engines.cambia is not a valid range: ${cambia}` })
  } else if (!semver.satisfies(runtime.cambia, cambia)) {
    mismatches.push({ subject: 'cambia', detail: `kernel ${runtime.cambia} does not satisfy ${cambia}` })
  }

  const declared = parseHostEngine(host)
  const running = parseHostEngine(runtime.host)
  if (declared === null) {
    mismatches.push({ subject: 'host-range', detail: `engines.host is not "<host id>@<range>": ${host}` })
  } else if (running === null) {
    mismatches.push({ subject: 'host-range', detail: `runtime host is not "<host id>@<version>": ${runtime.host}` })
  } else if (declared.host !== running.host) {
    mismatches.push({
      subject: 'host-id',
      detail: `plugin targets host ${declared.host}, running host is ${running.host}`,
    })
  } else if (!semver.satisfies(running.range, declared.range)) {
    mismatches.push({
      subject: 'host-version',
      detail: `host ${running.range} does not satisfy ${declared.range}`,
    })
  }

  if (mismatches.length > 0) {
    return { ok: false, code: ERROR_CODES.ENGINE_INCOMPATIBLE, mismatches }
  }
  return { ok: true }
}
