/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCopilotWorkspaceUseCaseExecutor } from '@/lib/copilot/application/execute-workspace-use-case'

const operation = {
  id: 'skills.update',
  minimumRole: 'read' as const,
  workspaceApiKey: 'deny' as const,
  principalKinds: ['delegated'] as const,
  delegatedServices: ['copilot'] as const,
}

describe('Copilot workspace application delegation', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('builds a bounded principal from trusted runtime context, never tool input identity', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const execute = vi.fn().mockResolvedValue({ ok: true })
    const executeCopilotUseCase = createCopilotWorkspaceUseCaseExecutor({
      audience: 'sim:skills',
      operations: { update: operation },
    })

    await executeCopilotUseCase(
      {
        userId: 'trusted-user',
        workspaceId: 'workspace-1',
        chatId: 'chat-1',
        executionId: 'execution-1',
        toolCallId: 'call-1',
        copilotToolExecution: true,
      },
      { operation, execute },
      { userId: 'model-supplied-user', workspaceId: 'workspace-1' }
    )

    expect(execute).toHaveBeenCalledWith({
      principal: {
        kind: 'delegated',
        serviceId: 'copilot',
        subjectUserId: 'trusted-user',
        workspaceId: 'workspace-1',
        delegationId: 'copilot-tool:call-1',
        audience: 'sim:skills',
        issuedAt: new Date('2026-01-01T00:00:00Z'),
        expiresAt: new Date('2026-01-01T00:05:00Z'),
        resourceScope: { chatId: 'chat-1', executionId: 'execution-1' },
      },
      input: { userId: 'model-supplied-user', workspaceId: 'workspace-1' },
    })
  })

  it('fails fast for an untrusted execution context', async () => {
    const execute = vi.fn()
    const executeCopilotUseCase = createCopilotWorkspaceUseCaseExecutor({
      audience: 'sim:skills',
      operations: { update: operation },
    })

    expect(() =>
      executeCopilotUseCase(
        {
          userId: 'user-1',
          workspaceId: 'workspace-1',
          toolCallId: 'call-1',
          copilotToolExecution: false,
        },
        { operation, execute },
        { workspaceId: 'workspace-1' }
      )
    ).toThrow('trusted Copilot execution context')
    expect(execute).not.toHaveBeenCalled()
  })

  it('fails fast when a tool adapter tries an unregistered operation', () => {
    const executeCopilotUseCase = createCopilotWorkspaceUseCaseExecutor({
      audience: 'sim:skills',
      operations: { update: operation },
    })
    const unregistered = { ...operation, id: 'skills.unregistered' }

    expect(() =>
      executeCopilotUseCase(
        {
          userId: 'user-1',
          workspaceId: 'workspace-1',
          toolCallId: 'call-1',
          copilotToolExecution: true,
        },
        { operation: unregistered, execute: vi.fn() },
        { workspaceId: 'workspace-1' }
      )
    ).toThrow('Unregistered Copilot workspace operation')
  })
})
