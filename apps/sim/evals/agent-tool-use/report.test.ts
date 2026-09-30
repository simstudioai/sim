import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildLiveComparisonReport,
  type LiveModelRun,
  writeLiveComparisonReport,
} from '@/evals/agent-tool-use/report'
import type { AgentToolUseResult } from '@/evals/agent-tool-use/types'

function result(passed: boolean): AgentToolUseResult {
  return {
    id: 'scenario',
    name: 'scenario',
    category: 'recovery',
    passed,
    checks: [],
    finalContent: '',
    toolInvocations: [],
    metrics: {
      iterations: 1,
      toolCalls: 1,
      successfulToolCalls: 1,
      erroredToolCalls: 0,
      latencyMs: 10,
      modelTimeMs: 0,
      toolsTimeMs: 0,
      firstResponseTimeMs: 0,
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
    },
  }
}

function run(model: string, passed: boolean): LiveModelRun {
  return { provider: 'deepseek', model, scenarioId: 'scenario', result: result(passed) }
}

describe('model comparison report', () => {
  it('groups runs by model, sorts by pass rate, and fills the scenario matrix', () => {
    const report = buildLiveComparisonReport([
      run('chat', true),
      run('chat', true),
      run('reasoner', false),
      run('reasoner', true),
    ])

    expect(report.models.map((model) => model.label)).toEqual([
      'deepseek/chat',
      'deepseek/reasoner',
    ])
    expect(report.models[0]).toMatchObject({ passRate: 1, passed: 2, trials: 2 })
    expect(report.models[1]).toMatchObject({ passRate: 0.5, passed: 1, trials: 2 })
    expect(report.matrix.scenario['deepseek/chat']).toBe(1)
    expect(report.matrix.scenario['deepseek/reasoner']).toBe(0.5)
  })

  it('writes JSON and Markdown reports', () => {
    const directory = mkdtempSync(join(tmpdir(), 'eval-compare-'))
    try {
      const path = join(directory, 'compare.json')
      writeLiveComparisonReport([run('chat', true)], path)
      expect(existsSync(path)).toBe(true)
      expect(existsSync(join(directory, 'compare.md'))).toBe(true)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
