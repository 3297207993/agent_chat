/**
 * The manifest contract: types, structural + semantic validation, and the JSON Schema artifact.
 *
 * Field set and defaults come from kernel.md 3 (`cambia.json`); the selection behind the choices
 * (zod as the single source, `z.toJSONSchema()` for the Rust side) is implementation.md 3.2(a),
 * and the reasoning per decision is docs/design/host.md ("契约层（K2.1 交付）").
 *
 * One rule governs everything here: **every constraint must be expressible in JSON Schema**.
 * Rust only does schema-level validation at install time (implementation.md 3.2(a)), so a rule
 * written as a zod `refine` would silently vanish from the generated schema — and zod does drop
 * refinements without complaining (verified). Hence plain regexes, `propertyNames` and
 * `additionalProperties` — expressible, and carried through by the generator untouched.
 */

import { z } from 'zod'
import { ERROR_CODES, PluginError, type PluginErrorCode, type PluginIssue } from './errors'
import { isValidRange, isValidVersion, parseHostEngine } from './engines'

/** The manifest file inside a package (kernel.md 7). */
export const MANIFEST_FILENAME = 'cambia.json'

/** Default of `parts.frontend.main` (kernel.md 3). The load layer re-exports this. */
export const DEFAULT_ENTRY = 'frontend/main.js'

/**
 * Reverse-DNS-ish plugin id. One segment is enough (`demo`): the loader experiments use ids like
 * that, and the spec does not require a dotted id today (docs/design/spec.md, open items).
 */
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)*$/

/** Declared version: semver shape. Whether it is a *valid* semver version is checked semantically. */
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

/**
 * A path inside the package: relative, `/`-separated, ASCII, no empty segments, and no `.` / `..`
 * segment — `..` escaping must be rejected at install time (kernel.md 3.3), so it lives in the
 * schema instead of in the semantic pass. ASCII-only is deliberate: these names come out of a ZIP
 * and are compared across platforms.
 */
const RELATIVE_PATH_PATTERN = /^(?!\.\.?(?:\/|$))(?!.*:)(?!.*\\)[A-Za-z0-9._-]+(?:\/(?!\.\.?(?:\/|$))[A-Za-z0-9._-]+)*$/

/** Platform keys of kernel.md 3.3: `<os>`, `<os>-<arch>`, or `*`. Matching order is the host's job. */
const PLATFORM_KEY_PATTERN = /^(?:\*|(?:win|mac|linux)(?:-(?:x64|arm64))?)$/

/** `always`, or `<prefix>:<pattern>`. The prefix vocabulary itself belongs to the host (kernel.md 1.9). */
const ACTIVATION_EVENT_PATTERN = /^(?:always|[A-Za-z][A-Za-z0-9_-]*:\S+)$/

const relativePath = (description: string) => z.string().regex(RELATIVE_PATH_PATTERN).describe(description)

const partsSchema = z
  .strictObject({
    frontend: z
      .object({
        main: relativePath('Single-file ESM bundle of the plugin, relative to the package root')
          .default(DEFAULT_ENTRY),
      })
      .optional()
      .describe('In-process Cordis plugin (single-file bundle, exports apply(ctx, config))'),
    backend: z
      .object({
        protocol: z.string().min(1).describe('Control-plane protocol; jsonrpc-stdio is the defined one'),
        bin: z
          .record(
            z.string().regex(PLATFORM_KEY_PATTERN),
            z
              .union([
                relativePath('Executable path relative to the package root'),
                z.array(z.string().min(1)).min(1).describe('argv of a command, resolved via PATH'),
              ])
              .describe('Either a path to an executable, or an argv array'),
          )
          .describe('Platform -> how to start it; unmatched platform means "unsupported"'),
      })
      .optional()
      .describe('Out-of-process backend program'),
    view: z
      .object({ entry: relativePath('Standalone HTML document rendered in an iframe') })
      .optional()
      .describe('View document shown in a no-same-origin iframe'),
  })
  .describe('Frontend / backend / view; anything else is a part this host cannot run')

