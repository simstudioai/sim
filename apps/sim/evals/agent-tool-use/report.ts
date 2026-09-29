import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { AgentToolUseResult, LiveScenarioSummary } from './types'

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

/** Machine-readable summary of one live eval run across trials. */
export interface LiveEvalReport {
  suite: 'agent-tool-use-live'
  generatedAt: string
  trials: number
  scenarios: number
  totalPassRate: number
  results: LiveScenarioSummary[]
}

export function buildLiveEvalReport(summaries: LiveScenarioSummary[]): LiveEvalReport {
  const trials = summaries.reduce((sum, summary) => sum + summary.trials, 0)
  const passed = summaries.reduce((sum, summary) => sum + summary.passed, 0)
  return {
    suite: 'agent-tool-use-live',
    generatedAt: new Date().toISOString(),
    trials,
    scenarios: summaries.length,
    totalPassRate: trials === 0 ? 0 : passed / trials,
    results: summaries,
  }
}

function average(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function renderLiveMarkdown(report: LiveEvalReport): string {
  const header = [
    '# Agent tool-use live eval report',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    `**${(report.totalPassRate * 100).toFixed(0)}% pass across ${report.trials} trials / ${report.scenarios} scenarios**`,
    '',
    '| Scenario | Category | Pass rate | Trials | Avg iterations | Avg latency | Failed checks |',
    '| --- | --- | ---: | ---: | ---: | ---: | --- |',
  ]

  const rows = report.results.map((summary) => {
    const failed = new Set<string>()
    for (const result of summary.results) {
      for (const entry of result.checks) {
        if (!entry.passed) failed.add(entry.name)
      }
    }
    const avgIterations = average(summary.results.map((result) => result.metrics.iterations))
    const avgLatency = average(summary.results.map((result) => result.metrics.latencyMs))
    return `| ${escapeCell(summary.id)} | ${summary.category} | ${(summary.passRate * 100).toFixed(0)}% (${summary.passed}/${summary.trials}) | ${summary.trials} | ${avgIterations.toFixed(1)} | ${Math.round(avgLatency)}ms | ${[...failed].join(', ') || '—'} |`
  })

  return [...header, ...rows, ''].join('\n')
}

/**
 * Writes the live JSON report to `reportPath` and a sibling Markdown summary.
 * Live results are statistical, so the report carries pass rates, not a boolean.
 */
export function writeLiveEvalReport(summaries: LiveScenarioSummary[], reportPath: string): void {
  const report = buildLiveEvalReport(summaries)
  mkdirSync(dirname(reportPath), { recursive: true })
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  writeFileSync(reportPath.replace(/\.json$/, '.md'), renderLiveMarkdown(report))
}
