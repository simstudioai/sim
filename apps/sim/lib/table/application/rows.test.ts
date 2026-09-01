/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestRuntimePrincipal } from '@/lib/auth/runtime-principal.test-support'
import type { TableDefinition } from '@/lib/table/types'

const {
  mockReplaceRowsPrimitive,
  mockDeleteRowsByIds,
  mockCreateSecretProvenance,
  mockIsScopeCompatible,
  mockLoadSecretProvenance,
  mockAssertRowCapacity,
  mockNotifyTableRowUsage,
  mockQueryRows,
  mockRecordAudit,
  mockReplaceRowsWithTx,
  mockResolveContext,
  mockResolvePermission,
  mockSignalRowsChanged,
  mockSignalRowsChangedByActor,
  mockUpsertRow,
  mockWithLockedTable,
  mockInsertRow,
  mockBatchInsertRows,
  mockUpdateRow,
  mockUpdateRowsByFilter,
  mockValidateRowData,
  mockValidateBatchRows,
  mockBatchUpdateRows,
  mockGetRowSummaryById,
  mockLoadExecutionsForRow,
  mockLoadEnrichmentDetail,
  mockIsFeatureEnabled,
  mockGetWorkspaceOrganizationId,
} = vi.hoisted(() => ({
  mockReplaceRowsPrimitive: vi.fn(),
  mockDeleteRowsByIds: vi.fn(),
  mockCreateSecretProvenance: vi.fn(),
  mockIsScopeCompatible: vi.fn(),
  mockLoadSecretProvenance: vi.fn(),
  mockAssertRowCapacity: vi.fn(),
  mockNotifyTableRowUsage: vi.fn(),
  mockQueryRows: vi.fn(),
  mockRecordAudit: vi.fn(),
  mockReplaceRowsWithTx: vi.fn(),
  mockResolveContext: vi.fn(),
  mockResolvePermission: vi.fn(),
  mockSignalRowsChanged: vi.fn(),
  mockSignalRowsChangedByActor: vi.fn(),
  mockUpsertRow: vi.fn(),
  mockWithLockedTable: vi.fn(),
  mockInsertRow: vi.fn(),
  mockBatchInsertRows: vi.fn(),
  mockUpdateRow: vi.fn(),
  mockUpdateRowsByFilter: vi.fn(),
  mockValidateRowData: vi.fn(),
  mockValidateBatchRows: vi.fn(),
  mockBatchUpdateRows: vi.fn(),
  mockGetRowSummaryById: vi.fn(),
  mockLoadExecutionsForRow: vi.fn(),
  mockLoadEnrichmentDetail: vi.fn(),
  mockIsFeatureEnabled: vi.fn(),
  mockGetWorkspaceOrganizationId: vi.fn(),
}))

vi.mock('@/lib/core/config/feature-flags', () => ({
  isFeatureEnabled: mockIsFeatureEnabled,
}))

vi.mock('@/lib/workspaces/utils', () => ({
  getWorkspaceOrganizationId: mockGetWorkspaceOrganizationId,
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
    MAX_ROW_RUN_STATE_BYTES: 256,
  },
  batchInsertRows: mockBatchInsertRows,
  batchUpdateRows: mockBatchUpdateRows,
  deleteRow: vi.fn(),
  deleteRowsByFilter: vi.fn(),
  deleteRowsByIds: mockDeleteRowsByIds,
  findRowMatches: vi.fn(),
  getRowById: vi.fn(),
  getRowSummaryById: mockGetRowSummaryById,
  insertRow: mockInsertRow,
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
  updateRow: mockUpdateRow,
  updateRowsByFilter: mockUpdateRowsByFilter,
  upsertRow: mockUpsertRow,
  validateBatchRows: mockValidateBatchRows,
  validateRowData: mockValidateRowData,
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
  createTableRowSecretProvenanceFromRegistry: mockCreateSecretProvenance,
  createExactEmptyTableRowSecretProvenance: (data: Record<string, unknown>) => ({
    complete: true,
    columns: Object.fromEntries(
      Object.keys(data).map((columnId) => [columnId, { version: 1, complete: true, entries: [] }])
    ),
  }),
  createUnknownTableRowSecretProvenance: () => ({ complete: false, columns: {} }),
  loadTableRowSecretProvenance: mockLoadSecretProvenance,
}))

vi.mock('@/lib/table/validation', () => ({
  coerceRowValues: vi.fn(),
}))

vi.mock('@/lib/execution/durable-secret-provenance', () => ({
  isPrivateSecretProvenanceScopeCompatible: mockIsScopeCompatible,
}))

vi.mock('@/lib/table/rows/service', () => ({
  replaceTableRowsWithTx: mockReplaceRowsWithTx,
}))

vi.mock('@/lib/table/application/context', () => ({
  resolveActiveTableContext: mockResolveContext,
}))

vi.mock('@/lib/table/import', () => ({
  CSV_MAX_BATCH_SIZE: 5000,
}))

vi.mock('@/lib/table/rows/executions', () => ({
  loadEnrichmentDetail: mockLoadEnrichmentDetail,
  loadExecutionsForRow: mockLoadExecutionsForRow,
}))

vi.mock('@/lib/table/events', () => ({
  signalTableRowsChanged: mockSignalRowsChanged,
  signalTableRowsChangedByActor: mockSignalRowsChangedByActor,
}))