const enginesSchema = z
  .object({
    cambia: z.string().min(1).describe('Kernel range, e.g. ^0.1'),
    host: z.string().min(1).describe('Host range as "<host id>@<range>", e.g. agent-chat@^0.1'),
  })
  .describe('The two version constraints a plugin declares (kernel.md 3)')

/**
 * The canonical schema. Top level is **loose** on purpose: unknown keys are preserved rather than
 * rejected, so a newer manifest still loads into an older host (that is what makes the spec
 * versionable). `parts` is strict, because an unknown part means the host lacks that ability.
 */
export const manifestSchema = z.looseObject({
  id: z.string().regex(ID_PATTERN).describe('Plugin id, e.g. com.example.web-search'),
  name: z.string().min(1).describe('Human-readable name'),
  version: z.string().regex(VERSION_PATTERN).describe('Plugin version (semver)'),
  engines: enginesSchema,
  activationEvents: z
    .array(z.string().regex(ACTIVATION_EVENT_PATTERN))
    .default(['always'])
    .describe('"always" (with the app) or "<prefix>:<pattern>"; absent means "always"'),
  parts: partsSchema.optional(),
  contributes: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Opaque to the kernel: vocabulary and shape belong to the host (kernel.md 1.9)'),
})

export type Manifest = z.infer<typeof manifestSchema>
export type ManifestParts = NonNullable<Manifest['parts']>
export type ManifestEngines = Manifest['engines']

export type ManifestValidation =
  | { ok: true; manifest: Manifest }
  | { ok: false; issues: PluginIssue[] }

/**
 * Structural validation (zod) followed by semantic validation (semver shapes, `engines.host`
 * grammar). Problems are **collected**, never thrown on the first one: the install flow has to
 * report everything wrong with a package it is about to reject.
 *
 * The semantic pass only runs when the structure is sound — with a broken structure the field
 * values are not worth interpreting.
 */
export function validateManifest(input: unknown): ManifestValidation {
  if (!isJsonObject(input)) {
    return {
      ok: false,
      issues: [problem(ERROR_CODES.MANIFEST_PARSE_FAILED, '', 'the manifest must be a JSON object')],
    }
  }

  const parsed = manifestSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.flatMap((issue) => toIssues(input, issue)) }
  }

  const issues = semanticIssues(parsed.data)
  if (issues.length > 0) return { ok: false, issues }
  return { ok: true, manifest: parsed.data }
}

/** Same verdict as {@link validateManifest}, for callers that want the error instead of the verdict. */
export function parseManifest(input: unknown): Manifest {
  const result = validateManifest(input)
  if (result.ok) return result.manifest
  const [first] = result.issues
  throw new PluginError({
    code: first?.code ?? ERROR_CODES.MANIFEST_PARSE_FAILED,
    path: first?.path,
    message: `invalid manifest (${MANIFEST_FILENAME}): ${result.issues
      .map((issue) => `${issue.path || '<root>'}: ${issue.message}`)
      .join('; ')}`,
    issues: result.issues,
  })
}

export type JsonSchemaObject = Record<string, unknown>

/**
 * The JSON Schema artifact, generated from {@link manifestSchema} (implementation.md 3.5).
 * `spec/v1/manifest.schema.json` is byte-for-byte this value; regenerate it with
 * `pnpm --filter @cambia/host spec:generate`, never by hand.
 *
 * `io: 'input'` because the manifest is input being validated — with `io: 'output'` the generator
 * would mark defaulted fields (`parts.frontend.main`) as required, which is not the contract.
 */
export function manifestJsonSchema(): JsonSchemaObject {
  return z.toJSONSchema(manifestSchema, { io: 'input' }) as JsonSchemaObject
}

/**
 * The exact on-disk bytes of the artifact. One definition, used by both the generator
 * (`scripts/generate-spec.mjs`) and the drift check — otherwise the two could disagree about
 * formatting and "regenerate it" would not repair the file.
 */
export function serializeManifestJsonSchema(): string {
  return `${JSON.stringify(manifestJsonSchema(), null, 2)}\n`
}

