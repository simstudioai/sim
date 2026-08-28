/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import { executeCopilotCustomToolUseCase } from '@/lib/copilot/application/execute-custom-tool-use-case'
import { customToolOperations } from '@/lib/custom-tools/application/operations'

const trustedContext = {
  userId: 'user-1',
  workspaceId: 'workspace-1',
  chatId: 'chat-1',
  executionId: 'execution-1',
  toolCallId: 'tool-call-1',
  copilotToolExecution: true,
} as const

describe('executeCopilotCustomToolUseCase', () => {
  it('normalizes trusted Copilot authority for available custom-tool lookup', async () => {
    const execute = vi.fn().mockResolvedValue({ tool: { id: 'tool-1' } })
    const useCase = {
      operation: customToolOperations.readAvailableByIdOrTitle,
      execute,
    }
    const input = {
      workspaceId: trustedContext.workspaceId,
      identifier: 'tool-1',
      lookup: 'id' as const,
    }

    await expect(executeCopilotCustomToolUseCase(trustedContext, useCase, input)).resolves.toEqual({
      tool: { id: 'tool-1' },
    })
    expect(execute).toHaveBeenCalledWith({
      principal: expect.objectContaining({
        kind: 'delegated',
        serviceId: 'copilot',
        subjectUserId: trustedContext.userId,
        workspaceId: trustedContext.workspaceId,
        delegationId: `copilot-tool:${trustedContext.toolCallId}`,
        audience: 'sim:custom-tools',
        resourceScope: expect.objectContaining({
          chatId: trustedContext.chatId,
          executionId: trustedContext.executionId,
        }),
      }),
      input,
    })
  })

  it('rejects an untrusted Copilot marker before application execution', () => {
    const execute = vi.fn()
    const useCase = {
      operation: customToolOperations.readAvailableByIdOrTitle,
      execute,
    }

    expect(() =>
      executeCopilotCustomToolUseCase({ ...trustedContext, copilotToolExecution: false }, useCase, {
        workspaceId: trustedContext.workspaceId,
        identifier: 'tool-1',
        lookup: 'id',
      })
    ).toThrow('trusted Copilot execution context')
    expect(execute).not.toHaveBeenCalled()
  })
})