import { TABLE_LIMITS } from '@/lib/table'
import {
  batchUpdateTableRows,
  createTableRows,
  deleteTableRows,
  listTableRows,
  ProjectedWireRowsValidationError,
  queryTableRows,
  readTableRow,
  readTableRowEnrichmentDetail,
  replaceProjectedWireRows,
  replaceTableRows,
  TableRowsValidationError,
  tablePredicateNamesToFilter,
  updateTableRow,
  updateTableRows,
  upsertTableRow,
} from '@/lib/table/application/rows'
import { CSV_MAX_BATCH_SIZE } from '@/lib/table/import'
import { encodeCursor } from '@/lib/table/rows/cursor'

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
const GENERIC_WEBHOOK_EXECUTOR = createTestRuntimePrincipal({
  principal: {
    kind: 'system',
    serviceId: 'webhook',
    workspaceId: TABLE.workspaceId,
    workflowId: 'workflow-1',
    webhookId: 'webhook-1',
    provider: 'generic',
  },
  currentWorkflow: {
    workflowId: 'workflow-1',
    mode: 'deployment',
    deploymentVersionId: 'deployment-1',
  },
})

/**
 * The active-table context every row command resolves before it does any work.
 * Pass a variant table when a test needs a different schema — the surrounding
 * workspace scope is the same for every command under test.
 */