function semanticIssues(manifest: Manifest): PluginIssue[] {
  const issues: PluginIssue[] = []
  const { cambia, host } = manifest.engines

  if (!isValidVersion(manifest.version)) {
    issues.push(problem(ERROR_CODES.MANIFEST_FIELD_INVALID, 'version', `"${manifest.version}" is not a semver version`))
  }
  if (!isValidRange(cambia)) {
    issues.push(problem(ERROR_CODES.MANIFEST_FIELD_INVALID, 'engines.cambia', `"${cambia}" is not a semver range`))
  }
  if (parseHostEngine(host) === null) {
    issues.push(
      problem(ERROR_CODES.MANIFEST_FIELD_INVALID, 'engines.host', 'engines.host must be "<host id>@<range>"'),
    )
  }
  return issues
}

/**
 * zod issue -> spec code. The mapping is by issue path plus issue kind, which is why the schema is
 * shaped the way it is: each spec code has exactly one shape of failure it can come from.
 */
function toIssues(input: unknown, issue: z.core.$ZodIssue): PluginIssue[] {
  const path = issue.path.map((segment) => String(segment))
  const at = path.join('.')
  const detail = issue.message
  const missing = valueAt(input, issue.path) === undefined

  if (issue.code === 'unrecognized_keys' && path[0] === 'parts') {
    return issue.keys.map((key) =>
      problem(
        ERROR_CODES.MANIFEST_UNKNOWN_PART,
        `parts.${key}`,
        `unknown part "${key}": the spec defines frontend / backend / view`,
        detail,
      ),
    )
  }

  if (path[0] === 'engines') {
    return [
      missing
        ? problem(
            ERROR_CODES.MANIFEST_MISSING_ENGINES,
            at,
            'engines.cambia and engines.host are both required (kernel.md 3)',
            detail,
          )
        : problem(ERROR_CODES.MANIFEST_FIELD_INVALID, at, `invalid value for "${at}"`, detail),
    ]
  }

  if (path[0] === 'activationEvents') {
    return [
      problem(
        ERROR_CODES.MANIFEST_ACTIVATION_EVENT_INVALID,
        at,
        'an entry must be "always" or "<prefix>:<pattern>"',
        detail,
      ),
    ]
  }

  if (path[0] === 'parts') {
    if (path[1] === 'backend' && issue.code === 'invalid_key') {
      return [
        problem(
          ERROR_CODES.MANIFEST_PLATFORM_KEY_INVALID,
          at,
          `invalid platform key "${path[path.length - 1]}": expected <os>[-<arch>] or "*"`,
          detail,
        ),
      ]
    }
    if (path[1] === 'backend' && missing && (path[2] === 'bin' || path[2] === 'protocol')) {
      return [
        problem(ERROR_CODES.MANIFEST_BACKEND_INCOMPLETE, at, 'parts.backend requires both protocol and bin', detail),
      ]
    }
    if (isRegexIssue(issue) && isPathField(path)) {
      return [
        problem(
          ERROR_CODES.MANIFEST_PATH_ESCAPE,
          at,
          'the path must stay inside the package root: relative, "/"-separated, no "." or ".." segment',
          detail,
        ),
      ]
    }
  }

  return [problem(ERROR_CODES.MANIFEST_FIELD_INVALID, at, at === '' ? 'invalid manifest' : `invalid value for "${at}"`, detail)]
}

/** `parts.frontend.main`, `parts.view.entry`, `parts.backend.bin.<platform>` are path fields. */
function isPathField(path: readonly string[]): boolean {
  if (path.length === 4) return path[0] === 'parts' && path[1] === 'backend' && path[2] === 'bin'
  return path.length === 3 && path[0] === 'parts' && (path[2] === 'main' || path[2] === 'entry')
}

function isRegexIssue(issue: z.core.$ZodIssue): boolean {
  return issue.code === 'invalid_format' && issue.format === 'regex'
}

function valueAt(input: unknown, path: readonly PropertyKey[]): unknown {
  let cursor: unknown = input
  for (const segment of path) {
    if (cursor === null || typeof cursor !== 'object') return undefined
    cursor = (cursor as Record<PropertyKey, unknown>)[segment]
  }
  return cursor
}

function isJsonObject(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}

function problem(code: PluginErrorCode, path: string, message: string, detail?: string): PluginIssue {
  return detail === undefined ? { code, path, message } : { code, path, message, detail }
}
