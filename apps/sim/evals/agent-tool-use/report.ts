import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { AgentToolUseResult } from './types'

/** Machine-readable summary of one eval run. */
export interface AgentToolUseEvalReport {
  suite: 'agent-tool-use'
  generatedAt: string
  total: number
  passed: number
  failed: number
  results: AgentToolUseResult[]
}

export function buildEvalReport(results: AgentToolUseResult[]): AgentToolUseEvalReport {
  const passed = results.filter((result) => result.passed).length
  return {
    suite: 'agent-tool-use',
    generatedAt: new Date().toISOString(),
    total: results.length,
    passed,
    failed: results.length - passed,
    results,
  }
}

function escapeCell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ')
}

function renderMarkdown(report: AgentToolUseEvalReport): string {
  const header = [
    '# Agent tool-use eval report',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    `**${report.passed}/${report.total} passed**`,
    '',
    '| Scenario | Category | Status | Iterations | Tools (ok/error) | Latency | Failed checks |',
    '| --- | --- | --- | ---: | ---: | ---: | --- |',
  ]

  const rows = report.results.map((result) => {
    const failed = result.checks
      .filter((entry) => !entry.passed)
      .map((entry) => entry.name)
      .join(', ')
    return `| ${escapeCell(result.id)} | ${result.category} | ${result.passed ? '✅ pass' : '❌ fail'} | ${result.metrics.iterations} | ${result.metrics.successfulToolCalls}/${result.metrics.erroredToolCalls} | ${result.metrics.latencyMs}ms | ${failed || '—'} |`
  })

  return [...header, ...rows, ''].join('\n')
}

/**
 * Writes the JSON report to `reportPath` and a sibling Markdown summary. The
 * caller supplies the path (`EVAL_REPORT_PATH`) so CI can upload it.
 */
export function writeEvalReport(results: AgentToolUseResult[], reportPath: string): void {
  const report = buildEvalReport(results)
  mkdirSync(dirname(reportPath), { recursive: true })
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  writeFileSync(reportPath.replace(/\.json$/, '.md'), renderMarkdown(report))
}
