import {
  createDelegatedPrincipal,
  createSessionPrincipal,
} from '@sim/testing/factories/principal.factory'
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { tableMock, tableMockFns } from '@sim/testing/mocks/table.mock'
import {
  tableApplicationContextMock,
  tableApplicationContextMockFns,
} from '@sim/testing/mocks/table-application-context.mock'
import { tableBillingMock } from '@sim/testing/mocks/table-billing.mock'
import { tableEventsMock, tableEventsMockFns } from '@sim/testing/mocks/table-events.mock'
import {
  tableRowsSecretProvenanceMock,
  tableRowsSecretProvenanceMockFns,
} from '@sim/testing/mocks/table-rows-secret-provenance.mock'
import {
  tableRowsServiceMock,
  tableRowsServiceMockFns,
} from '@sim/testing/mocks/table-rows-service.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspacesUtilsMock,
  workspacesUtilsMockFns,
} from '@sim/testing/mocks/workspaces-utils.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TableDefinition } from '@/lib/table/types'

const { mockIsScopeCompatible, mockLoadExecutionsForRow, mockLoadEnrichmentDetail } = vi.hoisted(
  () => ({
    mockIsScopeCompatible: vi.fn(),
    mockLoadExecutionsForRow: vi.fn(),
    mockLoadEnrichmentDetail: vi.fn(),
  })
)

vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)

vi.mock('@/lib/workspaces/utils', () => workspacesUtilsMock)

vi.mock('@sim/audit', () => auditMock)

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

vi.mock('@/lib/table', () => ({
  ...tableMock,
  TABLE_LIMITS: { ...tableMock.TABLE_LIMITS, MAX_ROW_RUN_STATE_BYTES: 256 },
}))

vi.mock('@/lib/table/billing', () => tableBillingMock)

vi.mock('@/lib/table/column-types', () => ({
  columnTypeOf: (column: { type: string }) => ({ id: column.type }),
}))

vi.mock('@/lib/table/rows/secret-provenance', () => tableRowsSecretProvenanceMock)

vi.mock('@/lib/table/validation', () => ({
  coerceRowValues: vi.fn(),
}))

vi.mock('@/lib/execution/durable-secret-provenance', () => ({
  isPrivateSecretProvenanceScopeCompatible: mockIsScopeCompatible,
}))

vi.mock('@/lib/table/rows/service', () => tableRowsServiceMock)

vi.mock('@/lib/table/application/context', () => tableApplicationContextMock)

vi.mock('@/lib/table/import', () => ({
  CSV_MAX_BATCH_SIZE: 5000,
}))

vi.mock('@/lib/table/rows/executions', () => ({
  loadEnrichmentDetail: mockLoadEnrichmentDetail,
  loadExecutionsForRow: mockLoadExecutionsForRow,
}))

vi.mock('@/lib/table/events', () => tableEventsMock)

import { TABLE_LIMITS } from '@/lib/table'
import { observeTableRowDelivery } from '@/lib/table/application/row-delivery-observer'
import {
  batchUpdateTableRows,
  createTableRows,
  listTableRows,
  ProjectedWireRowsValidationError,
  queryTableRows,
  readTableRow,
  readTableRowEnrichmentDetail,
  replaceProjectedWireRows,
  replaceTableRows,
  TableRowsValidationError,
  updateTableRow,
  updateTableRows,
  upsertTableRow,
} from '@/lib/table/application/rows'
import { CSV_MAX_BATCH_SIZE } from '@/lib/table/import'
import { encodeCursor } from '@/lib/table/rows/cursor'

const {
  mockReplaceTableRows: mockReplaceRowsPrimitive,
  mockDeleteRowsByIds,
  mockQueryRows,
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
  mockAssertRowCapacity,
  mockNotifyTableRowUsage,
} = tableMockFns
const {
  mockCreateTableRowSecretProvenanceFromRegistry: mockCreateSecretProvenance,
  mockTableRowProvenanceReader: mockLoadSecretProvenance,
} = tableRowsSecretProvenanceMockFns
const mockReplaceRowsWithTx = tableRowsServiceMockFns.mockReplaceTableRowsWithTx
const mockResolveContext = tableApplicationContextMockFns.mockResolveActiveTableContext
const mockIsFeatureEnabled = featureFlagsMockFns.mockIsFeatureEnabled
const mockGetWorkspaceOrganizationId = workspacesUtilsMockFns.mockGetWorkspaceOrganizationId
const mockRecordAudit = auditMockFns.mockRecordAudit
const mockResolvePermission = workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission
const mockSignalRowsChanged = tableEventsMockFns.mockSignalTableRowsChanged
const mockSignalRowsChangedByActor = tableEventsMockFns.mockSignalTableRowsChangedByActor

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

