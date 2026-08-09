/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ execute: vi.fn() }))

vi.mock('@/lib/workflows/application/resolve-workflow-outputs', () => ({
  resolveWorkflowOutputs: { execute: mocks.execute },
}))

import { executeCopilotResolveWorkflowOutputs } from '@/lib/copilot/application/execute-workflow-use-case'

const trustedContext = {
  userId: 'user-1',
  workspaceId: 'workspace-1',
  chatId: 'chat-1',
  executionId: 'execution-1',
  toolCallId: 'tool-call-1',
  copilotToolExecution: true,
} as const

describe('executeCopilotResolveWorkflowOutputs', () => {
  afterEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('enters the fixed Workflow resolver with trusted Copilot identity', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    mocks.execute.mockResolvedValueOnce({
      workflowId: 'workflow-1',
      outputs: null,
      executionOrderByBlockId: {},
    })

    await expect(
      executeCopilotResolveWorkflowOutputs(trustedContext, {
        workflowId: 'workflow-1',
        assertedWorkspaceId: 'workspace-1',
      })
    ).resolves.toMatchObject({ workflowId: 'workflow-1' })

    expect(mocks.execute).toHaveBeenCalledWith({
      principal: {
        kind: 'delegated',
        serviceId: 'copilot',
        subjectUserId: 'user-1',
        workspaceId: 'workspace-1',
        delegationId: 'copilot-tool:tool-call-1',
        audience: 'sim:workflows',
        issuedAt: new Date('2026-01-01T00:00:00Z'),
        expiresAt: new Date('2026-01-01T00:05:00Z'),
        resourceScope: { chatId: 'chat-1', executionId: 'execution-1' },
      },
      input: { workflowId: 'workflow-1', assertedWorkspaceId: 'workspace-1' },
    })
  })

  it('rejects untrusted context before Workflow application execution', () => {
    expect(() =>
      executeCopilotResolveWorkflowOutputs(
        { ...trustedContext, copilotToolExecution: false },
        { workflowId: 'workflow-1', assertedWorkspaceId: 'workspace-1' }
      )
    ).toThrow('trusted Copilot execution context')
    expect(mocks.execute).not.toHaveBeenCalled()
  })
})
