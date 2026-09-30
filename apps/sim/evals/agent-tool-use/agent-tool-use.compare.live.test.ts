import { providersMock } from '@sim/testing/mocks/providers.mock'
import { providersConversationHistoryMock } from '@sim/testing/mocks/providers-conversation-history.mock'
import { providersUtilsMock } from '@sim/testing/mocks/providers-utils.mock'
import { toolsMock } from '@sim/testing/mocks/tools.mock'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { runScenario } from '@/evals/agent-tool-use/harness'
import { createLiveModelCompletion, parseLiveModels } from '@/evals/agent-tool-use/models'
import { type LiveModelRun, writeLiveComparisonReport } from '@/evals/agent-tool-use/report'
import { AGENT_TOOL_USE_SCENARIOS } from '@/evals/agent-tool-use/scenarios'

vi.mock('@/providers/conversation-history', () => providersConversationHistoryMock)
vi.mock('@/tools', () => toolsMock)
vi.mock('@/providers/utils', () => providersUtilsMock)
vi.mock('@/providers', () => providersMock)

/**
 * Compare the same scenarios across several models. Opt-in, never in CI:
 *
 *   EVAL_LIVE=1 EVAL_MODELS=deepseek:deepseek-chat,deepseek:deepseek-reasoner \
 *     bun run --cwd apps/sim test --mode live evals/agent-tool-use/agent-tool-use.compare.live.test.ts
 *
 * Each provider reads its key from `<PROVIDER>_API_KEY`; a bare model id
 * defaults to DeepSeek. The report is a scenario × model matrix plus per-model
 * pass rate, iterations, latency, and tokens. Set `EVAL_MIN_PASS_RATE` (0–1) to
 * fail a model below a pass-rate floor.
 */
const LIVE = process.env.EVAL_LIVE === '1'
const TRIALS = Number(process.env.EVAL_TRIALS ?? '3')
const MIN_PASS_RATE = Number(process.env.EVAL_MIN_PASS_RATE ?? '0')
const TIMEOUT_MS = Number(process.env.EVAL_TIMEOUT_MS ?? '180000')
const models = parseLiveModels(process.env.EVAL_MODELS)
const liveScenarios = AGENT_TOOL_USE_SCENARIOS.filter((scenario) => !scenario.scriptedOnly)

const runs: LiveModelRun[] = []

const cases = models.flatMap((spec) =>
  liveScenarios.map((scenario) => ({
    id: `${spec.provider.id}/${spec.model} · ${scenario.id}`,
    spec,
    scenario,
  }))
)

afterAll(() => {
  if (!LIVE || runs.length === 0) return
  writeLiveComparisonReport(
    runs,
    process.env.EVAL_COMPARE_REPORT_PATH ?? 'test-results/evals/agent-tool-use-compare.json'
  )
})

describe.skipIf(!LIVE)('agent tool-use model comparison', () => {
  it.each(cases)(
    '$id',
    async ({ spec, scenario }) => {
      const completion = createLiveModelCompletion(spec)
      for (let trial = 0; trial < TRIALS; trial++) {
        const result = await runScenario(scenario, {
          completion,
          mode: 'live',
          model: spec.model,
          providerName: spec.provider.label,
        })
        runs.push({
          provider: spec.provider.id,
          model: spec.model,
          scenarioId: scenario.id,
          result,
        })
      }
    },
    TIMEOUT_MS
  )

  it('meets the per-model pass-rate floor', () => {
    if (MIN_PASS_RATE <= 0 || runs.length === 0) return
    const byModel = new Map<string, { passed: number; total: number }>()
    for (const run of runs) {
      const key = `${run.provider}/${run.model}`
      const entry = byModel.get(key) ?? { passed: 0, total: 0 }
      entry.total += 1
      if (run.result.passed) entry.passed += 1
      byModel.set(key, entry)
    }
    for (const [model, entry] of byModel) {
      expect(
        entry.passed / entry.total,
        `${model} passed ${entry.passed}/${entry.total}`
      ).toBeGreaterThanOrEqual(MIN_PASS_RATE)
    }
  })
})
