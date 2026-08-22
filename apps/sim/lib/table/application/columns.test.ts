/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TableDefinition } from '@/lib/table/types'

const mocks = vi.hoisted(() => ({
  audit: vi.fn(),
  deleteColumns: vi.fn(),
  resolveContext: vi.fn(),
  resolvePermission: vi.fn(),
  signal: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: { TABLE_UPDATED: 'table.updated' },
  AuditResourceType: { TABLE: 'table' },
  recordAudit: mocks.audit,
}))
vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null, required: string) => {
    const rank = { read: 1, write: 2, admin: 3 } as const
    return (
      actual !== null && rank[actual as keyof typeof rank] >= rank[required as keyof typeof rank]
    )
  },
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))
vi.mock('@/lib/core/utils/request', () => ({ generateRequestId: () => 'request-1' }))
vi.mock('@/lib/table', () => ({
  TABLE_LIMITS: { MAX_COLUMNS_PER_TABLE: 3 },
  addTableColumn: vi.fn(),
  deleteColumn: vi.fn(),
  deleteColumns: mocks.deleteColumns,
  getColumnId: (column: { id?: string; name: string }) => column.id ?? column.name,
}))
vi.mock('@/lib/table/application/context', () => ({
  resolveActiveTableContext: mocks.resolveContext,
}))
vi.mock('@/lib/table/events', () => ({ signalTableSchemaChanged: mocks.signal }))
vi.mock('@/lib/table/orchestration', () => ({ performUpdateTableColumn: vi.fn() }))

import { deleteTableColumnsUseCase } from '@/lib/table/application/columns'

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
const principal = {
  kind: 'delegated' as const,
  serviceId: 'copilot',
  subjectUserId: 'user-1',
  workspaceId: 'workspace-1',
  delegationId: 'copilot-tool:tool-1',
  audience: 'sim:tables',
  issuedAt: new Date('2026-08-01T00:00:00.000Z'),
  expiresAt: new Date('2099-08-01T00:00:00.000Z'),
  resourceScope: { tableId: 'table-1' },
}

const tableAfterDelete: TableDefinition = {
  ...table,
  schema: { columns: [{ id: 'column-name', name: 'name', type: 'string' }] },
  updatedAt: new Date('2026-08-02T00:00:00.000Z'),
}

describe('multi-column delete application use case', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('owns canonical mutation, audit, and schema effects', async () => {
    const result = await deleteTableColumnsUseCase.execute({
      principal,
      input: {
        tableId: 'table-1',
        workspaceId: 'workspace-1',
        columnNames: ['first', 'last'],
      },
    })

    expect(mocks.deleteColumns).toHaveBeenCalledWith(
      { tableId: 'table-1', columnNames: ['first', 'last'] },
      'request-1',
      { expectedWorkspaceId: 'workspace-1' }
    )
    expect(result.deletedColumns).toEqual([
      { id: 'column-first', name: 'first' },
      { id: 'column-last', name: 'last' },
    ])
    expect(mocks.audit).toHaveBeenCalledTimes(1)
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Deleted 2 columns from table "People"',
        metadata: expect.objectContaining({ columnNames: ['first', 'last'] }),
      })
    )
    expect(mocks.signal).toHaveBeenCalledWith('table-1')
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
