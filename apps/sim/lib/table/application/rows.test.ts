/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TableDefinition } from '@/lib/table/types'

const {
  mockReplaceRowsPrimitive,
  mockDeleteRowsByIds,
  mockQueryRows,
  mockRecordAudit,
  mockResolveContext,
  mockResolvePermission,
  mockSignalRowsChanged,
  mockUpsertRow,
} = vi.hoisted(() => ({
  mockReplaceRowsPrimitive: vi.fn(),
  mockDeleteRowsByIds: vi.fn(),
  mockQueryRows: vi.fn(),
  mockRecordAudit: vi.fn(),
  mockResolveContext: vi.fn(),
  mockResolvePermission: vi.fn(),
  mockSignalRowsChanged: vi.fn(),
  mockUpsertRow: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: { TABLE_UPDATED: 'table.updated' },
  AuditResourceType: { TABLE: 'table' },
  recordAudit: mockRecordAudit,
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null, required: string) => {
    const rank = { read: 1, write: 2, admin: 3 } as const
    return (
      actual !== null && rank[actual as keyof typeof rank] >= rank[required as keyof typeof rank]
    )
  },
  resolveEffectiveWorkspacePermission: mockResolvePermission,
}))

vi.mock('@/lib/table', () => ({
  TABLE_LIMITS: {
    MAX_BATCH_INSERT_SIZE: 1000,
    MAX_BULK_OPERATION_SIZE: 1000,
    MAX_QUERY_LIMIT: 1000,
  },
  batchInsertRows: vi.fn(),
  deleteRow: vi.fn(),
  deleteRowsByFilter: vi.fn(),
  deleteRowsByIds: mockDeleteRowsByIds,
  findRowMatches: vi.fn(),
  getRowById: vi.fn(),
  insertRow: vi.fn(),
  queryRows: mockQueryRows,
  replaceTableRows: mockReplaceRowsPrimitive,
  rowDataNameToId: (data: Record<string, unknown>, idByName: Map<string, string>) =>
    Object.fromEntries(
      Object.entries(data).flatMap(([name, value]) => {
        const id = idByName.get(name)
        return id ? [[id, value]] : []
      })
    ),
  sortSpecNamesToIds: vi.fn(),
  updateRow: vi.fn(),
  updateRowsByFilter: vi.fn(),
  upsertRow: mockUpsertRow,
  validateBatchRows: vi.fn(),
  validateRowData: vi.fn(),
}))

vi.mock('@/lib/table/application/context', () => ({
  resolveActiveTableContext: mockResolveContext,
}))

vi.mock('@/lib/table/events', () => ({
  signalTableRowsChanged: mockSignalRowsChanged,
}))

import {
  deleteTableRows,
  queryTableRows,
  replaceTableRows,
  TableRowsValidationError,
  upsertTableRow,
} from '@/lib/table/application/rows'

const TABLE: TableDefinition = {
  id: 'table-1',
  name: 'People',
  description: null,
  schema: { columns: [{ id: 'column-name', name: 'name', type: 'string' }] },
  metadata: null,
  rowCount: 2,
  maxRows: 10_000,
  workspaceId: 'workspace-canonical',
  createdBy: 'owner-1',
  archivedAt: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
}

const PRINCIPAL = { kind: 'session' as const, userId: 'user-1', sessionId: 'session-1' }