function contextFor(table: TableDefinition = TABLE) {
  return {
    tableId: table.id,
    table,
    workspaceId: table.workspaceId,
    workspaceOrganizationId: 'organization-1',
    allowPersonalApiKeys: true,
    billedAccountUserId: 'billing-owner-1',
  }
}

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
    mockResolveContext.mockResolvedValue(contextFor())
    mockAssertRowCapacity.mockResolvedValue(10_000)
    mockWithLockedTable.mockImplementation(
      async (_tableId: string, run: (table: TableDefinition, trx: unknown) => unknown) =>
        run(freshTable, { kind: 'transaction' })
    )
    mockReplaceRowsWithTx.mockResolvedValue({ deletedCount: 2, insertedCount: 1 })
    mockCreateSecretProvenance.mockReturnValue({ complete: true, columns: {} })
    mockIsScopeCompatible.mockReturnValue(true)
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
        secretProvenance: [
          {
            complete: true,
            columns: { 'column-fresh': { version: 1, complete: true, entries: [] } },
          },
        ],
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

  it('derives projected-row provenance inside the authorized locked operation', async () => {
    const registry = { kind: 'resolved-secret-registry' }
    const provenance = {
      complete: true,
      columns: {
        'column-fresh': {
          entries: [{ encryptedValue: 'ciphertext' }],
          scope: { userId: 'user-1', workspaceId: TABLE.workspaceId },
        },
      },
    }
    mockCreateSecretProvenance.mockReturnValue(provenance)

    await replaceProjectedWireRows.execute({
      principal: delegatedPrincipal,
      input: {
        tableId: TABLE.id,
        sourceRows: [{ full_name: 'secret-value' }],
        projectedRows: [{ full_name: 'secret-value' }],
        secretProvenance: {
          mode: 'resolved_output',
          registry: registry as never,
        },
      },
    })

    expect(mockCreateSecretProvenance).toHaveBeenCalledWith(
      { 'column-fresh': 'secret-value' },
      registry
    )
    expect(mockIsScopeCompatible).toHaveBeenCalledWith(
      { userId: 'user-1', workspaceId: TABLE.workspaceId },
      { workspaceId: TABLE.workspaceId }
    )
    expect(mockReplaceRowsWithTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ secretProvenance: [provenance] }),
      freshTable,
      expect.any(String)
    )
  })

  it('stores unknown provenance when the authoritative destination rejects the source scope', async () => {
    const registry = { kind: 'resolved-secret-registry' }
    mockCreateSecretProvenance.mockReturnValue({
      complete: true,
      columns: {
        'column-fresh': {
          entries: [{ encryptedValue: 'ciphertext' }],
          scope: { userId: 'user-1', workspaceId: 'workspace-other' },
        },
      },
    })
    mockIsScopeCompatible.mockReturnValue(false)

    await replaceProjectedWireRows.execute({
      principal: delegatedPrincipal,
      input: {
        tableId: TABLE.id,
        sourceRows: [{ full_name: 'secret-value' }],
        projectedRows: [{ full_name: 'secret-value' }],
        secretProvenance: {
          mode: 'resolved_output',
          registry: registry as never,
        },
      },
    })

    expect(mockIsScopeCompatible).toHaveBeenCalledWith(
      { userId: 'user-1', workspaceId: 'workspace-other' },
      { workspaceId: TABLE.workspaceId }
    )
    expect(mockReplaceRowsWithTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ secretProvenance: [{ complete: false, columns: {} }] }),
      freshTable,
      expect.any(String)
    )
  })

  it('stores unknown provenance when resolved output lacks a trace registry', async () => {
    await replaceProjectedWireRows.execute({
      principal: delegatedPrincipal,
      input: {
        tableId: TABLE.id,
        sourceRows: [{ full_name: 'value' }],
        projectedRows: [{ full_name: 'value' }],
        secretProvenance: { mode: 'resolved_output' },
      },
    })

    expect(mockCreateSecretProvenance).not.toHaveBeenCalled()
    expect(mockReplaceRowsWithTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ secretProvenance: [{ complete: false, columns: {} }] }),
      freshTable,
      expect.any(String)
    )
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
    mockResolveContext.mockResolvedValue(contextFor())
    mockReplaceRowsPrimitive.mockResolvedValue({ deletedCount: 2, insertedCount: 1 })
  })

  it('uses canonical scope, stable column ids, and principal attribution', async () => {
    const result = await replaceTableRows.execute({
      principal: PRINCIPAL,
      input: {
        tableId: TABLE.id,
        assertedWorkspaceId: TABLE.workspaceId,
        requestId: 'request-1',
        rows: [{ name: 'Ada' }],
      },
    })

    expect(mockReplaceRowsPrimitive).toHaveBeenCalledWith(
      {
        tableId: TABLE.id,
        workspaceId: TABLE.workspaceId,
        rows: [{ 'column-name': 'Ada' }],
        userId: PRINCIPAL.userId,
        secretProvenance: [
          {
            complete: true,
            columns: { 'column-name': { version: 1, complete: true, entries: [] } },
          },
        ],
      },
      TABLE,
      'request-1',
      {}
    )
    expect(result).toMatchObject({ deletedCount: 2, insertedCount: 1 })
    expect(mockSignalRowsChanged).toHaveBeenCalledWith(TABLE.id)
  })

  it('refuses a replacement row naming an unknown column for a strict caller', async () => {
    await expect(
      replaceTableRows.execute({
        principal: PRINCIPAL,
        input: {
          tableId: TABLE.id,
          rows: [{ name: 'Ada', unknown: 'x' }],
          strictWrite: true,
          dataKeying: 'names',
        },
      })
    ).rejects.toThrow(/Row 1: Unknown column: unknown/)
    expect(mockReplaceRowsPrimitive).not.toHaveBeenCalled()
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
    mockResolveContext.mockResolvedValue(contextFor())
    mockIsFeatureEnabled.mockResolvedValue(true)
    mockGetWorkspaceOrganizationId.mockResolvedValue('organization-1')
  })

  it('preserves storage-keyed predicates and sort specs for the session row route', async () => {
    const storageTable = {
      ...TABLE,
      schema: { columns: [{ id: 'column_name', name: 'name', type: 'string' as const }] },
    }
    mockResolveContext.mockResolvedValueOnce(contextFor(storageTable))
    mockQueryRows.mockResolvedValueOnce({
      rows: [],
      rowCount: 0,
      totalCount: null,
      limit: 25,
      offset: 0,
      nextCursor: null,
    })

    await queryTableRows.execute({
      principal: PRINCIPAL,
      input: {
        tableId: TABLE.id,
        predicate: { field: 'column_name', op: 'eq', value: 'Ada' },
        sort: [{ field: 'column_name', direction: 'asc' }],
        legacyKeying: 'ids',
        limit: 25,
      },
    })

    expect(mockQueryRows).toHaveBeenCalledWith(
      storageTable,
      expect.objectContaining({
        predicate: { field: 'column_name', op: 'eq', value: 'Ada' },
        sort: { column_name: 'asc' },
      }),
      expect.any(String)
    )
  })

  it('checks the v2 feature gate against the canonical authorized workspace', async () => {
    mockIsFeatureEnabled.mockResolvedValueOnce(false)

    await expect(
      queryTableRows.execute({
        principal: PRINCIPAL,
        input: { tableId: TABLE.id, limit: 25, requireV2Feature: true },
      })
    ).rejects.toMatchObject({
      code: 'forbidden',
      message: 'The v2 table query API is not enabled for this workspace',
    })

    expect(mockGetWorkspaceOrganizationId).toHaveBeenCalledWith(TABLE.workspaceId)
    expect(mockIsFeatureEnabled).toHaveBeenCalledWith('tables-v2-api', {
      userId: PRINCIPAL.userId,
      orgId: 'organization-1',
    })
    expect(mockQueryRows).not.toHaveBeenCalled()
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

  it('rejects a malformed list cursor before querying storage', async () => {
    await expect(
      listTableRows.execute({
        principal: PRINCIPAL,
        input: { tableId: TABLE.id, limit: 25, cursor: 'malformed' },
      })
    ).rejects.toMatchObject({ details: { code: 'INVALID_CURSOR' } })

    expect(mockQueryRows).not.toHaveBeenCalled()
  })

  it('passes the native row cursor through a short list page', async () => {
    const cursor = encodeCursor({
      lastRow: { id: 'row-50', orderKey: 'a50' },
      keysetValid: true,
      nextOffset: 50,
    })
    mockQueryRows.mockResolvedValueOnce({
      rows: [{ id: 'row-51', data: {} }],
      rowCount: 1,
      totalCount: null,
      nextCursor: 'native-next-cursor',
    })

    const result = await listTableRows.execute({
      principal: PRINCIPAL,
      input: { tableId: TABLE.id, limit: 25, cursor },
    })

    expect(mockQueryRows).toHaveBeenCalledWith(
      TABLE,
      {
        limit: 25,
        after: { id: 'row-50', orderKey: 'a50' },
        offset: undefined,
        includeTotal: false,
        withExecutions: false,
        runStateBudgetBytes: TABLE_LIMITS.MAX_ROW_RUN_STATE_BYTES,
      },
      expect.any(String)
    )
    expect(result.nextCursor).toBe('native-next-cursor')
  })

  /**
   * An offset cursor names a position in one filtered sequence. Replayed under a
   * different predicate that ordinal belongs to a sequence the caller never asked
   * for — page 2 of the archived rows, or an empty page the caller reads as "no
   * more matches". It must be refused, exactly as a changed sort already is.
   */
  it('refuses an offset cursor replayed under a different predicate', async () => {
    const cursor = encodeCursor({
      lastRow: { id: 'row-100', orderKey: null },
      keysetValid: false,
      nextOffset: 100,
      predicate: { all: [{ field: 'column-name', op: 'eq', value: 'Ada' }] },
    })

    await expect(
      queryTableRows.execute({
        principal: PRINCIPAL,
        input: {
          tableId: TABLE.id,
          cursor,
          predicate: { all: [{ field: 'name', op: 'eq', value: 'Grace' }] },
        },
      })
    ).rejects.toMatchObject({ details: { code: 'CURSOR_FILTER_CONFLICT' } })
    expect(mockQueryRows).not.toHaveBeenCalled()
  })

  it('resumes the same offset page under the identical predicate', async () => {
    const cursor = encodeCursor({
      lastRow: { id: 'row-100', orderKey: null },
      keysetValid: false,
      nextOffset: 100,
      predicate: { all: [{ field: 'column-name', op: 'eq', value: 'Ada' }] },
    })
    mockQueryRows.mockResolvedValueOnce({
      rows: [],
      rowCount: 0,
      totalCount: null,
      nextCursor: null,
    })

    await expect(
      queryTableRows.execute({
        principal: PRINCIPAL,
        input: {
          tableId: TABLE.id,
          cursor,
          predicate: { all: [{ field: 'name', op: 'eq', value: 'Ada' }] },
        },
      })
    ).resolves.toMatchObject({ rowCount: 0 })
    expect(mockQueryRows).toHaveBeenCalledWith(
      TABLE,
      expect.objectContaining({ offset: 100 }),
      expect.any(String)
    )
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

    // Narrowed to the columns the row still holds: without `selectedValues` a
    // stale sidecar entry for a dropped column rides along in the envelope, and
    // the unmigrated `rows`/`query` routes have always narrowed here.
    expect(mockLoadSecretProvenance).toHaveBeenCalledWith(
      [{ id: row.id, updatedAt: row.updatedAt, selectedValues: row.data }],
      { userId: 'user-1', workspaceId: TABLE.workspaceId }
    )
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
        dataKeying: 'names',
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
      'request-1',
      {}
    )
  })
})

