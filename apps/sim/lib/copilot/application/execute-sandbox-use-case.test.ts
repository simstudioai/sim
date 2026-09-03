/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import { executeCopilotSandboxUseCase } from '@/lib/copilot/application/execute-sandbox-use-case'
import { customToolOperations } from '@/lib/custom-tools/application/operations'
import { sandboxOperations } from '@/lib/sandboxes/application/operations'

const trustedContext = {
  userId: 'user-1',
  workspaceId: 'workspace-1',
  chatId: 'chat-1',
  executionId: 'execution-1',
  toolCallId: 'tool-call-1',
  copilotToolExecution: true,
} as const

describe('executeCopilotSandboxUseCase', () => {
  it('normalizes trusted Copilot authority into the sandbox delegation', async () => {
    const execute = vi.fn().mockResolvedValue({ sandboxes: [] })
    const useCase = { operation: sandboxOperations.list, execute }
    const input = { workspaceId: trustedContext.workspaceId }

    await expect(executeCopilotSandboxUseCase(trustedContext, useCase, input)).resolves.toEqual({
      sandboxes: [],
    })
    expect(execute).toHaveBeenCalledWith({
      principal: expect.objectContaining({
        kind: 'delegated',
        serviceId: 'copilot',
        subjectUserId: trustedContext.userId,
        workspaceId: trustedContext.workspaceId,
        delegationId: `copilot-tool:${trustedContext.toolCallId}`,
        audience: 'sim:sandboxes',
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
    const useCase = { operation: sandboxOperations.create, execute }

    expect(() =>
      executeCopilotSandboxUseCase({ ...trustedContext, copilotToolExecution: false }, useCase, {
        workspaceId: trustedContext.workspaceId,
        name: 'data-tools',
        language: 'python',
        dependencies: [],
      })
    ).toThrow('trusted Copilot execution context')
    expect(execute).not.toHaveBeenCalled()
  })

  it("refuses a use case from another domain's registry", () => {
    const execute = vi.fn()
    const useCase = { operation: customToolOperations.list, execute }

    expect(() =>
      executeCopilotSandboxUseCase(trustedContext, useCase, {
        workspaceId: trustedContext.workspaceId,
      })
    ).toThrow('Unregistered Copilot sandbox operation')
    expect(execute).not.toHaveBeenCalled()
  })
})
