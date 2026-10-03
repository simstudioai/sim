import { fileURLToPath } from 'node:url'
import { providersMock } from '@sim/testing/mocks/providers.mock'
import { providersConversationHistoryMock } from '@sim/testing/mocks/providers-conversation-history.mock'
import { providersUtilsMock } from '@sim/testing/mocks/providers-utils.mock'
import { toolsMock } from '@sim/testing/mocks/tools.mock'
import type { ChatCompletionChunk } from 'openai/resources/chat/completions'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { runScenario } from '@/evals/agent-tool-use/harness'
import { createDeepSeekLiveCompletion } from '@/evals/agent-tool-use/live'
import {
  createRecordingCompletion,
  type ReplayFixture,
  writeReplayFixture,
} from '@/evals/agent-tool-use/replay'
import { writeLiveEvalReport } from '@/evals/agent-tool-use/report'
import { AGENT_TOOL_USE_SCENARIOS } from '@/evals/agent-tool-use/scenarios'
import type { AgentToolUseResult, LiveScenarioSummary } from '@/evals/agent-tool-use/types'

vi.mock('@/providers/conversation-history', () => providersConversationHistoryMock)
vi.mock('@/tools', () => toolsMock)
vi.mock('@/providers/utils', () => providersUtilsMock)
vi.mock('@/providers', () => providersMock)

/**
 * Live agent tool-use evals. Opt-in only:
 *
 *   EVAL_LIVE=1 DEEPSEEK_API_KEY=... \
 *     bun run --cwd apps/sim test --mode live evals/agent-tool-use/agent-tool-use.live.test.ts
 *
 * Each scenario runs `EVAL_TRIALS` times (default 3) because a real model is
 * nondeterministic. The report carries pass rates, not a single boolean. Set
 * `EVAL_MIN_PASS_RATE` (0–1) to turn a pass-rate floor into a failing gate.
 *
 * Add `EVAL_RECORD=1` to also write the first trial's transcript to
 * `fixtures/<scenario>.json`, which `agent-tool-use.replay.test.ts` replays
 * offline with no key.
 */
const LIVE = process.env.EVAL_LIVE === '1' && Boolean(process.env.DEEPSEEK_API_KEY)
const RECORD = process.env.EVAL_RECORD === '1'
const TRIALS = Number(process.env.EVAL_TRIALS ?? '3')
const MIN_PASS_RATE = Number(process.env.EVAL_MIN_PASS_RATE ?? '0')
const MODEL = process.env.EVAL_MODEL ?? 'deepseek-chat'
const TIMEOUT_MS = Number(process.env.EVAL_TIMEOUT_MS ?? '180000')
const FIXTURES_DIR = fileURLToPath(new URL('./fixtures', import.meta.url))

const liveScenarios = AGENT_TOOL_USE_SCENARIOS.filter((scenario) => !scenario.scriptedOnly)
const summaries: LiveScenarioSummary[] = []
const fixturesToWrite: ReplayFixture[] = []

afterAll(() => {
  if (!LIVE) return
  for (const fixture of fixturesToWrite) writeReplayFixture(FIXTURES_DIR, fixture)
  writeLiveEvalReport(
    summaries,
    process.env.EVAL_REPORT_PATH ?? 'test-results/evals/agent-tool-use-live.json'
  )
})

describe.skipIf(!LIVE)('agent tool-use eval suite (live DeepSeek)', () => {
  it.each(liveScenarios)(
    '$id: $name',
    async (scenario) => {
      const base = createDeepSeekLiveCompletion(MODEL)
      const results: AgentToolUseResult[] = []

      for (let trial = 0; trial < TRIALS; trial++) {
        const recordedTurns: ChatCompletionChunk[][] = []
        const completion =
          RECORD && trial === 0
            ? createRecordingCompletion(base, (turn) => recordedTurns.push(turn))
            : base

        results.push(
          await runScenario(scenario, {
            completion,
            mode: 'live',
            model: MODEL,
            providerName: 'DeepSeek',
          })
        )

        if (RECORD && trial === 0) {
          fixturesToWrite.push({
            scenarioId: scenario.id,
            model: MODEL,
            recordedAt: new Date().toISOString(),
            turns: recordedTurns,
          })
        }
      }

      const passed = results.filter((result) => result.passed).length
      const passRate = results.length === 0 ? 0 : passed / results.length
      summaries.push({
        id: scenario.id,
        name: scenario.name,
        category: scenario.category,
        trials: results.length,
        passed,
        passRate,
        results,
      })

      if (MIN_PASS_RATE > 0) {
        expect(
          passRate,
          `${scenario.id} passed ${passed}/${results.length} trials`
        ).toBeGreaterThanOrEqual(MIN_PASS_RATE)
      }
    },
    TIMEOUT_MS
  )
})