describe('table row write secret provenance defaulting', () => {
  const EXACT_EMPTY_NAME = {
    complete: true,
    columns: { 'column-name': { version: 1, complete: true, entries: [] } },
  }
  const ROW = {
    id: 'row-1',
    data: { 'column-name': 'Ada' },
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockResolvePermission.mockResolvedValue('write')
    mockResolveContext.mockResolvedValue(contextFor())
    mockValidateRowData.mockResolvedValue({ valid: true })
    mockValidateBatchRows.mockResolvedValue({ valid: true })
    mockInsertRow.mockResolvedValue(ROW)
    mockBatchInsertRows.mockResolvedValue([ROW])
    mockUpdateRow.mockResolvedValue(ROW)
    mockUpdateRowsByFilter.mockResolvedValue({ affectedCount: 1 })
    mockUpsertRow.mockResolvedValue({ operation: 'insert', row: ROW })
    mockReplaceRowsPrimitive.mockResolvedValue({ deletedCount: 0, insertedCount: 1 })
  })

  it('stamps an exact-empty sidecar on a single insert that resolved no provenance', async () => {
    await createTableRows.execute({
      principal: PRINCIPAL,
      input: { kind: 'single', tableId: TABLE.id, data: { name: 'Ada' } },
    })

    expect(mockInsertRow).toHaveBeenCalledWith(
      expect.objectContaining({ secretProvenance: EXACT_EMPTY_NAME }),
      TABLE,
      expect.any(String),
      {}
    )
  })

  it('stamps an exact-empty sidecar per row on a batch insert', async () => {
    await createTableRows.execute({
      principal: PRINCIPAL,
      input: { kind: 'batch', tableId: TABLE.id, rows: [{ name: 'Ada' }, { name: 'Bob' }] },
    })

    expect(mockBatchInsertRows).toHaveBeenCalledWith(
      expect.objectContaining({
        secretProvenance: [EXACT_EMPTY_NAME, EXACT_EMPTY_NAME],
      }),
      TABLE,
      expect.any(String),
      {}
    )
  })

  it('stamps an exact-empty sidecar on a single row update', async () => {
    await updateTableRow.execute({
      principal: PRINCIPAL,
      input: { tableId: TABLE.id, rowId: 'row-1', data: { name: 'Ada' } },
    })

    expect(mockUpdateRow).toHaveBeenCalledWith(
      expect.objectContaining({ secretProvenance: EXACT_EMPTY_NAME }),
      TABLE,
      expect.any(String),
      {}
    )
  })

  it('stamps an exact-empty sidecar on a filtered bulk update', async () => {
    const filterableTable: TableDefinition = {
      ...TABLE,
      schema: { columns: [{ id: 'column_name', name: 'name', type: 'string' }] },
    }
    mockResolveContext.mockResolvedValue(contextFor(filterableTable))

    await updateTableRows.execute({
      principal: PRINCIPAL,
      input: {
        tableId: TABLE.id,
        filter: { all: [{ field: 'name', op: 'eq', value: 'Ada' }] },
        data: { name: 'Grace' },
      },
    })

    expect(mockUpdateRowsByFilter).toHaveBeenCalledWith(
      filterableTable,
      expect.objectContaining({
        secretProvenance: {
          complete: true,
          columns: { column_name: { version: 1, complete: true, entries: [] } },
        },
      }),
      expect.any(String),
      {}
    )
  })

  it('stamps an exact-empty sidecar on an upsert', async () => {
    await upsertTableRow.execute({
      principal: PRINCIPAL,
      input: { tableId: TABLE.id, data: { name: 'Ada' } },
    })

    expect(mockUpsertRow).toHaveBeenCalledWith(
      expect.objectContaining({ secretProvenance: EXACT_EMPTY_NAME }),
      TABLE,
      expect.any(String),
      {}
    )
  })

  it('stamps an exact-empty sidecar per row on a full replace', async () => {
    await replaceTableRows.execute({
      principal: PRINCIPAL,
      input: { tableId: TABLE.id, rows: [{ name: 'Ada' }] },
    })

    expect(mockReplaceRowsPrimitive).toHaveBeenCalledWith(
      expect.objectContaining({ secretProvenance: [EXACT_EMPTY_NAME] }),
      TABLE,
      expect.any(String),
      {}
    )
  })

  it('never overwrites provenance an authorized caller already resolved', async () => {
    const unknown = { complete: false, columns: {} }

    await updateTableRow.execute({
      principal: PRINCIPAL,
      input: {
        tableId: TABLE.id,
        rowId: 'row-1',
        data: { name: 'Ada' },
        secretProvenance: unknown,
      },
    })

    expect(mockUpdateRow).toHaveBeenCalledWith(
      expect.objectContaining({ secretProvenance: unknown }),
      TABLE,
      expect.any(String),
      {}
    )
  })

  it('authorizes a generic webhook by deployment and uses the billing owner for storage attribution', async () => {
    await upsertTableRow.execute({
      principal: GENERIC_WEBHOOK_EXECUTOR,
      input: { tableId: TABLE.id, data: { name: 'Ada' } },
    })

    expect(mockUpsertRow).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'billing-owner-1' }),
      TABLE,
      expect.any(String),
      {}
    )
  })
})

