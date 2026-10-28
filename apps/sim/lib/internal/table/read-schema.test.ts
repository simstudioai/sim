import type { WorkflowExecutionDelegatedPrincipal } from '@sim/auth/principal'
import {
  executorPrincipalMock,
  executorPrincipalMockFns,
} from '@sim/testing/mocks/executor-principal.mock'
import {
  tableApplicationTablesMock,
  tableApplicationTablesMockFns,
} from '@sim/testing/mocks/table-application-tables.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/internal/principals/executor', () => executorPrincipalMock)

vi.mock('@/lib/table/application/tables', () => tableApplicationTablesMock)

import { readTableSchemaAsExecutor } from '@/lib/internal/table/read-schema'

const mockCreatePrincipal = executorPrincipalMockFns.mockCreateExecutorPrincipalFromExecutionContext
const readTable = tableApplicationTablesMockFns.mockReadTableDefinitionUseCase

const PRINCIPAL: WorkflowExecutionDelegatedPrincipal = {
  kind: 'delegated',
  serviceId: 'executor',
  subjectUserId: 'user-1',
  workspaceId: 'workspace-canonical',
  delegationId: 'delegation-1',
  audience: 'sim:tables',
  issuedAt: new Date('2026-08-27T00:00:00.000Z'),
  expiresAt: new Date('2026-08-27T00:05:00.000Z'),
  resourceScope: { tableId: 'table-1' },
  delegationContext: { kind: 'workflow_execution', workflowId: 'workflow-1' },
}

describe('readTableSchemaAsExecutor', () => {
  beforeEach(() => {
    mockCreatePrincipal.mockResolvedValue(PRINCIPAL)
    readTable.mockResolvedValue({
      table: {
        name: 'Customers',
        schema: {
          columns: [
            { id: 'column-email', name: 'email', type: 'string' },
            { id: 'column-score', name: 'score', type: 'number' },
          ],
        },
      },
    })
  })

  it('binds the read to the canonical delegated workspace', async () => {
    const result = await readTableSchemaAsExecutor({
      tableId: 'table-1',
      context: {
        workflowId: 'workflow-1',
        executorDelegationOrigin: {
          subjectUserId: 'user-1',
          workflowId: 'workflow-1',
          executionId: 'execution-1',
        },
      },
    })

    expect(readTable).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: { tableId: 'table-1', workspaceId: 'workspace-canonical' },
    })
    expect(result).toEqual({
      name: 'Customers',
      columns: [
        { name: 'email', type: 'string' },
        { name: 'score', type: 'number' },
      ],
    })
  })

  it('fails closed when canonical schema metadata is malformed', async () => {
    readTable.mockResolvedValueOnce({
      table: { name: 'Customers', schema: { columns: [{ name: 'email', type: 'unknown' }] } },
    })

    await expect(
      readTableSchemaAsExecutor({
        tableId: 'table-1',
        context: {
          workflowId: 'workflow-1',
          executorDelegationOrigin: {
            subjectUserId: 'user-1',
            workflowId: 'workflow-1',
          },
        },
      })
    ).rejects.toThrow('Invalid table column 0 while enriching schema for table-1')
  })
})