describe('replaceTableRows application use case', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolvePermission.mockResolvedValue('write')
    mockResolveContext.mockResolvedValue({
      tableId: TABLE.id,
      table: TABLE,
      workspaceId: TABLE.workspaceId,
      workspaceOrganizationId: 'organization-1',
      allowPersonalApiKeys: true,
      billedAccountUserId: 'billing-owner-1',
    })
    mockReplaceRowsPrimitive.mockResolvedValue({ deletedCount: 2, insertedCount: 1 })
  })

  it('uses canonical scope, stable column ids, and principal attribution', async () => {
    const result = await replaceTableRows.execute({
      principal: PRINCIPAL,
      input: {
        tableId: TABLE.id,
        assertedWorkspaceId: TABLE.workspaceId,
        requestId: 'request-1',
        rows: [{ name: 'Ada', unknown: 'dropped' }],
      },
    })

    expect(mockReplaceRowsPrimitive).toHaveBeenCalledWith(
      {
        tableId: TABLE.id,
        workspaceId: TABLE.workspaceId,
        rows: [{ 'column-name': 'Ada' }],
        userId: PRINCIPAL.userId,
        secretProvenance: undefined,
      },
      TABLE,
      'request-1'
    )
    expect(result).toMatchObject({ deletedCount: 2, insertedCount: 1 })
    expect(mockSignalRowsChanged).toHaveBeenCalledWith(TABLE.id)
  })

  it('rejects more than 10,000 rows before opening the atomic primitive', async () => {
    await expect(
      replaceTableRows.execute({
        principal: PRINCIPAL,
        input: {
          tableId: TABLE.id,
          rows: Array.from({ length: 10_001 }, () => ({})),
        },
      })
    ).rejects.toBeInstanceOf(TableRowsValidationError)
    expect(mockReplaceRowsPrimitive).not.toHaveBeenCalled()
  })

  it('fails fast on misaligned provenance', async () => {
    await expect(
      replaceTableRows.execute({
        principal: PRINCIPAL,
        input: {
          tableId: TABLE.id,
          rows: [{ name: 'Ada' }],
          secretProvenance: [],
        },
      })
    ).rejects.toThrow('Secret provenance must align one-to-one with rows')
    expect(mockReplaceRowsPrimitive).not.toHaveBeenCalled()
  })

  it('does not signal for an authoritative no-op result', async () => {
    mockReplaceRowsPrimitive.mockResolvedValue({ deletedCount: 0, insertedCount: 0 })

    await replaceTableRows.execute({
      principal: PRINCIPAL,
      input: { tableId: TABLE.id, rows: [] },
    })

    expect(mockSignalRowsChanged).not.toHaveBeenCalled()
  })

  it('propagates primitive infrastructure failures', async () => {
    mockReplaceRowsPrimitive.mockRejectedValue(new Error('database unavailable'))

    await expect(
      replaceTableRows.execute({
        principal: PRINCIPAL,
        input: { tableId: TABLE.id, rows: [] },
      })
    ).rejects.toThrow('database unavailable')
    expect(mockSignalRowsChanged).not.toHaveBeenCalled()
  })
})

describe('row query and upsert application semantics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolvePermission.mockResolvedValue('write')
    mockResolveContext.mockResolvedValue({
      tableId: TABLE.id,
      table: TABLE,
      workspaceId: TABLE.workspaceId,
      workspaceOrganizationId: 'organization-1',
      allowPersonalApiKeys: true,
      billedAccountUserId: 'billing-owner-1',
    })
  })

  it('rejects a malformed POST query cursor before querying storage', async () => {
    await expect(
      queryTableRows.execute({
        principal: PRINCIPAL,
        input: { tableId: TABLE.id, cursor: 'malformed', limit: 100 },
      })
    ).rejects.toMatchObject({ details: { code: 'INVALID_CURSOR' } })
    expect(mockQueryRows).not.toHaveBeenCalled()
  })

  it('audits only the authoritative deleted count and suppresses no-op audit', async () => {
    mockDeleteRowsByIds.mockResolvedValueOnce({
      deletedCount: 1,
      deletedRowIds: ['row-1'],
      requestedCount: 2,
      missingRowIds: ['missing-row'],
    })

    await deleteTableRows.execute({
      principal: PRINCIPAL,
      input: {
        kind: 'ids',
        tableId: TABLE.id,
        rowIds: ['row-1', 'missing-row'],
      },
    })

    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: TABLE.workspaceId,
        resourceId: TABLE.id,
        metadata: expect.objectContaining({
          operation: 'tables.rows.delete_many',
          rowsDeleted: 1,
        }),
      })
    )

    mockRecordAudit.mockClear()
    mockDeleteRowsByIds.mockResolvedValueOnce({
      deletedCount: 0,
      deletedRowIds: [],
      requestedCount: 1,
      missingRowIds: ['missing-row'],
    })
    await deleteTableRows.execute({
      principal: PRINCIPAL,
      input: { kind: 'ids', tableId: TABLE.id, rowIds: ['missing-row'] },
    })

    expect(mockRecordAudit).not.toHaveBeenCalled()
  })

  it('resolves a public upsert conflict-target name to its stable column id', async () => {
    mockUpsertRow.mockResolvedValue({
      operation: 'update',
      row: {
        id: 'row-1',
        data: { 'column-name': 'Ada' },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    })

    await upsertTableRow.execute({
      principal: PRINCIPAL,
      input: {
        tableId: TABLE.id,
        requestId: 'request-1',
        data: { name: 'Ada' },
        conflictTarget: 'name',
      },
    })

    expect(mockUpsertRow).toHaveBeenCalledWith(
      expect.objectContaining({
        tableId: TABLE.id,
        workspaceId: TABLE.workspaceId,
        data: { 'column-name': 'Ada' },
        conflictTarget: 'column-name',
        userId: PRINCIPAL.userId,
      }),
      TABLE,
      'request-1'
    )
  })
})