/**
 * The name→id remap drops keys naming no column, and nothing upstream had
 * checked that there were none to drop. An insert of `{"nosuchcol":"x"}`
 * therefore answered 201 having created an empty row, and a patch of
 * `{"zzz":"x"}` answered `updatedCount: 0` — the same answer a predicate that
 * matched nothing gives, so a caller could not tell a typo from an empty match.
 *
 * The refusal is scoped to `strictWrite`, which only `/api/v2` sets. A
 * first-party caller still has the key dropped: Copilot feeds the model's raw
 * arguments in unfiltered, so a hallucinated key, an echoed `id`, or a name
 * left over from a rename would otherwise refuse the whole write.
 */
describe('unknown column names under strictWrite', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolvePermission.mockResolvedValue('write')
    mockResolveContext.mockResolvedValue(contextFor())
    mockValidateRowData.mockResolvedValue({ valid: true })
    mockValidateBatchRows.mockResolvedValue({ valid: true })
    mockInsertRow.mockResolvedValue({ id: 'row-1', data: {} })
    mockBatchInsertRows.mockResolvedValue([{ id: 'row-1', data: {} }])
    mockUpdateRow.mockResolvedValue({ id: 'row-1', data: {} })
    mockUpdateRowsByFilter.mockResolvedValue({ affectedCount: 0 })
    mockUpsertRow.mockResolvedValue({ operation: 'insert', row: { id: 'row-1', data: {} } })
  })

  it('refuses a single insert naming a column the table does not have', async () => {
    await expect(
      createTableRows.execute({
        principal: PRINCIPAL,
        input: {
          kind: 'single',
          tableId: TABLE.id,
          data: { nosuchcol: 'x' },
          strictWrite: true,
          dataKeying: 'names',
        },
      })
    ).rejects.toThrow(/Unknown column: nosuchcol/)
    expect(mockInsertRow).not.toHaveBeenCalled()
  })

  it('drops the same key for a first-party caller instead of refusing the write', async () => {
    await expect(
      createTableRows.execute({
        principal: PRINCIPAL,
        input: { kind: 'single', tableId: TABLE.id, data: { name: 'Ada', nosuchcol: 'x' } },
      })
    ).resolves.toBeDefined()
    expect(mockInsertRow).toHaveBeenCalledWith(
      expect.objectContaining({ data: { 'column-name': 'Ada' } }),
      TABLE,
      expect.any(String),
      {}
    )
  })

  it('names every unknown column at once', async () => {
    await expect(
      createTableRows.execute({
        principal: PRINCIPAL,
        input: {
          kind: 'single',
          tableId: TABLE.id,
          data: { zzz: 'x', qqq: 'y' },
          strictWrite: true,
          dataKeying: 'names',
        },
      })
    ).rejects.toThrow(/Unknown columns: zzz, qqq/)
  })

  it('refuses a batch insert and says which row was wrong', async () => {
    await expect(
      createTableRows.execute({
        principal: PRINCIPAL,
        input: {
          kind: 'batch',
          tableId: TABLE.id,
          rows: [{ name: 'Ada' }, { zzz: 'x' }],
          strictWrite: true,
          dataKeying: 'names',
        },
      })
    ).rejects.toThrow(/Row 2: Unknown column: zzz/)
    expect(mockBatchInsertRows).not.toHaveBeenCalled()
  })

  it('refuses a predicate update rather than reporting an empty match', async () => {
    await expect(
      updateTableRows.execute({
        principal: PRINCIPAL,
        input: {
          tableId: TABLE.id,
          filter: { all: [{ field: 'name', op: 'eq', value: 'Ada' }] },
          data: { zzz: 'x' },
          strictWrite: true,
          dataKeying: 'names',
        },
      })
    ).rejects.toThrow(/Unknown column: zzz/)
    expect(mockUpdateRowsByFilter).not.toHaveBeenCalled()
  })

  it('refuses a single-row update naming an unknown column', async () => {
    await expect(
      updateTableRow.execute({
        principal: PRINCIPAL,
        input: {
          tableId: TABLE.id,
          rowId: 'row-1',
          data: { zzz: 'x' },
          strictWrite: true,
          dataKeying: 'names',
        },
      })
    ).rejects.toThrow(/Unknown column: zzz/)
    expect(mockUpdateRow).not.toHaveBeenCalled()
  })

  it('reports an empty match for the same first-party update instead of refusing', async () => {
    await expect(
      updateTableRow.execute({
        principal: PRINCIPAL,
        input: { tableId: TABLE.id, rowId: 'row-1', data: { zzz: 'x' } },
      })
    ).resolves.toBeDefined()
    expect(mockUpdateRow).toHaveBeenCalled()
  })

  it('still accepts a write naming only known columns', async () => {
    await expect(
      createTableRows.execute({
        principal: PRINCIPAL,
        input: { kind: 'single', tableId: TABLE.id, data: { name: 'Ada' } },
      })
    ).resolves.toBeDefined()
  })

  it('carries the strict value policy to the primitive, and nothing without it', async () => {
    await createTableRows.execute({
      principal: PRINCIPAL,
      input: {
        kind: 'single',
        tableId: TABLE.id,
        data: { name: 'Ada' },
        strictWrite: true,
        dataKeying: 'names',
      },
    })
    expect(mockInsertRow).toHaveBeenLastCalledWith(expect.anything(), TABLE, expect.any(String), {
      uncoercibleValues: 'reject',
    })

    await createTableRows.execute({
      principal: PRINCIPAL,
      input: { kind: 'single', tableId: TABLE.id, data: { name: 'Ada' } },
    })
    expect(mockInsertRow).toHaveBeenLastCalledWith(expect.anything(), TABLE, expect.any(String), {})
  })
})

