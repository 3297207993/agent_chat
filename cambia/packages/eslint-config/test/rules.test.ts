/**
 * This suite does not merely "run lint once" — it **proves that the rules really report**:
 * deliberate violations must be caught (and by the right rule), while the real example plugin
 * must come out spotless.
 *
 * Without these assertions the rule set would be a promise written in a document, which is exactly
 * what K1.3 set out to eliminate.
 */

import { fileURLToPath } from 'node:url'
import { basename } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ESLint } from 'eslint'
import { base, isolation, plugin } from '../index.js'

const fixturesDir = fileURLToPath(new URL('fixtures', import.meta.url))
const exampleDir = fileURLToPath(new URL('../../../examples/hello-plugin', import.meta.url))

interface Report {
  file: string
  ruleId: string | null
  message: string
}

/** Lint a set of files with the given config and flatten the reports. */
async function lint(cwd: string, config: unknown[], patterns: string[]): Promise<Report[]> {
  const eslint = new ESLint({
    cwd,
    // Use the caller's config and never look for a config file: this exercises the very config
    // that gets published
    overrideConfigFile: true,
    overrideConfig: config as never,
    ignore: false,
  })
  const results = await eslint.lintFiles(patterns)
  return results.flatMap((result) => result.messages.map((message) => ({
    file: basename(result.filePath),
    ruleId: message.ruleId,
    message: message.message,
  })))
}

const ruleIdsOf = (reports: Report[], file: string) =>
  reports.filter((report) => report.file === file).map((report) => report.ruleId)

describe('upstream isolation rules: deliberate violations must be caught', () => {
  const violations = [
    'imports-cordis.ts',
    'cordis-subpath.ts',
    'declare-module-cordis.ts',
    'core-subpath.ts',
  ]

  it('reports each of the four violations on its own rule', async () => {
    const reports = await lint(fixturesDir, plugin, violations)

    expect(ruleIdsOf(reports, 'imports-cordis.ts')).toContain('no-restricted-imports')
    expect(ruleIdsOf(reports, 'cordis-subpath.ts')).toContain('no-restricted-imports')
    expect(ruleIdsOf(reports, 'core-subpath.ts')).toContain('no-restricted-imports')
    expect(ruleIdsOf(reports, 'declare-module-cordis.ts')).toContain('no-restricted-syntax')

    // The message has to point back at the document, otherwise the author only learns "blocked",
    // not how to write it correctly
    const declareReport = reports.find((report) => report.file === 'declare-module-cordis.ts')
    expect(declareReport?.message).toContain('kernel.md 5.3.1')
  })

  it('compliant code produces no report at all', async () => {
    const reports = await lint(fixturesDir, plugin, ['clean.ts'])
    expect(reports).toEqual([])
  })

  it('the isolation rules alone still catch violations when composed onto a custom config', async () => {
    // isolation is a rule set without any language configuration: composed onto your own config it
    // is used as `[...base, ...isolation]`
    const reports = await lint(fixturesDir, [...base, ...isolation], violations)
    const flagged = [...new Set(reports.map((report) => report.file))].sort()
    expect(flagged).toEqual([
      'cordis-subpath.ts',
      'core-subpath.ts',
      'declare-module-cordis.ts',
      'imports-cordis.ts',
    ])
    expect([...new Set(reports.map((report) => report.ruleId))].sort())
      .toEqual(['no-restricted-imports', 'no-restricted-syntax'])
  })
})

describe('the real example plugin: must be spotless', () => {
  it('examples/hello-plugin is clean under the plugin preset', async () => {
    const reports = await lint(exampleDir, plugin, [
      'src/index.ts',
      'test/host.test.ts',
      'test/contract.ts',
      'vitest.config.ts',
    ])
    expect(reports).toEqual([])
  })
})
