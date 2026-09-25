import { createDelegatedPrincipal } from '@sim/testing/factories/principal.factory'
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import { tableMock, tableMockFns } from '@sim/testing/mocks/table.mock'
import {
  tableApplicationContextMock,
  tableApplicationContextMockFns,
} from '@sim/testing/mocks/table-application-context.mock'
import { tableEventsMock, tableEventsMockFns } from '@sim/testing/mocks/table-events.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TableDefinition } from '@/lib/table/types'

const hoisted = vi.hoisted(() => ({
  findUnmigrated: vi.fn(),
  performUpdate: vi.fn(),
}))

vi.mock('@sim/audit', () => auditMock)
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/table', () => ({
  ...tableMock,
  TABLE_LIMITS: { ...tableMock.TABLE_LIMITS, MAX_COLUMNS_PER_TABLE: 3 },
}))
vi.mock('@/lib/table/application/context', () => tableApplicationContextMock)
vi.mock('@/lib/table/columns/workflow-references', () => ({
  findUnmigratedTableBlockReferences: hoisted.findUnmigrated,
}))
vi.mock('@/lib/table/events', () => tableEventsMock)
vi.mock('@/lib/table/orchestration', () => ({ performUpdateTableColumn: hoisted.performUpdate }))

import {
  deleteTableColumnsUseCase,
  updateTableColumnUseCase,
} from '@/lib/table/application/columns'

const mocks = {
  ...hoisted,
  deleteColumns: tableMockFns.mockDeleteColumns,
  resolveContext: tableApplicationContextMockFns.mockResolveActiveTableContext,
  audit: auditMockFns.mockRecordAudit,
  resolvePermission: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
  signal: tableEventsMockFns.mockSignalTableSchemaChanged,
}

const table: TableDefinition = {
  id: 'table-1',
  name: 'People',
  description: null,
  schema: {
    columns: [
      { id: 'column-name', name: 'name', type: 'string' },
      { id: 'column-first', name: 'first', type: 'string' },
      { id: 'column-last', name: 'last', type: 'string' },
    ],
  },
  metadata: null,
  rowCount: 0,
  maxRows: 100,
  workspaceId: 'workspace-1',
  createdBy: 'owner-1',
  archivedAt: null,
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  updatedAt: new Date('2026-08-01T00:00:00.000Z'),
}
const principal = createDelegatedPrincipal({
  delegationId: 'copilot-tool:tool-1',
  audience: 'sim:tables',
  resourceScope: { tableId: 'table-1' },
})

const tableAfterDelete: TableDefinition = {
  ...table,
  schema: { columns: [{ id: 'column-name', name: 'name', type: 'string' }] },
  updatedAt: new Date('2026-08-02T00:00:00.000Z'),
}

describe('multi-column delete application use case', () => {
  beforeEach(() => {
    mocks.resolvePermission.mockResolvedValue('write')
    mocks.resolveContext.mockResolvedValue({
      tableId: table.id,
      table,
      workspaceId: table.workspaceId,
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'billing-owner-1',
    })
    mocks.deleteColumns.mockResolvedValue(tableAfterDelete)
  })

  it('derives aliases and duplicate references from the authoritative schema delta', async () => {
    mocks.deleteColumns.mockResolvedValue({
      ...table,
      schema: {
        columns: [
          { id: 'column-name', name: 'name', type: 'string' },
          { id: 'column-last', name: 'last', type: 'string' },
        ],
      },
    })

    const result = await deleteTableColumnsUseCase.execute({
      principal,
      input: {
        tableId: 'table-1',
        workspaceId: 'workspace-1',
        columnNames: ['first', 'column-first', 'FIRST'],
      },
    })

    expect(result.deletedColumns).toEqual([{ id: 'column-first', name: 'first' }])
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Deleted 1 column from table "People"',
        metadata: expect.objectContaining({ columnNames: ['first'] }),
      })
    )
  })

  it('rejects an oversized request before mutation', async () => {
    await expect(
      deleteTableColumnsUseCase.execute({
        principal,
        input: {
          tableId: 'table-1',
          workspaceId: 'workspace-1',
          columnNames: ['first', 'last', 'name', 'extra'],
        },
      })
    ).rejects.toMatchObject({ code: 'validation' })

    expect(mocks.deleteColumns).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
    expect(mocks.signal).not.toHaveBeenCalled()
  })

  it('rejects admission before mutation when delegated scope is stale', async () => {
    mocks.resolvePermission.mockResolvedValueOnce('read')

    await expect(
      deleteTableColumnsUseCase.execute({
        principal,
        input: {
          tableId: 'table-1',
          workspaceId: 'workspace-1',
          columnNames: ['first', 'last'],
        },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.deleteColumns).not.toHaveBeenCalled()
  })
})

/**
 * A rename leaves workflow Table blocks pointing at the old name — nothing
 * rewrites workflow state, lint stays clean, and the next run fails inside an
 * error edge. The use case reports those blocks so the caller can migrate them.
 */
describe('column rename application use case', () => {
  const unmigrated = [
    {
      workflowId: 'wf-1',
      workflowName: 'Alerts',
      blockId: 'blk-1',
      blockName: 'Query',
      fields: ['filter' as const],
    },
  ]

  beforeEach(() => {
    mocks.resolvePermission.mockResolvedValue('write')
    mocks.resolveContext.mockResolvedValue({
      tableId: table.id,
      table,
      workspaceId: table.workspaceId,
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'billing-owner-1',
    })
    mocks.findUnmigrated.mockResolvedValue(unmigrated)
  })

  function update(updates: { name?: string; required?: boolean }) {
    mocks.performUpdate.mockResolvedValue({
      success: true,
      table: {
        ...table,
        schema: {
          columns: table.schema.columns.map((column) =>
            column.name === 'first' ? { ...column, ...updates } : column
          ),
        },
      },
    })
    return updateTableColumnUseCase.execute({
      principal,
      input: { tableId: 'table-1', workspaceId: 'workspace-1', columnName: 'first', updates },
    })
  }

  it('reports the workflow Table blocks a rename did not migrate', async () => {
    const result = await update({ name: 'given' })

    expect(mocks.findUnmigrated).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      tableId: 'table-1',
      columnName: 'first',
    })
    expect(result.unmigrated).toEqual(unmigrated)
    expect(result.changed).toBe(true)
  })

  it('reports nothing rather than failing a rename that already committed when the scan fails', async () => {
    mocks.findUnmigrated.mockRejectedValue(new Error('workflow tables unavailable'))

    const result = await update({ name: 'given' })

    expect(result.unmigrated).toEqual([])
    expect(result.table.schema.columns[1].name).toBe('given')
  })
})
