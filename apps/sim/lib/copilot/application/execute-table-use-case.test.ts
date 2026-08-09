/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { executeCopilotTableUseCase } from '@/lib/copilot/application/execute-table-use-case'
import { tableOperations } from '@/lib/table/application/operations'

const trustedContext = {
  userId: 'user-1',
  workspaceId: 'workspace-1',
  chatId: 'chat-1',
  executionId: 'execution-1',
  toolCallId: 'tool-call-1',
  copilotToolExecution: true,
}

describe('executeCopilotTableUseCase', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('uses the shared in-process Copilot identity with the table audience', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const execute = vi.fn().mockResolvedValue({ tableId: 'table-1' })

    await expect(
      executeCopilotTableUseCase(
        trustedContext,
        { operation: tableOperations.read, execute },
        { tableId: 'table-1', workspaceId: 'workspace-1' }
      )
    ).resolves.toEqual({ tableId: 'table-1' })

    expect(execute).toHaveBeenCalledWith({
      principal: {
        kind: 'delegated',
        serviceId: 'copilot',
        subjectUserId: 'user-1',
        workspaceId: 'workspace-1',
        delegationId: 'copilot-tool:tool-call-1',
        audience: 'sim:tables',
        issuedAt: new Date('2026-01-01T00:00:00Z'),
        expiresAt: new Date('2026-01-01T00:05:00Z'),
        resourceScope: { chatId: 'chat-1', executionId: 'execution-1' },
      },
      input: { tableId: 'table-1', workspaceId: 'workspace-1' },
    })
  })

  it('rejects untrusted Copilot context before application execution', () => {
    const execute = vi.fn()

    expect(() =>
      executeCopilotTableUseCase(
        { ...trustedContext, copilotToolExecution: false },
        { operation: tableOperations.read, execute },
        { tableId: 'table-1', workspaceId: 'workspace-1' }
      )
    ).toThrow('trusted Copilot execution context')
    expect(execute).not.toHaveBeenCalled()
  })
})