/**
 * The two wires a table write can arrive on. `/api/v2`, `/api/v1` and the
 * Copilot tools publish column names; the first-party grid and the internal
 * `/api/table` routes publish stable storage ids.
 *
 * The failure this guards is silent: the name remap drops what it does not
 * recognise, and a storage id names no column *name*, so an id-keyed write sent
 * down the name path stores nothing while reporting success.
 */
describe('row data keying', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolvePermission.mockResolvedValue('write')
    mockResolveContext.mockResolvedValue(contextFor())
    mockAssertRowCapacity.mockResolvedValue(10_000)
    mockCreateSecretProvenance.mockReturnValue({ complete: true, columns: {} })
    mockIsScopeCompatible.mockReturnValue(true)
  })

  it('stores an id-keyed write exactly as given', async () => {
    await updateTableRow.execute({
      principal: PRINCIPAL,
      input: {
        tableId: TABLE.id,
        rowId: 'row-1',
        data: { 'column-name': 'Ada' },
        strictWrite: false,
        dataKeying: 'ids',
      },
    })

    expect(mockUpdateRow).toHaveBeenCalledWith(
      expect.objectContaining({ data: { 'column-name': 'Ada' } }),
      TABLE,
      expect.any(String),
      expect.anything()
    )
  })

  it('does not silently drop an id-keyed write, which the name path would', async () => {
    await updateTableRow.execute({
      principal: PRINCIPAL,
      input: {
        tableId: TABLE.id,
        rowId: 'row-1',
        data: { 'column-name': 'Ada' },
        strictWrite: false,
        dataKeying: 'names',
      },
    })

    // Pins the hazard itself: the same payload on the name wire stores nothing.
    expect(mockUpdateRow).toHaveBeenCalledWith(
      expect.objectContaining({ data: {} }),
      TABLE,
      expect.any(String),
      expect.anything()
    )
  })

  it('persists an unrecognised key on the lax id wire, unlike the name wire', async () => {
    // The asymmetry a non-strict id-keyed caller sees, pinned deliberately: the
    // name path drops what it cannot resolve, the id path stores what it is
    // given. This is what the grid does today via the identity `dataIn` in
    // `row-wire.ts`, so the discriminator preserved it rather than changing it.
    // Closing it is a behaviour change and belongs with the route migration.
    await updateTableRow.execute({
      principal: PRINCIPAL,
      input: {
        tableId: TABLE.id,
        rowId: 'row-1',
        data: { 'column-name': 'Ada', 'no-such-column': 'x' },
        strictWrite: false,
        dataKeying: 'ids',
      },
    })

    expect(mockUpdateRow).toHaveBeenCalledWith(
      expect.objectContaining({ data: { 'column-name': 'Ada', 'no-such-column': 'x' } }),
      TABLE,
      expect.any(String),
      expect.anything()
    )
  })

  it('translates a name-keyed write to storage ids', async () => {
    await updateTableRow.execute({
      principal: PRINCIPAL,
      input: {
        tableId: TABLE.id,
        rowId: 'row-1',
        data: { name: 'Ada' },
        strictWrite: false,
        dataKeying: 'names',
      },
    })

    expect(mockUpdateRow).toHaveBeenCalledWith(
      expect.objectContaining({ data: { 'column-name': 'Ada' } }),
      TABLE,
      expect.any(String),
      expect.anything()
    )
  })

  it('refuses an unknown column id when the caller writes strictly', async () => {
    await expect(
      updateTableRow.execute({
        principal: PRINCIPAL,
        input: {
          tableId: TABLE.id,
          rowId: 'row-1',
          data: { 'column-nope': 'x' },
          strictWrite: true,
          dataKeying: 'ids',
        },
      })
    ).rejects.toThrow(/Unknown column: column-nope/)
    expect(mockUpdateRow).not.toHaveBeenCalled()
  })

  it('accepts a legacy column that has no id and is stored under its name', async () => {
    // Two production tables still carry pre-backfill columns with no `id`.
    // Their storage key is the name, so a strict id-keyed write naming one must
    // be accepted, not refused as unknown.
    mockResolveContext.mockResolvedValue(
      contextFor({ ...TABLE, schema: { columns: [{ name: 'legacy', type: 'string' }] } })
    )

    await expect(
      updateTableRow.execute({
        principal: PRINCIPAL,
        input: {
          tableId: TABLE.id,
          rowId: 'row-1',
          data: { legacy: 'x' },
          strictWrite: true,
          dataKeying: 'ids',
        },
      })
    ).resolves.toBeDefined()
  })

  it('names every unknown id at once, as the name wire does', async () => {
    await expect(
      createTableRows.execute({
        principal: PRINCIPAL,
        input: {
          kind: 'batch',
          tableId: TABLE.id,
          rows: [{ 'column-name': 'Ada' }, { zzz: 'x', qqq: 'y' }],
          strictWrite: true,
          dataKeying: 'ids',
        },
      })
    ).rejects.toThrow(/Row 2: Unknown columns: zzz, qqq/)
  })
})

/**
 * Per-cell run state is opt-in. These pin both halves of that: the default read
 * is byte-identical to what shipped, and the flag changes only the projection —
 * never which rows come back or in what order.
 */
