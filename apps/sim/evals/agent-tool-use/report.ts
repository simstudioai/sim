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

/** One trial of one model on one scenario, for the comparison report. */
export interface LiveModelRun {
  provider: string
  model: string
  scenarioId: string
  result: AgentToolUseResult
}

/** Aggregate behavior of one model across the suite. */
export interface LiveModelSummary {
  provider: string
  model: string
  label: string
  trials: number
  passed: number
  passRate: number
  avgIterations: number
  avgLatencyMs: number
  totalTokens: number
  /** Names of the checks this model failed at least once, sorted. */
  failedChecks: string[]
}

/** Side-by-side comparison of several models on the same scenarios. */
export interface LiveComparisonReport {
  suite: 'agent-tool-use-compare'
  generatedAt: string
  scenarios: string[]
  models: LiveModelSummary[]
  /** scenarioId -> model label -> pass rate. */
  matrix: Record<string, Record<string, number>>
}

function modelLabel(run: LiveModelRun): string {
  return `${run.provider}/${run.model}`
}

export function buildLiveComparisonReport(runs: LiveModelRun[]): LiveComparisonReport {
  const byModel = new Map<string, LiveModelRun[]>()
  for (const run of runs) {
    const key = modelLabel(run)
    const list = byModel.get(key) ?? []
    list.push(run)
    byModel.set(key, list)
  }

  const scenarios = [...new Set(runs.map((run) => run.scenarioId))].sort()
  const models: LiveModelSummary[] = []
  const matrix: Record<string, Record<string, number>> = {}

  for (const [label, modelRuns] of byModel) {
    const results = modelRuns.map((run) => run.result)
    const passed = results.filter((result) => result.passed).length
    const [provider, model] = label.split('/')
    const failedChecks = new Set<string>()
    for (const result of results) {
      for (const entry of result.checks) {
        if (!entry.passed) failedChecks.add(entry.name)
      }
    }
    models.push({
      provider,
      model,
      label,
      trials: results.length,
      passed,
      passRate: results.length === 0 ? 0 : passed / results.length,
      avgIterations: average(results.map((result) => result.metrics.iterations)),
      avgLatencyMs: average(results.map((result) => result.metrics.latencyMs)),
      totalTokens: results.reduce((sum, result) => sum + result.metrics.totalTokens, 0),
      failedChecks: [...failedChecks].sort(),
    })

    for (const scenario of scenarios) {
      const scenarioRuns = modelRuns.filter((run) => run.scenarioId === scenario)
      const scenarioPassed = scenarioRuns.filter((run) => run.result.passed).length
      matrix[scenario] ??= {}
      matrix[scenario][label] = scenarioRuns.length === 0 ? 0 : scenarioPassed / scenarioRuns.length
    }
  }

  models.sort((a, b) => b.passRate - a.passRate)
  return {
    suite: 'agent-tool-use-compare',
    generatedAt: new Date().toISOString(),
    scenarios,
    models,
    matrix,
  }
}

function renderComparisonMarkdown(report: LiveComparisonReport): string {
  const labels = report.models.map((model) => model.label)
  const lines = [
    '# Agent tool-use model comparison',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '| Model | Pass rate | Trials | Avg iterations | Avg latency | Tokens | Failed checks |',
    '| --- | ---: | ---: | ---: | ---: | ---: | --- |',
    ...report.models.map(
      (model) =>
        `| ${model.label} | ${(model.passRate * 100).toFixed(0)}% (${model.passed}/${model.trials}) | ${model.trials} | ${model.avgIterations.toFixed(1)} | ${Math.round(model.avgLatencyMs)}ms | ${model.totalTokens} | ${model.failedChecks.join(', ') || '—'} |`
    ),
    '',
    `| Scenario | ${labels.join(' | ')} |`,
    `| --- | ${labels.map(() => '---:').join(' | ')} |`,
    ...report.scenarios.map(
      (scenario) =>
        `| ${escapeCell(scenario)} | ${labels
          .map((label) => `${((report.matrix[scenario]?.[label] ?? 0) * 100).toFixed(0)}%`)
          .join(' | ')} |`
    ),
    '',
  ]
  return lines.join('\n')
}

/**
 * Writes the model-comparison JSON report and a sibling Markdown table.
 * Unlike the single-model report, this is a matrix: scenario × model pass rates.
 */
export function writeLiveComparisonReport(runs: LiveModelRun[], reportPath: string): void {
  const report = buildLiveComparisonReport(runs)
  mkdirSync(dirname(reportPath), { recursive: true })
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  writeFileSync(reportPath.replace(/\.json$/, '.md'), renderComparisonMarkdown(report))
}
