/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TableDefinition } from '@/lib/table/types'

const {
  mockReplaceRowsPrimitive,
  mockDeleteRowsByIds,
  mockLoadSecretProvenance,
  mockAssertRowCapacity,
  mockNotifyTableRowUsage,
  mockQueryRows,
  mockRecordAudit,
  mockReplaceRowsWithTx,
  mockResolveContext,
  mockResolvePermission,
  mockSignalRowsChanged,
  mockUpsertRow,
  mockWithLockedTable,
} = vi.hoisted(() => ({
  mockReplaceRowsPrimitive: vi.fn(),
  mockDeleteRowsByIds: vi.fn(),
  mockLoadSecretProvenance: vi.fn(),
  mockAssertRowCapacity: vi.fn(),
  mockNotifyTableRowUsage: vi.fn(),
  mockQueryRows: vi.fn(),
  mockRecordAudit: vi.fn(),
  mockReplaceRowsWithTx: vi.fn(),
  mockResolveContext: vi.fn(),
  mockResolvePermission: vi.fn(),
  mockSignalRowsChanged: vi.fn(),
  mockUpsertRow: vi.fn(),
  mockWithLockedTable: vi.fn(),
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
  withLockedTable: mockWithLockedTable,
}))

vi.mock('@/lib/table/billing', () => ({
  assertRowCapacity: mockAssertRowCapacity,
  notifyTableRowUsage: mockNotifyTableRowUsage,
}))

vi.mock('@/lib/table/column-types', () => ({
  columnTypeOf: (column: { type: string }) => ({ id: column.type }),
}))

vi.mock('@/lib/table/rows/secret-provenance', () => ({
  createExactEmptyTableRowSecretProvenance: () => ({ complete: true, columns: {} }),
  loadTableRowSecretProvenance: mockLoadSecretProvenance,
}))

vi.mock('@/lib/table/rows/service', () => ({
  replaceTableRowsWithTx: mockReplaceRowsWithTx,
}))

vi.mock('@/lib/table/application/context', () => ({
  resolveActiveTableContext: mockResolveContext,
}))

vi.mock('@/lib/table/events', () => ({
  signalTableRowsChanged: mockSignalRowsChanged,
}))