describe('opt-in per-cell run state', () => {
  const RUN_STATE = {
    'group-1': {
      status: 'error' as const,
      executionId: 'execution-1',
      jobId: 'job-1',
      workflowId: 'workflow-1',
      error: 'boom',
    },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockResolvePermission.mockResolvedValue('read')
    mockResolveContext.mockResolvedValue(contextFor())
    mockQueryRows.mockResolvedValue({
      rows: [{ id: 'row-1', data: {}, executions: {} }],
      rowCount: 1,
      totalCount: null,
      nextCursor: null,
    })
  })

  it('does not read the sidecar for a list that did not ask for it', async () => {
    await listTableRows.execute({
      principal: PRINCIPAL,
      input: { tableId: TABLE.id, limit: 25 },
    })

    expect(mockQueryRows).toHaveBeenCalledWith(
      TABLE,
      expect.objectContaining({ withExecutions: false }),
      expect.any(String)
    )
  })

  it('reads the sidecar for a list that asked for it', async () => {
    await listTableRows.execute({
      principal: PRINCIPAL,
      input: { tableId: TABLE.id, limit: 25, includeRunState: true },
    })

    expect(mockQueryRows).toHaveBeenCalledWith(
      TABLE,
      expect.objectContaining({ withExecutions: true }),
      expect.any(String)
    )
  })

  it('carries the flag through the predicate query the same way', async () => {
    await queryTableRows.execute({
      principal: PRINCIPAL,
      input: { tableId: TABLE.id, limit: 25, includeRunState: true },
    })

    expect(mockQueryRows).toHaveBeenCalledWith(
      TABLE,
      expect.objectContaining({ withExecutions: true }),
      expect.any(String)
    )
  })

  it('leaves the single-row read without run state by default', async () => {
    mockGetRowSummaryById.mockResolvedValue({ id: 'row-1', data: {} })

    const result = await readTableRow.execute({
      principal: PRINCIPAL,
      input: { tableId: TABLE.id, rowId: 'row-1' },
    })

    expect(mockLoadExecutionsForRow).not.toHaveBeenCalled()
    expect(result.runState).toBeUndefined()
  })

  it('attaches run state to the single-row read on request', async () => {
    mockGetRowSummaryById.mockResolvedValue({ id: 'row-1', data: {} })
    mockLoadExecutionsForRow.mockResolvedValue(RUN_STATE)

    const result = await readTableRow.execute({
      principal: PRINCIPAL,
      input: { tableId: TABLE.id, rowId: 'row-1', includeRunState: true },
    })

    expect(result.runState).toEqual(RUN_STATE)
  })

  /**
   * `blockErrors` is unbounded jsonb, so a row carrying one has no ceiling of
   * its own. The budget travels INTO the drain rather than being measured over
   * its result: a ceiling checked after materialization can only report a heap
   * spike that has already happened.
   */
  it('hands the single-row sidecar read the published byte budget', async () => {
    mockGetRowSummaryById.mockResolvedValue({ id: 'row-1', data: {} })
    mockLoadExecutionsForRow.mockResolvedValue(RUN_STATE)

    await readTableRow.execute({
      principal: PRINCIPAL,
      input: { tableId: TABLE.id, rowId: 'row-1', includeRunState: true },
    })

    expect(mockLoadExecutionsForRow).toHaveBeenCalledWith(expect.anything(), 'row-1', {
      budgetBytes: TABLE_LIMITS.MAX_ROW_RUN_STATE_BYTES,
    })
  })

  it('propagates the sidecar refusal rather than answering a short page', async () => {
    const refusal = Object.assign(new Error('too large'), { code: 'payload_too_large' })
    mockQueryRows.mockRejectedValueOnce(refusal)

    await expect(
      listTableRows.execute({
        principal: PRINCIPAL,
        input: { tableId: TABLE.id, limit: 10, includeRunState: true },
      })
    ).rejects.toBe(refusal)
  })
})

/**
 * The heterogeneous batch update, which Copilot's batch tool and the public
 * `POST /rows/bulk-update` now share.
 */
