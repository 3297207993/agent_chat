/**
 * 这套测试的作用不是"跑一遍 lint"，而是**证明规则真的会报错**：
 * 故意违规的 fixture 必须被拦下（而且要报在正确的规则上），真实的示例插件必须零告警。
 *
 * 没有这套断言，规则集就只是"写在文档里的承诺"——那正是 K1.3 要消灭的东西。
 */

import { fileURLToPath } from 'node:url'
import { basename, join } from 'node:path'
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

/** 用给定的配置 lint 一批文件，返回拍平后的报错清单。 */
async function lint(cwd: string, config: unknown[], patterns: string[]): Promise<Report[]> {
  const eslint = new ESLint({
    cwd,
    // 用调用方给的配置，不去找配置文件：这样测的就是"发布出去的那份配置"
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

describe('上游隔离规则：故意违规必须被拦下', () => {
  const violations = [
    'imports-cordis.ts',
    'cordis-subpath.ts',
    'declare-module-cordis.ts',
    'core-subpath.ts',
  ]

  it('四条违规写法各报在对应的规则上', async () => {
    const reports = await lint(fixturesDir, plugin, violations)

    expect(ruleIdsOf(reports, 'imports-cordis.ts')).toContain('no-restricted-imports')
    expect(ruleIdsOf(reports, 'cordis-subpath.ts')).toContain('no-restricted-imports')
    expect(ruleIdsOf(reports, 'core-subpath.ts')).toContain('no-restricted-imports')
    expect(ruleIdsOf(reports, 'declare-module-cordis.ts')).toContain('no-restricted-syntax')

    // 报错信息要指回文档，否则作者只知道"被拦下了"，不知道该怎么写
    const declareReport = reports.find((report) => report.file === 'declare-module-cordis.ts')
    expect(declareReport?.message).toContain('kernel.md 5.3.1')
  })

  it('合规写法零告警', async () => {
    const reports = await lint(fixturesDir, plugin, ['clean.ts'])
    expect(reports).toEqual([])
  })

  it('只带隔离规则的配置也能拦住违规（组合到自定义配置时仍然生效）', async () => {
    // isolation 是一组规则，不含语言配置：拼到自己的配置上时按 `[...base, ...isolation]` 组合
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

describe('真实的示例插件：必须零告警', () => {
  it('examples/hello-plugin 在插件预设下干净', async () => {
    const reports = await lint(exampleDir, plugin, [
      'src/index.ts',
      'test/host.test.ts',
      'test/contract.ts',
      'vitest.config.ts',
    ])
    expect(reports).toEqual([])
  })
})
