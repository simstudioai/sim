import type { WorkflowExecutionDelegatedPrincipal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InvalidInternalDelegationBindingError } from '@/lib/auth/internal-delegation'
import type { ExecutionContext } from '@/executor/types'

const mocks = vi.hoisted(() => ({
  createPrincipal: vi.fn(),
  create: vi.fn(),
  list: vi.fn(),
  getSchema: vi.fn(),
  getRow: vi.fn(),
  insertRows: vi.fn(),
  queryRows: vi.fn(),
  queryRowsV2: vi.fn(),
  updateRow: vi.fn(),
  updateRowsByFilter: vi.fn(),
  deleteRow: vi.fn(),
  deleteRows: vi.fn(),
  upsertRow: vi.fn(),
}))

vi.mock('@/lib/internal/principals/executor', () => ({
  createExecutorPrincipalFromExecutionContext: mocks.createPrincipal,
}))

vi.mock('@/lib/internal/table/operations', () => ({
  executeTableCreate: mocks.create,
  executeTableList: mocks.list,
  executeTableGetSchema: mocks.getSchema,
  executeTableGetRow: mocks.getRow,
  executeTableInsertRows: mocks.insertRows,
  executeTableQueryRows: mocks.queryRows,
  executeTableQueryRowsV2: mocks.queryRowsV2,
  executeTableUpdateRow: mocks.updateRow,
  executeTableUpdateRowsByFilter: mocks.updateRowsByFilter,
  executeTableDeleteRow: mocks.deleteRow,
  executeTableDeleteRows: mocks.deleteRows,
  executeTableUpsertRow: mocks.upsertRow,
}))

import { executeTableTool } from '@/lib/internal/table/execute-tool'

const PRINCIPAL: WorkflowExecutionDelegatedPrincipal = {
  kind: 'delegated',
  serviceId: 'executor',
  subjectUserId: 'user-1',
  workspaceId: 'workspace-canonical',
  delegationId: 'delegation-1',
  audience: 'sim:tables',
  issuedAt: new Date('2026-08-27T00:00:00.000Z'),
  expiresAt: new Date('2026-08-27T00:05:00.000Z'),
  delegationContext: { kind: 'workflow_execution', workflowId: 'workflow-1' },
}

const CONTEXT = {
  workflowId: 'workflow-1',
  userId: 'user-1',
} as ExecutionContext

const WIRE_ROW = {
  id: 'row-1',
  data: { Email: 'a@example.com' },
  position: 0,
  createdAt: '2026-08-27T00:00:00.000Z',
  updatedAt: '2026-08-27T00:00:00.000Z',
}

describe('executeTableTool', () => {
  beforeEach(() => {
    mocks.createPrincipal.mockResolvedValue(PRINCIPAL)
    mocks.create.mockResolvedValue({
      body: { success: true, data: { table: {}, message: 'Table created successfully' } },
    })
    mocks.list.mockResolvedValue({
      body: { success: true, data: { tables: [], totalCount: 0 } },
    })
    mocks.getSchema.mockResolvedValue({
      body: { success: true, data: { table: {} } },
    })
    mocks.getRow.mockResolvedValue({
      body: { success: true, data: { row: WIRE_ROW } },
    })
    mocks.insertRows.mockImplementation(async (_tableId, body) => ({
      body:
        'rows' in body
          ? {
              success: true,
              data: { rows: [WIRE_ROW], insertedCount: 1, message: 'Rows inserted successfully' },
            }
          : {
              success: true,
              data: { row: WIRE_ROW, message: 'Row inserted successfully' },
            },
    }))
    mocks.queryRows.mockResolvedValue({
      body: {
        success: true,
        data: {
          rows: [WIRE_ROW],
          rowCount: 1,
          totalCount: 1,
          limit: 10,
          offset: 0,
          nextCursor: null,
        },
      },
    })
    mocks.queryRowsV2.mockResolvedValue({
      body: {
        success: true,
        data: { rows: [WIRE_ROW], rowCount: 1, totalCount: 1, limit: 10, nextCursor: null },
      },
    })
    mocks.updateRow.mockResolvedValue({
      body: { success: true, data: { row: WIRE_ROW, message: 'Row updated successfully' } },
    })
    mocks.updateRowsByFilter.mockResolvedValue({
      body: {
        success: true,
        data: { message: 'Rows updated successfully', updatedCount: 1, updatedRowIds: ['row-1'] },
      },
    })
    mocks.deleteRow.mockResolvedValue({
      body: { success: true, data: { message: 'Row deleted successfully', deletedCount: 1 } },
    })
    mocks.deleteRows.mockResolvedValue({
      body: {
        success: true,
        data: { message: 'Rows deleted successfully', deletedCount: 1, deletedRowIds: ['row-1'] },
      },
    })
    mocks.upsertRow.mockResolvedValue({
      body: {
        success: true,
        data: {
          row: WIRE_ROW,
          operation: 'insert',
          message: 'Row inserted successfully',
        },
      },
    })
  })

  it('projects a stale workflow binding as authentication failure', async () => {
    mocks.createPrincipal.mockRejectedValueOnce(new InvalidInternalDelegationBindingError())

    const response = await executeTableTool({
      toolId: 'table_list',
      input: { workspaceId: 'workspace-forged' },
      headers: new Headers(),
      context: CONTEXT,
      requestId: 'request-1',
    })

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Authentication required' })
  })
})