describe('batchUpdateTableRows application use case', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolvePermission.mockResolvedValue('write')
    mockResolveContext.mockResolvedValue(contextFor())
    mockBatchUpdateRows.mockResolvedValue({ affectedCount: 2, affectedRowIds: ['row-1', 'row-2'] })
  })

  it('translates every name-keyed patch to storage ids under canonical scope', async () => {
    const result = await batchUpdateTableRows.execute({
      principal: PRINCIPAL,
      input: {
        tableId: TABLE.id,
        assertedWorkspaceId: TABLE.workspaceId,
        strictWrite: true,
        dataKeying: 'names',
        updates: [
          { rowId: 'row-1', data: { name: 'Ada' } },
          { rowId: 'row-2', data: { name: 'Grace' } },
        ],
      },
    })

    expect(mockBatchUpdateRows).toHaveBeenCalledWith(
      expect.objectContaining({
        tableId: TABLE.id,
        workspaceId: TABLE.workspaceId,
        actorUserId: 'user-1',
        updates: [
          { rowId: 'row-1', data: { 'column-name': 'Ada' } },
          { rowId: 'row-2', data: { 'column-name': 'Grace' } },
        ],
      }),
      TABLE,
      expect.any(String)
    )
    expect(result.affectedCount).toBe(2)
  })

  it('refuses a strict patch naming a column the table does not have', async () => {
    await expect(
      batchUpdateTableRows.execute({
        principal: PRINCIPAL,
        input: {
          tableId: TABLE.id,
          strictWrite: true,
          dataKeying: 'names',
          updates: [{ rowId: 'row-1', data: { nope: 1 } }],
        },
      })
    ).rejects.toBeInstanceOf(TableRowsValidationError)
    expect(mockBatchUpdateRows).not.toHaveBeenCalled()
  })

  it('drops the same key for a first-party caller instead of refusing', async () => {
    await batchUpdateTableRows.execute({
      principal: PRINCIPAL,
      input: {
        tableId: TABLE.id,
        strictWrite: false,
        dataKeying: 'names',
        updates: [{ rowId: 'row-1', data: { nope: 1 } }],
      },
    })

    expect(mockBatchUpdateRows).toHaveBeenCalledWith(
      expect.objectContaining({ updates: [{ rowId: 'row-1', data: {} }] }),
      TABLE,
      expect.any(String)
    )
  })

  it('rejects an empty batch before touching storage', async () => {
    await expect(
      batchUpdateTableRows.execute({
        principal: PRINCIPAL,
        input: { tableId: TABLE.id, strictWrite: true, dataKeying: 'names', updates: [] },
      })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(mockBatchUpdateRows).not.toHaveBeenCalled()
  })

  const batchOf = (length: number) =>
    Array.from({ length }, (_, index) => ({ rowId: `row-${index}`, data: { name: 'Ada' } }))

  /**
   * The two surfaces cap differently on purpose — the contracts at 1000, the
   * Copilot tool at 5000 — so the shared backstop sits at the LOOSER ceiling.
   * Tightening it to the contract's number would make batches Copilot accepts
   * today start failing here, which is the behavior change this pins against.
   */
  it('admits a batch past the contract ceiling that the looser surface allows', async () => {
    mockBatchUpdateRows.mockResolvedValue({ affectedCount: 1001, affectedRowIds: [] })

    await batchUpdateTableRows.execute({
      principal: PRINCIPAL,
      input: {
        tableId: TABLE.id,
        strictWrite: false,
        dataKeying: 'names',
        updates: batchOf(TABLE_LIMITS.MAX_BULK_OPERATION_SIZE + 1),
      },
    })

    expect(mockBatchUpdateRows).toHaveBeenCalled()
  })

  it('refuses past the backstop, naming the bound that actually applied', async () => {
    await expect(
      batchUpdateTableRows.execute({
        principal: PRINCIPAL,
        input: {
          tableId: TABLE.id,
          strictWrite: true,
          dataKeying: 'names',
          updates: batchOf(CSV_MAX_BATCH_SIZE + 1),
        },
      })
    ).rejects.toMatchObject({
      code: 'validation',
      message: `Batch update count must be between 1 and ${CSV_MAX_BATCH_SIZE}`,
    })
    expect(mockBatchUpdateRows).not.toHaveBeenCalled()
  })

  it('audits and signals only the authoritative affected count', async () => {
    mockBatchUpdateRows.mockResolvedValue({ affectedCount: 0, affectedRowIds: [] })

    await batchUpdateTableRows.execute({
      principal: PRINCIPAL,
      input: {
        tableId: TABLE.id,
        strictWrite: true,
        dataKeying: 'names',
        updates: [{ rowId: 'row-1', data: { name: 'Ada' } }],
      },
    })

    expect(mockRecordAudit).not.toHaveBeenCalled()
    expect(mockSignalRowsChanged).not.toHaveBeenCalled()
  })

  it('propagates the missing-row refusal without audit or shared effects', async () => {
    const failure = Object.assign(new Error('Rows not found: row-9'), { code: 'validation' })
    mockBatchUpdateRows.mockRejectedValueOnce(failure)

    await expect(
      batchUpdateTableRows.execute({
        principal: PRINCIPAL,
        input: {
          tableId: TABLE.id,
          strictWrite: true,
          dataKeying: 'names',
          updates: [{ rowId: 'row-9', data: { name: 'Ada' } }],
        },
      })
    ).rejects.toBe(failure)
    expect(mockRecordAudit).not.toHaveBeenCalled()
    expect(mockSignalRowsChanged).not.toHaveBeenCalled()
  })
})

/**
 * A bogus row or group id used to read back `{ detail: null }` with a 200 — the same
 * answer as "this cell has no enrichment run yet", so a typo was undetectable.
 */
describe('enrichment detail id validation', () => {
  const ENRICHED_TABLE: TableDefinition = {
    ...TABLE,
    schema: {
      columns: [{ id: 'column-name', name: 'name', type: 'string' }],
      workflowGroups: [{ id: 'group-1', name: 'Enrich', type: 'enrichment', columnIds: [] }],
    },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockResolvePermission.mockResolvedValue('read')
    mockResolveContext.mockResolvedValue(contextFor(ENRICHED_TABLE))
    mockLoadEnrichmentDetail.mockResolvedValue(null)
  })

  it('404s on a row id the table does not have', async () => {
    mockGetRowSummaryById.mockResolvedValue(null)

    await expect(
      readTableRowEnrichmentDetail.execute({
        principal: PRINCIPAL,
        input: { tableId: ENRICHED_TABLE.id, rowId: 'row-nope', groupId: 'group-1' },
      })
    ).rejects.toThrowError(expect.objectContaining({ code: 'not_found' }))
    expect(mockLoadEnrichmentDetail).not.toHaveBeenCalled()
  })

  it('404s on a group id the table does not have', async () => {
    mockGetRowSummaryById.mockResolvedValue({ id: 'row-1', data: {} })

    await expect(
      readTableRowEnrichmentDetail.execute({
        principal: PRINCIPAL,
        input: { tableId: ENRICHED_TABLE.id, rowId: 'row-1', groupId: 'group-nope' },
      })
    ).rejects.toThrowError(expect.objectContaining({ code: 'not_found' }))
    expect(mockLoadEnrichmentDetail).not.toHaveBeenCalled()
  })

  it('still answers null for a real row and group with no recorded run', async () => {
    mockGetRowSummaryById.mockResolvedValue({ id: 'row-1', data: {} })

    const result = await readTableRowEnrichmentDetail.execute({
      principal: PRINCIPAL,
      input: { tableId: ENRICHED_TABLE.id, rowId: 'row-1', groupId: 'group-1' },
    })

    expect(result.detail).toBeNull()
  })
})
