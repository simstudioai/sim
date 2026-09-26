import type { WorkflowExecutionDelegatedPrincipal } from '@sim/auth/principal'
import { createTableDefinition } from '@sim/testing'
import {
  tableApplicationRowsMock,
  tableApplicationRowsMockFns,
} from '@sim/testing/mocks/table-application-rows.mock'
import { tableApplicationTablesMock } from '@sim/testing/mocks/table-application-tables.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/table/application/rows', () => tableApplicationRowsMock)

vi.mock('@/lib/table/application/tables', () => tableApplicationTablesMock)

import {
  executeTableQueryRows,
  executeTableUpdateRow,
  type TableToolOperationContext,
} from '@/lib/internal/table/operations'

const {
  mockCreateTableRows: createRows,
  mockQueryTableRows: queryRows,
  mockUpdateTableRow: updateRow,
} = tableApplicationRowsMockFns

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

const TABLE = createTableDefinition({
  id: 'table-1',
  workspaceId: 'workspace-canonical',
  columns: [{ id: 'column-1', name: 'Email', type: 'string' }],
})

const ROW = {
  id: 'row-1',
  data: { 'column-1': 'a@example.com' },
  position: 0,
  orderKey: 'a0',
  createdAt: new Date('2026-08-27T00:00:00.000Z'),
  updatedAt: new Date('2026-08-27T00:00:00.000Z'),
}

function operationContext(): TableToolOperationContext {
  return {
    principal: PRINCIPAL,
    headers: new Headers(),
    requestId: 'request-1',
  }
}

describe('Table direct operations', () => {
  beforeEach(() => {
    createRows.mockResolvedValue({ kind: 'single', table: TABLE, row: ROW })
    updateRow.mockResolvedValue({ table: TABLE, row: ROW, changed: true })
    queryRows.mockResolvedValue({
      table: TABLE,
      rows: [ROW],
      rowCount: 1,
      totalCount: 1,
      limit: 10,
      offset: 0,
      nextCursor: null,
    })
  })

  it('uses canonical principal workspace instead of the prepared body assertion', async () => {
    await executeTableUpdateRow(
      'table-1',
      'row-1',
      { workspaceId: 'workspace-forged', data: { Email: 'a@example.com' } },
      operationContext()
    )

    expect(updateRow).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: expect.objectContaining({
        tableId: 'table-1',
        rowId: 'row-1',
        assertedWorkspaceId: 'workspace-canonical',
        dataKeying: 'names',
        strictWrite: false,
        secretProvenanceEnvelope: { kind: 'none' },
      }),
    })
  })

  it('preserves legacy name-keyed filter, sort, count, and offset query semantics', async () => {
    await executeTableQueryRows(
      'table-1',
      {
        workspaceId: 'workspace-forged',
        filter: { Email: { $eq: 'a@example.com' } },
        sort: { Email: 'asc' },
        limit: 10,
        offset: 4,
        includeTotal: true,
      },
      operationContext()
    )

    expect(queryRows).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: expect.objectContaining({
        assertedWorkspaceId: 'workspace-canonical',
        legacyFilter: { Email: { $eq: 'a@example.com' } },
        legacySort: { Email: 'asc' },
        legacyKeying: 'names',
        limit: 10,
        offset: 4,
        includeTotal: true,
        includeRunState: true,
        allowExpandedLimit: true,
      }),
    })
  })
})