const PRINCIPAL = createSessionPrincipal()
const GENERIC_WEBHOOK_EXECUTOR = {
  kind: 'delegated' as const,
  serviceId: 'executor' as const,
  workspaceId: TABLE.workspaceId,
  delegationId: 'executor-1',
  audience: 'sim:tables',
  issuedAt: new Date('2026-01-01'),
  expiresAt: new Date('2099-01-01'),
  resourceScope: { tableId: TABLE.id },
  delegationContext: {
    kind: 'workflow_execution' as const,
    workflowId: 'workflow-1',
    currentWorkflow: {
      workflowId: 'workflow-1',
      mode: 'deployment' as const,
      deploymentVersionId: 'deployment-1',
    },
    principal: {
      kind: 'system' as const,
      serviceId: 'webhook' as const,
      workspaceId: TABLE.workspaceId,
      workflowId: 'workflow-1',
      webhookId: 'webhook-1',
      provider: 'generic',
    },
  },
}

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
  const delegatedPrincipal = createDelegatedPrincipal({
    workspaceId: TABLE.workspaceId,
    delegationId: 'copilot-tool:tool-1',
    audience: 'sim:tables',
    resourceScope: { tableId: TABLE.id },
  })

  beforeEach(() => {
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
})

describe('replaceTableRows application use case', () => {
  beforeEach(() => {
    mockResolvePermission.mockResolvedValue('write')
    mockResolveContext.mockResolvedValue(contextFor())
    mockReplaceRowsPrimitive.mockResolvedValue({ deletedCount: 2, insertedCount: 1 })
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
})

describe('row query and upsert application semantics', () => {
  beforeEach(() => {
    mockResolvePermission.mockResolvedValue('write')
    mockResolveContext.mockResolvedValue(contextFor())
    mockIsFeatureEnabled.mockResolvedValue(true)
    mockGetWorkspaceOrganizationId.mockResolvedValue('organization-1')
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
      expect.any(String),
      undefined
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

  it('reports an empty match for the same first-party update instead of refusing', async () => {
    await expect(
      updateTableRow.execute({
        principal: PRINCIPAL,
        input: { tableId: TABLE.id, rowId: 'row-1', data: { zzz: 'x' } },
      })
    ).resolves.toBeDefined()
    expect(mockUpdateRow).toHaveBeenCalled()
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
    mockResolvePermission.mockResolvedValue('write')
    mockResolveContext.mockResolvedValue(contextFor())
    mockAssertRowCapacity.mockResolvedValue(10_000)
    mockCreateSecretProvenance.mockReturnValue({ complete: true, columns: {} })
    mockIsScopeCompatible.mockReturnValue(true)
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
})

/**
 * The heterogeneous batch update, which Copilot's batch tool and the public
 * `POST /rows/bulk-update` now share.
 */
describe('batchUpdateTableRows application use case', () => {
  beforeEach(() => {
    mockResolvePermission.mockResolvedValue('write')
    mockResolveContext.mockResolvedValue(contextFor())
    mockBatchUpdateRows.mockResolvedValue({ affectedCount: 2, affectedRowIds: ['row-1', 'row-2'] })
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
    mockResolvePermission.mockResolvedValue('read')
    mockResolveContext.mockResolvedValue(contextFor(ENRICHED_TABLE))
    mockLoadEnrichmentDetail.mockResolvedValue(null)
    mockLoadExecutionsForRow.mockResolvedValue({})
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
})

/**
 * An internal transport that observes delivery (the Copilot CLI) must see the
 * persisted provenance of every row a row-returning use case hands back, even
 * though the public surface it dispatched never asks for it on the wire.
 */
describe('row delivery to an observing transport', () => {
  const ENRICHED_TABLE: TableDefinition = {
    ...TABLE,
    schema: {
      columns: [{ id: 'column-name', name: 'name', type: 'string' }],
      workflowGroups: [{ id: 'group-1', name: 'Enrich', type: 'enrichment', columnIds: [] }],
    },
  }
  const ROW = {
    id: 'row-1',
    data: { 'column-name': 'secret-cell' },
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  }
  const PAGE = { rows: [ROW], rowCount: 1, totalCount: null, nextCursor: null }

  beforeEach(() => {
    mockResolvePermission.mockResolvedValue('write')
    mockResolveContext.mockResolvedValue(contextFor(ENRICHED_TABLE))
    mockQueryRows.mockResolvedValue(PAGE)
    mockGetRowSummaryById.mockResolvedValue(ROW)
    mockLoadExecutionsForRow.mockResolvedValue({})
    mockLoadEnrichmentDetail.mockResolvedValue(null)
    mockValidateRowData.mockResolvedValue({ valid: true })
    mockValidateBatchRows.mockResolvedValue({ valid: true })
    mockInsertRow.mockResolvedValue(ROW)
    mockBatchInsertRows.mockResolvedValue([ROW])
    mockUpdateRow.mockResolvedValue(ROW)
    mockUpsertRow.mockResolvedValue({ operation: 'update', row: ROW })
  })

  const reads = {
    list: () =>
      listTableRows.execute({ principal: PRINCIPAL, input: { tableId: TABLE.id, limit: 25 } }),
    query: () =>
      queryTableRows.execute({ principal: PRINCIPAL, input: { tableId: TABLE.id, limit: 25 } }),
    read: () =>
      readTableRow.execute({ principal: PRINCIPAL, input: { tableId: TABLE.id, rowId: ROW.id } }),
    enrichment: () =>
      readTableRowEnrichmentDetail.execute({
        principal: PRINCIPAL,
        input: { tableId: TABLE.id, rowId: ROW.id, groupId: 'group-1' },
      }),
    create: () =>
      createTableRows.execute({
        principal: PRINCIPAL,
        input: {
          kind: 'single',
          tableId: TABLE.id,
          data: { name: 'secret-cell' },
          strictWrite: true,
          dataKeying: 'names',
        },
      }),
    createBatch: () =>
      createTableRows.execute({
        principal: PRINCIPAL,
        input: {
          kind: 'batch',
          tableId: TABLE.id,
          rows: [{ name: 'secret-cell' }],
          strictWrite: true,
          dataKeying: 'names',
        },
      }),
    update: () =>
      updateTableRow.execute({
        principal: PRINCIPAL,
        input: {
          tableId: TABLE.id,
          rowId: ROW.id,
          data: { name: 'secret-cell' },
          strictWrite: true,
          dataKeying: 'names',
        },
      }),
    upsert: () =>
      upsertTableRow.execute({
        principal: PRINCIPAL,
        input: {
          tableId: TABLE.id,
          data: { name: 'secret-cell' },
          strictWrite: true,
          dataKeying: 'names',
        },
      }),
  }

  it.each(Object.keys(reads) as Array<keyof typeof reads>)(
    '%s reports the returned rows and their provenance',
    async (name) => {
      const observe = vi.fn(async () => {})
      const result = await observeTableRowDelivery(observe, reads[name])

      expect(mockLoadSecretProvenance).toHaveBeenCalledWith(
        {
          userId: PRINCIPAL.userId,
          workspaceId: TABLE.workspaceId,
        },
        undefined
      )
      expect(observe).toHaveBeenCalledTimes(1)
      expect(observe).toHaveBeenCalledWith(
        { version: 1, complete: true, entries: [] },
        [ROW.data],
        {
          unprovenancedErrorText: false,
        }
      )
      expect((result as { secretProvenance?: unknown }).secretProvenance).toBeUndefined()
    }
  )
  describe('run-state and enrichment error text', () => {
    const CLEAN_RUN = {
      status: 'completed',
      executionId: 'exec-1',
      jobId: null,
      workflowId: 'workflow-1',
      error: null,
    }
    const RUN_WITH_ERROR = { ...CLEAN_RUN, status: 'error', error: 'failed with sk-live-secret' }
    const RUN_WITH_BLOCK_ERROR = {
      ...CLEAN_RUN,
      status: 'error',
      blockErrors: { 'block-1': 'Authorization: Bearer sk-live-secret' },
    }

    async function reportedErrorText(read: () => Promise<unknown>): Promise<boolean> {
      const observe = vi.fn(async () => {})
      await observeTableRowDelivery(observe, read)
      expect(observe).toHaveBeenCalledTimes(1)
      const extras = observe.mock.calls[0]?.[2] as { unprovenancedErrorText: boolean }
      return extras.unprovenancedErrorText
    }

    const withRunState = {
      list: () =>
        listTableRows.execute({
          principal: PRINCIPAL,
          input: { tableId: TABLE.id, limit: 25, includeRunState: true },
        }),
      query: () =>
        queryTableRows.execute({
          principal: PRINCIPAL,
          input: { tableId: TABLE.id, limit: 25, includeRunState: true },
        }),
    }

    it.each(Object.keys(withRunState) as Array<keyof typeof withRunState>)(
      '%s signals returned run-state error text',
      async (name) => {
        mockQueryRows.mockResolvedValue({
          ...PAGE,
          rows: [
            { ...ROW, executions: { 'group-1': CLEAN_RUN } },
            { ...ROW, id: 'row-2', executions: { 'group-1': RUN_WITH_ERROR } },
          ],
        })
        expect(await reportedErrorText(withRunState[name])).toBe(true)

        mockQueryRows.mockResolvedValue({
          ...PAGE,
          rows: [{ ...ROW, executions: { 'group-1': RUN_WITH_BLOCK_ERROR } }],
        })
        expect(await reportedErrorText(withRunState[name])).toBe(true)
      }
    )

    it.each(Object.keys(withRunState) as Array<keyof typeof withRunState>)(
      '%s does not signal run state without error text',
      async (name) => {
        mockQueryRows.mockResolvedValue({
          ...PAGE,
          rows: [
            { ...ROW, executions: { 'group-1': { ...CLEAN_RUN, error: '', blockErrors: {} } } },
          ],
        })
        expect(await reportedErrorText(withRunState[name])).toBe(false)
      }
    )
  })
})
