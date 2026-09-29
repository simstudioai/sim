import { providersMock } from '@sim/testing/mocks/providers.mock'
import { providersConversationHistoryMock } from '@sim/testing/mocks/providers-conversation-history.mock'
import { providersUtilsMock } from '@sim/testing/mocks/providers-utils.mock'
import { toolsMock } from '@sim/testing/mocks/tools.mock'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { runScenario } from '@/evals/agent-tool-use/harness'
import { writeEvalReport } from '@/evals/agent-tool-use/report'
import { AGENT_TOOL_USE_SCENARIOS } from '@/evals/agent-tool-use/scenarios'
import type { AgentToolUseResult } from '@/evals/agent-tool-use/types'

vi.mock('@/providers/conversation-history', () => providersConversationHistoryMock)
vi.mock('@/tools', () => toolsMock)
vi.mock('@/providers/utils', () => providersUtilsMock)
vi.mock('@/providers', () => providersMock)

const results: AgentToolUseResult[] = []

afterAll(() => {
  const reportPath = process.env.EVAL_REPORT_PATH
  if (reportPath) writeEvalReport(results, reportPath)
})

describe('agent tool-use eval suite', () => {
  it.each(AGENT_TOOL_USE_SCENARIOS)('$id: $name', async (scenario) => {
    const result = await runScenario(scenario)
    results.push(result)

    const failed = result.checks.filter((entry) => !entry.passed)
    expect(
      failed,
      failed.map((entry) => `${entry.name}: ${entry.detail}`).join('; ') || undefined
    ).toEqual([])
  })
})
