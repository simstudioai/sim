/**
 * @vitest-environment node
 */

import { describe, expect, it, vi } from 'vitest'
import { executeCopilotTableUseCase } from '@/lib/copilot/application/execute-table-use-case'
import { tableOperations } from '@/lib/table/application/operations'

const trustedContext = {
  userId: 'user-1',
  workspaceId: 'workspace-1',
  chatId: 'chat-1',
  executionId: 'execution-1',
  toolCallId: 'tool-call-1',
  copilotToolExecution: true,
} as const

describe('executeCopilotTableUseCase', () => {
  it('binds the in-process Copilot identity and exact table scope', async () => {
    const execute = vi.fn().mockResolvedValue({ id: 'table-1' })
    const useCase = { operation: tableOperations.read, execute }

    await expect(
      executeCopilotTableUseCase(
        trustedContext,
        useCase,
        { tableId: 'model-table' },
        {
          tableId: 'table-1',
        }
      )
    ).resolves.toEqual({ id: 'table-1' })

    expect(execute).toHaveBeenCalledWith({
      principal: expect.objectContaining({
        kind: 'delegated',
        serviceId: 'copilot',
        subjectUserId: 'user-1',
        workspaceId: 'workspace-1',
        audience: 'sim:tables',
        delegationId: 'copilot-tool:tool-call-1',
        resourceScope: {
          tableId: 'table-1',
          chatId: 'chat-1',
          executionId: 'execution-1',
        },
      }),
      input: { tableId: 'model-table' },
    })
  })

  it('creates an unscoped Table principal for workspace-level commands', async () => {
    const execute = vi.fn().mockResolvedValue({ ok: true })

    await executeCopilotTableUseCase(
      trustedContext,
      { operation: tableOperations.delete, execute },
      { workspaceId: 'workspace-1' }
    )

    expect(execute).toHaveBeenCalledWith({
      principal: expect.objectContaining({
        serviceId: 'copilot',
        resourceScope: { chatId: 'chat-1', executionId: 'execution-1' },
      }),
      input: { workspaceId: 'workspace-1' },
    })
  })

  it('rejects untrusted contexts and unregistered operation objects before execution', () => {
    const execute = vi.fn()
    const useCase = { operation: tableOperations.read, execute }

    expect(() =>
      executeCopilotTableUseCase(
        { ...trustedContext, copilotToolExecution: false },
        useCase,
        { tableId: 'table-1' },
        { tableId: 'table-1' }
      )
    ).toThrow('trusted Copilot execution context')

    expect(() =>
      executeCopilotTableUseCase(
        trustedContext,
        {
          operation: { ...tableOperations.read, minimumRole: 'write' },
          execute,
        },
        { tableId: 'table-1' },
        { tableId: 'table-1' }
      )
    ).toThrow('Unregistered Copilot table operation')
    expect(execute).not.toHaveBeenCalled()
  })
})
