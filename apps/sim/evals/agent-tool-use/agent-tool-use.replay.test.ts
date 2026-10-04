import { fileURLToPath } from 'node:url'
import { providersMock } from '@sim/testing/mocks/providers.mock'
import { providersConversationHistoryMock } from '@sim/testing/mocks/providers-conversation-history.mock'
import { providersUtilsMock } from '@sim/testing/mocks/providers-utils.mock'
import { toolsMock } from '@sim/testing/mocks/tools.mock'
import { describe, expect, it, vi } from 'vitest'
import { runScenario } from '@/evals/agent-tool-use/harness'
import {
  createReplayCompletion,
  listReplayFixtures,
  type ReplayFixture,
} from '@/evals/agent-tool-use/replay'
import { AGENT_TOOL_USE_SCENARIOS } from '@/evals/agent-tool-use/scenarios'
import type { AgentToolUseScenario } from '@/evals/agent-tool-use/types'

vi.mock('@/providers/conversation-history', () => providersConversationHistoryMock)
vi.mock('@/tools', () => toolsMock)
vi.mock('@/providers/utils', () => providersUtilsMock)
vi.mock('@/providers', () => providersMock)

/**
 * Replays recorded live transcripts through the real tool loop — no key, no
 * network. Fixtures are written by the live suite with `EVAL_RECORD=1`; see the
 * README. The suite skips until at least one fixture is committed.
 */
const FIXTURES_DIR = fileURLToPath(new URL('./fixtures', import.meta.url))

const replayCases: Array<{
  id: string
  fixture: ReplayFixture
  scenario: AgentToolUseScenario
}> = []
for (const fixture of listReplayFixtures(FIXTURES_DIR)) {
  const scenario = AGENT_TOOL_USE_SCENARIOS.find((candidate) => candidate.id === fixture.scenarioId)
  if (scenario) replayCases.push({ id: fixture.scenarioId, fixture, scenario })
}

describe.skipIf(replayCases.length === 0)('agent tool-use replay suite', () => {
  it.each(replayCases)('$id replays deterministically', async ({ fixture, scenario }) => {
    const result = await runScenario(scenario, {
      completion: createReplayCompletion(fixture.turns),
      mode: 'live',
      model: fixture.model,
      providerName: 'Replay',
      ...(scenario.judge && fixture.judgeTurns
        ? {
            judge: {
              completion: createReplayCompletion(fixture.judgeTurns),
              model: fixture.judgeModel ?? 'replay-judge',
              rubric: scenario.judge,
            },
          }
        : {}),
    })

    const failed = result.checks.filter((entry) => !entry.passed)
    expect(
      failed,
      failed.map((entry) => `${entry.name}: ${entry.detail}`).join('; ') || undefined
    ).toEqual([])
  })
})