import {
  deleteTableRows,
  ProjectedWireRowsValidationError,
  queryTableRows,
  replaceProjectedWireRows,
  replaceTableRows,
  TableRowsValidationError,
  tablePredicateNamesToFilter,
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

describe('table predicate translation', () => {
  it('maps invalid run filters to the shared row validation error', () => {
    expect(() =>
      tablePredicateNamesToFilter({ all: [{ field: 'missing', op: 'eq', value: 'ready' }] }, TABLE)
    ).toThrowError(
      expect.objectContaining({
        name: 'TableRowsValidationError',
        details: { code: 'INVALID_FILTER' },
      })
    )
  })
})

describe('replaceProjectedWireRows application command', () => {
  const freshTable: TableDefinition = {
    ...TABLE,
    schema: {
      columns: [
        { id: 'column-fresh', name: 'full_name', type: 'string' },
        { id: 'column-score', name: 'score', type: 'number' },
      ],
    },
  }
  const delegatedPrincipal = {
    kind: 'delegated' as const,
    serviceId: 'copilot' as const,
    subjectUserId: 'user-1',
    workspaceId: TABLE.workspaceId,
    delegationId: 'copilot-tool:tool-1',
    audience: 'sim:tables',
    issuedAt: new Date('2026-01-01'),
    expiresAt: new Date('2099-01-01'),
    resourceScope: { tableId: TABLE.id },
  }

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
    mockAssertRowCapacity.mockResolvedValue(10_000)
    mockWithLockedTable.mockImplementation(
      async (_tableId: string, run: (table: TableDefinition, trx: unknown) => unknown) =>
        run(freshTable, { kind: 'transaction' })
    )
    mockReplaceRowsWithTx.mockResolvedValue({ deletedCount: 2, insertedCount: 1 })
  })

  it('validates and replaces against the fresh schema held under the table lock', async () => {
    const result = await replaceProjectedWireRows.execute({
      principal: delegatedPrincipal,
      input: {
        tableId: TABLE.id,
        assertedWorkspaceId: TABLE.workspaceId,
        sourceRows: [{ full_name: 'Ada' }],
        projectedRows: [{ full_name: 'Ada' }],
        requestId: 'request-1',
      },
    })

    expect(mockWithLockedTable).toHaveBeenCalledWith(TABLE.id, expect.any(Function), {
      expectedWorkspaceId: TABLE.workspaceId,
    })
    expect(mockReplaceRowsWithTx).toHaveBeenCalledWith(
      { kind: 'transaction' },
      {
        tableId: TABLE.id,
        workspaceId: TABLE.workspaceId,
        rows: [{ 'column-fresh': 'Ada' }],
        userId: 'user-1',
        secretProvenance: [{ complete: true, columns: {} }],
      },
      freshTable,
      'request-1'
    )
    expect(result.table).toBe(freshTable)
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          operation: 'tables.rows.replace',
          rowsDeleted: 2,
          rowsInserted: 1,
        }),
      })
    )
    expect(mockSignalRowsChanged).toHaveBeenCalledWith(TABLE.id)
    expect(mockNotifyTableRowUsage).toHaveBeenCalledWith({
      workspaceId: TABLE.workspaceId,
      currentRowCount: 0,
      addedRows: 1,
      limit: 10_000,
    })
  })

  it('rejects a projected row that only matched the stale pre-lock schema', async () => {
    await expect(
      replaceProjectedWireRows.execute({
        principal: delegatedPrincipal,
        input: {
          tableId: TABLE.id,
          assertedWorkspaceId: TABLE.workspaceId,
          sourceRows: [{ name: 'Ada' }],
          projectedRows: [{ name: 'Ada' }],
        },
      })
    ).rejects.toBeInstanceOf(ProjectedWireRowsValidationError)

    expect(mockReplaceRowsWithTx).not.toHaveBeenCalled()
    expect(mockRecordAudit).not.toHaveBeenCalled()
    expect(mockSignalRowsChanged).not.toHaveBeenCalled()
  })

  it('rejects delegated table-scope mismatch before opening the mutation lock', async () => {
    await expect(
      replaceProjectedWireRows.execute({
        principal: {
          ...delegatedPrincipal,
          resourceScope: { tableId: 'table-other' },
        },
        input: {
          tableId: TABLE.id,
          sourceRows: [{ full_name: 'Ada' }],
          projectedRows: [{ full_name: 'Ada' }],
        },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mockWithLockedTable).not.toHaveBeenCalled()
    expect(mockReplaceRowsWithTx).not.toHaveBeenCalled()
  })

  it('does not audit or signal when the authoritative replacement is a no-op', async () => {
    mockReplaceRowsWithTx.mockResolvedValueOnce({ deletedCount: 0, insertedCount: 0 })

    await replaceProjectedWireRows.execute({
      principal: delegatedPrincipal,
      input: {
        tableId: TABLE.id,
        sourceRows: [{ full_name: 'Ada' }],
        projectedRows: [{ full_name: 'Ada' }],
      },
    })

    expect(mockRecordAudit).not.toHaveBeenCalled()
    expect(mockSignalRowsChanged).not.toHaveBeenCalled()
  })

  it('propagates replacement failures without audit or shared effects', async () => {
    const failure = new Error('database unavailable')
    mockReplaceRowsWithTx.mockRejectedValueOnce(failure)

    await expect(
      replaceProjectedWireRows.execute({
        principal: delegatedPrincipal,
        input: {
          tableId: TABLE.id,
          sourceRows: [{ full_name: 'Ada' }],
          projectedRows: [{ full_name: 'Ada' }],
        },
      })
    ).rejects.toBe(failure)

    expect(mockRecordAudit).not.toHaveBeenCalled()
    expect(mockSignalRowsChanged).not.toHaveBeenCalled()
    expect(mockNotifyTableRowUsage).not.toHaveBeenCalled()
  })
})

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

  it('rejects an oversized page before querying storage', async () => {
    await expect(
      queryTableRows.execute({
        principal: PRINCIPAL,
        input: { tableId: TABLE.id, limit: 1001 },
      })
    ).rejects.toMatchObject({ code: 'validation' })

    expect(mockQueryRows).not.toHaveBeenCalled()
    expect(mockLoadSecretProvenance).not.toHaveBeenCalled()
  })

  it('loads requested persisted provenance inside the authorized application query', async () => {
    const row = {
      id: 'row-1',
      tableId: TABLE.id,
      data: { 'column-name': 'Ada' },
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
    }
    const provenance = { complete: true, columns: {} }
    mockQueryRows.mockResolvedValueOnce({
      rows: [row],
      rowCount: 1,
      totalCount: null,
      nextCursor: null,
    })
    mockLoadSecretProvenance.mockResolvedValueOnce(provenance)

    const result = await queryTableRows.execute({
      principal: PRINCIPAL,
      input: {
        tableId: TABLE.id,
        limit: 10,
        includePersistedSecretProvenance: true,
      },
    })

    expect(mockLoadSecretProvenance).toHaveBeenCalledWith([row], {
      userId: 'user-1',
      workspaceId: TABLE.workspaceId,
    })
    expect(result.secretProvenance).toBe(provenance)
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
