import {
  permissionCheckMock,
  permissionCheckMockFns,
} from '@sim/testing/mocks/permission-check.mock'
import { providersMock } from '@sim/testing/mocks/providers.mock'
import { providersConversationHistoryMock } from '@sim/testing/mocks/providers-conversation-history.mock'
import { providersUtilsMock, providersUtilsMockFns } from '@sim/testing/mocks/providers-utils.mock'
import { toolsMock } from '@sim/testing/mocks/tools.mock'
import { workspaceFileSecretProvenanceMock } from '@sim/testing/mocks/workspace-file-secret-provenance.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AGENT_CONTEXT_SCENARIOS } from '@/evals/agent-context/scenarios'
import { runExecutorScenario } from '@/evals/agent-tool-use/executor-harness'
import { writeEvalReport } from '@/evals/agent-tool-use/report'
import type { AgentToolUseResult } from '@/evals/agent-tool-use/types'

vi.mock('@/providers/conversation-history', () => providersConversationHistoryMock)
vi.mock('@/tools', () => toolsMock)
vi.mock('@/providers/utils', () => providersUtilsMock)
vi.mock('@/providers', () => providersMock)
vi.mock('@/ee/access-control/utils/permission-check', () => permissionCheckMock)
vi.mock(
  '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance',
  () => workspaceFileSecretProvenanceMock
)
vi.mock('@/lib/memory/agent-turn-session', () => ({
  openAgentTurnSession: vi.fn(async () => undefined),
}))
vi.mock('@/lib/internal/mcp/discover-tools', () => ({
  discoverMcpServerToolsAsExecutor: vi.fn(async () => []),
}))
vi.mock('@/lib/internal/custom-tools/read-available-by-id-or-title', () => ({
  readAvailableCustomToolByIdOrTitleAsExecutor: vi.fn(async () => undefined),
}))
vi.mock('@/executor/utils/http', () => ({
  buildAuthHeaders: vi.fn(async () => ({ 'Content-Type': 'application/json' })),
  buildAPIUrl: vi.fn((path: string) => path),
  extractAPIErrorMessage: vi.fn(async () => 'request failed'),
}))
vi.mock('@/lib/execution/cancellation', () => ({
  subscribeToExecutionCancellation: vi.fn(async () => () => {}),
  isExecutionCancelled: vi.fn(async () => false),
}))

const results: AgentToolUseResult[] = []

beforeEach(() => {
  permissionCheckMockFns.mockValidateModelProvider.mockResolvedValue(undefined)
  providersUtilsMockFns.mockGetProviderFromModel.mockReturnValue('mock-provider')
})

afterAll(() => {
  const reportPath = process.env.EVAL_CONTEXT_REPORT_PATH
  if (reportPath) writeEvalReport(results, reportPath)
})

describe('agent context eval suite', () => {
  it.each(AGENT_CONTEXT_SCENARIOS)('$id: $name', async (scenario) => {
    const result = await runExecutorScenario(scenario)
    results.push(result)

    const failed = result.checks.filter((entry) => !entry.passed)
    expect(
      failed,
      failed.map((entry) => `${entry.name}: ${entry.detail}`).join('; ') || undefined
    ).toEqual([])
  })
})
