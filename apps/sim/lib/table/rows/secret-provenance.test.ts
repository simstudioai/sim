/**
 * @vitest-environment node
 */
import { userTableDefinitions, userTableRows } from '@sim/db/schema'
import { dbChainMock, dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockIsEnforced, mockReport, mockError } = vi.hoisted(() => ({
  mockIsEnforced: vi.fn(() => false),
  mockReport: vi.fn(),
  mockError: vi.fn(),
}))

vi.mock('@sim/logger', () => ({
  createLogger: () => ({ error: mockError, warn: vi.fn() }),
}))

vi.mock('@/lib/execution/durable-secret-provenance-enforcement', () => ({
  DURABLE_SECRET_PROVENANCE_SURFACES: ['memory', 'table-row', 'knowledge'],
  isDurableSecretProvenanceEnforced: mockIsEnforced,
  reportUnrecordedDurableProvenance: mockReport,
}))

import { PROVENANCE_MAX_SERIALIZED_BYTES } from '@/lib/execution/provenance-limits'
import type { DbTransaction } from '@/lib/table/planner'
import {
  classifyTableRowSecretProvenanceForCopy,
  getTableSnapshotModelMountSafety,
  loadTableRowSecretProvenance,
  mutateTableRowsWithSecretProvenance,
  updateTableRowsWithDerivedSecretProvenance,
} from '@/lib/table/rows/secret-provenance'

const ROW_UPDATED_AT = new Date('2026-08-05T00:00:00.123Z')

interface MockSqlFragment {
  strings?: readonly string[]
  values?: unknown[]
}

function pendingRowsFromLastExecute(): unknown[] {
  const statement = dbChainMockFns.execute.mock.calls.at(-1)?.[0] as MockSqlFragment | undefined
  const pending = statement?.values?.find(
    (value): value is string => typeof value === 'string' && value.startsWith('[{"row_id"')
  )
  if (!pending) throw new Error('Expected a pending provenance payload')
  return JSON.parse(pending) as unknown[]
}

function boundArrayValues(fragment: unknown): unknown[][] {
  if (!fragment || typeof fragment !== 'object') return []
  const values = (fragment as MockSqlFragment).values
  if (!values) return []
  return values.flatMap((value) => (Array.isArray(value) ? [value] : boundArrayValues(value)))
}

function sqlText(fragment: unknown): string {
  if (!fragment || typeof fragment !== 'object') return ''
  return ((fragment as MockSqlFragment).strings ?? []).join('?')
}

describe('table row secret provenance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockIsEnforced.mockReturnValue(false)
  })

  it('checks a version-pinned table with one aggregate rather than loading its rows', async () => {
    queueTableRows(userTableDefinitions, [{ rowsVersion: 7 }])
    queueTableRows(userTableDefinitions, [{ rowsVersion: 7 }])
    queueTableRows(userTableRows, [{ unsafeCount: 0, unrecordedCount: 0 }])

    await expect(
      getTableSnapshotModelMountSafety({
        tableId: 'table-1',
        workspaceId: 'workspace-1',
        rowsVersion: 7,
      })
    ).resolves.toBe('safe')

    expect(dbChainMockFns.limit).toHaveBeenCalledTimes(2)
    expect(dbChainMockFns.orderBy).not.toHaveBeenCalled()
  })

  it('classifies unsafe provenance after confirming the snapshot remains current', async () => {
    queueTableRows(userTableDefinitions, [{ rowsVersion: 7 }])
    queueTableRows(userTableRows, [{ unsafeCount: 1, unrecordedCount: 3 }])
    queueTableRows(userTableDefinitions, [{ rowsVersion: 7 }])

    await expect(
      getTableSnapshotModelMountSafety({
        tableId: 'table-1',
        workspaceId: 'workspace-1',
        rowsVersion: 7,
      })
    ).resolves.toBe('unsafe-provenance')

    expect(dbChainMockFns.limit).toHaveBeenCalledTimes(2)
    expect(mockReport).not.toHaveBeenCalled()
  })

  it('rejects a snapshot when the table changes during the safety check', async () => {
    queueTableRows(userTableDefinitions, [{ rowsVersion: 7 }])
    queueTableRows(userTableDefinitions, [{ rowsVersion: 8 }])
    queueTableRows(userTableRows, [{ unsafeCount: 0, unrecordedCount: 3 }])

    await expect(
      getTableSnapshotModelMountSafety({
        tableId: 'table-1',
        workspaceId: 'workspace-1',
        rowsVersion: 7,
      })
    ).resolves.toBe('stale')
    expect(mockReport).not.toHaveBeenCalled()
  })

  it.each([false, true])(
    'applies the table-row enforcement policy to snapshot absences (%s)',
    async (enforced) => {
      mockIsEnforced.mockReturnValue(enforced)
      queueTableRows(userTableDefinitions, [{ rowsVersion: 7 }])
      queueTableRows(userTableDefinitions, [{ rowsVersion: 7 }])
      queueTableRows(userTableRows, [{ unsafeCount: '0', unrecordedCount: '3' }])

      await expect(
        getTableSnapshotModelMountSafety({
          tableId: 'table-1',
          workspaceId: 'workspace-1',
          rowsVersion: 7,
        })
      ).resolves.toBe(enforced ? 'unsafe-provenance' : 'safe')

      if (enforced) expect(mockReport).not.toHaveBeenCalled()
      else
        expect(mockReport).toHaveBeenCalledExactlyOnceWith({
          surface: 'table-row',
          cause: 'row-sidecar-not-exact',
          affectedCount: 3,
          workspaceId: 'workspace-1',
        })
    }
  )

  it('keeps untouched legacy rows readable with exact-empty provenance', async () => {
    queueTableRows(userTableRows, [
      {
        id: 'legacy-row',
        updatedAt: ROW_UPDATED_AT,
        secretProvenanceVersion: null,
        sidecarRowId: null,
        sidecarStatus: null,
        sidecarEntries: null,
        sidecarIsCurrent: false,
      },
    ])

    await expect(
      loadTableRowSecretProvenance([{ id: 'legacy-row', updatedAt: ROW_UPDATED_AT }], {
        userId: 'user-1',
        workspaceId: 'workspace-1',
      })
    ).resolves.toEqual({
      version: 1,
      complete: true,
      entries: [],
      scope: { userId: 'user-1', workspaceId: 'workspace-1' },
    })
  })

  it('projects current exact entries without exposing cross-scope secret names', async () => {
    queueTableRows(userTableRows, [
      {
        id: 'tracked-row',
        updatedAt: ROW_UPDATED_AT,
        secretProvenanceVersion: 1,
        sidecarRowId: 'tracked-row',
        sidecarStatus: 'exact',
        sidecarEntries: [
          {
            columnId: 'local',
            encryptedValue: 'encrypted-local',
            name: 'LOCAL_SECRET',
            sourceUserId: 'user-1',
            sourceWorkspaceId: 'workspace-1',
          },
          {
            columnId: 'forked',
            encryptedValue: 'encrypted-forked',
            name: 'SOURCE_SECRET',
            sourceUserId: 'source-user',
            sourceWorkspaceId: 'source-workspace',
          },
        ],
        sidecarIsCurrent: true,
      },
    ])

    await expect(
      loadTableRowSecretProvenance([{ id: 'tracked-row', updatedAt: ROW_UPDATED_AT }], {
        userId: 'user-1',
        workspaceId: 'workspace-1',
      })
    ).resolves.toEqual({
      version: 1,
      complete: true,
      entries: [
        { encryptedValue: 'encrypted-forked' },
        { encryptedValue: 'encrypted-local', name: 'LOCAL_SECRET' },
      ],
      scope: { userId: 'user-1', workspaceId: 'workspace-1' },
    })
  })

  it('does not activate a secret from an unselected column with the same value', async () => {
    queueTableRows(userTableRows, [
      {
        id: 'tracked-row',
        updatedAt: ROW_UPDATED_AT,
        secretProvenanceVersion: 1,
        sidecarRowId: 'tracked-row',
        sidecarStatus: 'exact',
        sidecarEntries: [
          {
            columnId: 'secret-column',
            encryptedValue: 'encrypted-test',
            name: 'TEST',
            sourceUserId: 'user-1',
            sourceWorkspaceId: 'workspace-1',
          },
        ],
        sidecarIsCurrent: true,
      },
    ])

    await expect(
      loadTableRowSecretProvenance(
        [
          {
            id: 'tracked-row',
            updatedAt: ROW_UPDATED_AT,
            selectedValues: { 'public-column': 'Test' },
          },
        ],
        { userId: 'user-1', workspaceId: 'workspace-1' }
      )
    ).resolves.toEqual({
      version: 1,
      complete: true,
      entries: [],
      scope: { userId: 'user-1', workspaceId: 'workspace-1' },
    })
  })

  /**
   * The response carries one entry per distinct secret, so a page of many rows sharing a few
   * secrets is small. Counting the collected per-cell entries instead refused this page at 11,000
   * on its way to reporting 11 — the same rows-times-columns bound a write-side selection cap
   * used to impose.
   */
  it('vouches for a page whose collected entries far exceed the secrets it reports', async () => {
    const secretCount = 11
    const rowCount = 1_000
    const entries = Array.from({ length: secretCount }, (_, index) => ({
      columnId: `column-${String(index).padStart(2, '0')}`,
      encryptedValue: `encrypted-${String(index).padStart(2, '0')}`,
      name: `SECRET_${String(index).padStart(2, '0')}`,
      sourceUserId: 'user-1',
      sourceWorkspaceId: 'workspace-1',
    }))
    queueTableRows(
      userTableRows,
      Array.from({ length: rowCount }, (_, index) => ({
        id: `row-${index}`,
        updatedAt: ROW_UPDATED_AT,
        secretProvenanceVersion: 1,
        sidecarRowId: `row-${index}`,
        sidecarStatus: 'exact',
        sidecarEntries: entries,
        sidecarIsCurrent: true,
      }))
    )

    await expect(
      loadTableRowSecretProvenance(
        Array.from({ length: rowCount }, (_, index) => ({
          id: `row-${index}`,
          updatedAt: ROW_UPDATED_AT,
        })),
        { userId: 'user-1', workspaceId: 'workspace-1' }
      )
    ).resolves.toEqual({
      version: 1,
      complete: true,
      entries: entries.map((entry) => ({
        encryptedValue: entry.encryptedValue,
        name: entry.name,
      })),
      scope: { userId: 'user-1', workspaceId: 'workspace-1' },
    })
  })

  it('fails closed for stale tracked rows once the table-row surface is enforced', async () => {
    mockIsEnforced.mockReturnValue(true)
    queueTableRows(userTableRows, [
      {
        id: 'tracked-row',
        updatedAt: ROW_UPDATED_AT,
        secretProvenanceVersion: 1,
        sidecarRowId: 'tracked-row',
        sidecarStatus: 'exact',
        sidecarEntries: [],
        sidecarIsCurrent: false,
      },
    ])

    await expect(
      loadTableRowSecretProvenance([{ id: 'tracked-row', updatedAt: ROW_UPDATED_AT }], {
        userId: 'user-1',
        workspaceId: 'workspace-1',
      })
    ).resolves.toEqual({
      version: 1,
      complete: false,
      entries: [],
      scope: { userId: 'user-1', workspaceId: 'workspace-1' },
    })
  })

  /**
   * The shape that broke production: one unrecorded row in a page voided the whole read, and a
   * page is what a `query_rows` block hands downstream, so every later model boundary refused.
   */
  it('keeps a page readable when one row is unrecorded, without dropping its siblings', async () => {
    queueTableRows(userTableRows, [
      {
        id: 'unknown-row',
        updatedAt: ROW_UPDATED_AT,
        secretProvenanceVersion: 1,
        sidecarRowId: 'unknown-row',
        sidecarStatus: 'unknown',
        sidecarEntries: [],
        sidecarIsCurrent: true,
      },
      {
        id: 'tracked-row',
        updatedAt: ROW_UPDATED_AT,
        secretProvenanceVersion: 1,
        sidecarRowId: 'tracked-row',
        sidecarStatus: 'exact',
        sidecarEntries: [
          {
            columnId: 'secret-column',
            encryptedValue: 'encrypted-local',
            name: 'LOCAL_SECRET',
            sourceUserId: 'user-1',
            sourceWorkspaceId: 'workspace-1',
          },
        ],
        sidecarIsCurrent: true,
      },
    ])

    await expect(
      loadTableRowSecretProvenance(
        [
          { id: 'unknown-row', updatedAt: ROW_UPDATED_AT },
          { id: 'tracked-row', updatedAt: ROW_UPDATED_AT },
        ],
        { userId: 'user-1', workspaceId: 'workspace-1' }
      )
    ).resolves.toEqual({
      version: 1,
      complete: true,
      entries: [{ encryptedValue: 'encrypted-local', name: 'LOCAL_SECRET' }],
      scope: { userId: 'user-1', workspaceId: 'workspace-1' },
    })
    expect(mockReport).toHaveBeenCalledWith({
      surface: 'table-row',
      cause: 'row-sidecar-not-exact',
      affectedCount: 1,
      workspaceId: 'workspace-1',
      actorUserId: 'user-1',
    })
  })

  it('rejects contradictory duplicate row crossings before reading provenance', async () => {
    await expect(
      loadTableRowSecretProvenance(
        [
          { id: 'row-1', updatedAt: ROW_UPDATED_AT },
          { id: 'row-1', updatedAt: new Date(ROW_UPDATED_AT.getTime() + 1) },
        ],
        { userId: 'user-1', workspaceId: 'workspace-1' }
      )
    ).resolves.toEqual({
      version: 1,
      complete: false,
      entries: [],
      scope: { userId: 'user-1', workspaceId: 'workspace-1' },
    })
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })

  it('locks known rows in deterministic order before mutating them', async () => {
    queueTableRows(userTableRows, [{ id: 'row-a' }, { id: 'row-b' }])
    queueTableRows(userTableRows, [
      { id: 'row-a', secretProvenanceVersion: null, sidecarRowId: null },
      { id: 'row-b', secretProvenanceVersion: null, sidecarRowId: null },
    ])
    const mutate = vi.fn(async () => ({ value: 'done', affectedRowIds: ['row-b', 'row-a'] }))

    await expect(
      mutateTableRowsWithSecretProvenance(dbChainMock.db as unknown as DbTransaction, {
        rows: [
          {
            rowId: 'row-b',
            provenance: { complete: true, columns: {} },
          },
          {
            rowId: 'row-a',
            provenance: { complete: true, columns: {} },
          },
        ],
        rowState: 'existing',
        mode: 'replace',
        mutate,
      })
    ).resolves.toBe('done')

    expect(dbChainMockFns.where).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'inArray', values: ['row-a', 'row-b'] })
    )
    expect(dbChainMockFns.for).toHaveBeenCalledWith('update')
    expect(dbChainMockFns.for.mock.invocationCallOrder[0]).toBeLessThan(
      dbChainMockFns.leftJoin.mock.invocationCallOrder[0]
    )
    expect(dbChainMockFns.leftJoin.mock.invocationCallOrder[0]).toBeLessThan(
      mutate.mock.invocationCallOrder[0]
    )
    expect(mutate.mock.invocationCallOrder[0]).toBeLessThan(
      dbChainMockFns.execute.mock.invocationCallOrder[0]
    )
  })

  it('merges exact provenance after locking and binds it after the mutation', async () => {
    queueTableRows(userTableRows, [{ id: 'row-1' }])
    queueTableRows(userTableRows, [
      {
        id: 'row-1',
        updatedAt: ROW_UPDATED_AT,
        secretProvenanceVersion: 1,
        sidecarRowId: 'row-1',
        sidecarStatus: 'exact',
        sidecarEntries: [{ columnId: 'column-a', encryptedValue: 'encrypted-a', name: 'A' }],
        sidecarIsCurrent: true,
      },
    ])

    await mutateTableRowsWithSecretProvenance(dbChainMock.db as unknown as DbTransaction, {
      rows: [
        {
          rowId: 'row-1',
          provenance: {
            complete: true,
            columns: {
              'column-b': {
                version: 1,
                complete: true,
                entries: [{ encryptedValue: 'encrypted-b', name: 'B' }],
              },
            },
          },
        },
      ],
      rowState: 'existing',
      mode: 'merge',
      mutate: async () => ({ value: undefined, affectedRowIds: ['row-1'] }),
    })

    expect(pendingRowsFromLastExecute()).toEqual([
      {
        row_id: 'row-1',
        status: 'exact',
        entries: [
          { columnId: 'column-a', encryptedValue: 'encrypted-a', name: 'A' },
          { columnId: 'column-b', encryptedValue: 'encrypted-b', name: 'B' },
        ],
      },
    ])
  })

  it('promotes the legacy exact-empty baseline without losing incoming merge provenance', async () => {
    queueTableRows(userTableRows, [{ id: 'legacy-row' }])
    queueTableRows(userTableRows, [
      {
        id: 'legacy-row',
        updatedAt: ROW_UPDATED_AT,
        secretProvenanceVersion: null,
        sidecarRowId: null,
        sidecarStatus: null,
        sidecarEntries: null,
        sidecarIsCurrent: false,
      },
    ])

    await mutateTableRowsWithSecretProvenance(dbChainMock.db as unknown as DbTransaction, {
      rows: [
        {
          rowId: 'legacy-row',
          provenance: {
            complete: true,
            columns: {
              touched: { version: 1, complete: true, entries: [] },
            },
          },
        },
      ],
      rowState: 'existing',
      mode: 'merge',
      mutate: async () => ({ value: undefined, affectedRowIds: ['legacy-row'] }),
    })

    expect(pendingRowsFromLastExecute()).toEqual([
      {
        row_id: 'legacy-row',
        status: 'exact',
        entries: [],
      },
    ])
  })

  it('fails closed when merge provenance is stale or malformed', async () => {
    queueTableRows(userTableRows, [{ id: 'tracked-row' }])
    queueTableRows(userTableRows, [
      {
        id: 'tracked-row',
        updatedAt: ROW_UPDATED_AT,
        secretProvenanceVersion: 1,
        sidecarRowId: 'tracked-row',
        sidecarStatus: 'exact',
        sidecarEntries: [{ columnId: '', encryptedValue: 'encrypted-a' }],
        sidecarIsCurrent: false,
      },
    ])

    await mutateTableRowsWithSecretProvenance(dbChainMock.db as unknown as DbTransaction, {
      rows: [
        {
          rowId: 'tracked-row',
          provenance: {
            complete: true,
            columns: { touched: { version: 1, complete: true, entries: [] } },
          },
        },
      ],
      rowState: 'existing',
      mode: 'merge',
      mutate: async () => ({ value: undefined, affectedRowIds: ['tracked-row'] }),
    })

    expect(pendingRowsFromLastExecute()).toEqual([
      { row_id: 'tracked-row', status: 'unknown', entries: [], cause: 'merge-base-unvouchable' },
    ])
  })

  it('does not write a sidecar when the mutation affected no declared row', async () => {
    await mutateTableRowsWithSecretProvenance(dbChainMock.db as unknown as DbTransaction, {
      rows: [
        {
          rowId: 'missing-row',
          provenance: { complete: false, columns: {} },
        },
      ],
      rowState: 'new',
      mode: 'replace',
      mutate: async () => ({ value: undefined, affectedRowIds: [] }),
    })

    expect(dbChainMockFns.select).not.toHaveBeenCalled()
    expect(dbChainMockFns.for).not.toHaveBeenCalled()
    expect(dbChainMockFns.execute).not.toHaveBeenCalled()
    expect(mockError).not.toHaveBeenCalled()
  })

  it('does not report a planned unrecorded write when the mutation throws', async () => {
    await expect(
      mutateTableRowsWithSecretProvenance(dbChainMock.db as unknown as DbTransaction, {
        rows: [{ rowId: 'missing-row', provenance: { complete: false, columns: {} } }],
        rowState: 'new',
        mode: 'replace',
        mutate: async () => {
          throw new Error('Mutation failed')
        },
      })
    ).rejects.toThrow('Mutation failed')
    expect(mockError).not.toHaveBeenCalled()
  })

  it('reports only bound ordinary writes with their canonical table and workspace', async () => {
    dbChainMockFns.execute.mockResolvedValueOnce([
      {
        workspaceId: 'workspace-1',
        tableId: 'table-1',
        cause: 'incoming-provenance-incomplete',
        rowCount: 1,
      },
    ])
    await mutateTableRowsWithSecretProvenance(dbChainMock.db as unknown as DbTransaction, {
      rows: ['bound-row', 'unaffected-row'].map((rowId) => ({
        rowId,
        provenance: { complete: false, columns: {} },
      })),
      rowState: 'new',
      mode: 'replace',
      mutate: async () => ({ value: undefined, affectedRowIds: ['bound-row'] }),
    })
    expect(mockError).toHaveBeenCalledExactlyOnceWith(
      'Table row write staged unrecorded secret provenance',
      {
        surface: 'table-row',
        cause: 'incoming-provenance-incomplete',
        mode: 'replace',
        rowCount: 1,
        workspaceId: 'workspace-1',
        tableId: 'table-1',
      }
    )
    expect(mockError.mock.invocationCallOrder[0]).toBeGreaterThan(
      dbChainMockFns.execute.mock.invocationCallOrder[0]
    )
  })

  it('binds exact provenance for a new row without a pre-insert read', async () => {
    await mutateTableRowsWithSecretProvenance(dbChainMock.db as unknown as DbTransaction, {
      rows: [
        {
          rowId: 'new-row',
          provenance: {
            complete: true,
            columns: {
              secret: {
                version: 1,
                complete: true,
                entries: [{ encryptedValue: 'encrypted-secret', name: 'SECRET' }],
              },
            },
          },
        },
      ],
      rowState: 'new',
      mode: 'replace',
      mutate: async () => ({ value: undefined, affectedRowIds: ['new-row'] }),
    })

    expect(dbChainMockFns.select).not.toHaveBeenCalled()
    expect(dbChainMockFns.for).not.toHaveBeenCalled()
    expect(pendingRowsFromLastExecute()).toEqual([
      {
        row_id: 'new-row',
        status: 'exact',
        entries: [{ columnId: 'secret', encryptedValue: 'encrypted-secret', name: 'SECRET' }],
      },
    ])
  })

  it('binds derived rows only after their matching sidecars are written', async () => {
    queueTableRows(userTableRows, [{ id: 'legacy-row' }])

    const updatedCount = await updateTableRowsWithDerivedSecretProvenance(
      dbChainMock.db as unknown as DbTransaction,
      {
        rowWhere: eq(userTableRows.id, 'legacy-row'),
        transformation: {
          mode: 'remove-columns',
          columnIds: ['deleted-column', 'deleted-column'],
        },
      }
    )

    expect(updatedCount).toBe(1)
    expect(dbChainMockFns.execute).toHaveBeenCalledTimes(2)
    expect(boundArrayValues(dbChainMockFns.execute.mock.calls[0][0])).toEqual([])
    expect(sqlText(dbChainMockFns.execute.mock.calls[0][0])).not.toMatch(
      /SET\s+secret_provenance_version/
    )
    expect(sqlText(dbChainMockFns.execute.mock.calls[1][0])).toMatch(
      /SET\s+secret_provenance_version/
    )
    expect(dbChainMockFns.execute.mock.invocationCallOrder[0]).toBeLessThan(
      dbChainMockFns.execute.mock.invocationCallOrder[1]
    )
    expect(dbChainMockFns.limit).toHaveBeenCalledWith(1_000)
    expect(dbChainMockFns.for).toHaveBeenCalledWith('update')
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  it('attributes derived unrecorded writes after their sidecars and markers are bound', async () => {
    queueTableRows(userTableRows, [{ id: 'unknown-row' }, { id: 'malformed-row' }])
    dbChainMockFns.execute.mockResolvedValueOnce([
      {
        workspaceId: 'workspace-1',
        tableId: 'table-1',
        cause: 'derived-base-unvouchable',
        rowCount: 1,
      },
      {
        workspaceId: 'workspace-1',
        tableId: 'table-1',
        cause: 'derived-base-unnormalizable',
        rowCount: 1,
      },
    ])

    await updateTableRowsWithDerivedSecretProvenance(dbChainMock.db as unknown as DbTransaction, {
      rowWhere: eq(userTableRows.tableId, 'table-1'),
      transformation: { mode: 'remove-columns', columnIds: ['deleted-column'] },
    })

    expect(mockError).toHaveBeenCalledTimes(2)
    for (const cause of ['derived-base-unvouchable', 'derived-base-unnormalizable']) {
      expect(mockError).toHaveBeenCalledWith(
        'Table row write staged unrecorded secret provenance',
        {
          surface: 'table-row',
          cause,
          mode: 'remove-columns',
          rowCount: 1,
          workspaceId: 'workspace-1',
          tableId: 'table-1',
        }
      )
    }
    expect(mockError.mock.invocationCallOrder[0]).toBeGreaterThan(
      dbChainMockFns.execute.mock.invocationCallOrder[1]
    )
  })

  it('preserves legacy fork compatibility without manufacturing provenance', () => {
    expect(
      classifyTableRowSecretProvenanceForCopy({
        secretProvenanceVersion: null,
        provenanceIsCurrent: false,
        provenance: null,
      })
    ).toEqual({ mode: 'legacy' })
  })

  it('preserves more than ten thousand column bindings when they describe eleven secrets', () => {
    const entries = Array.from({ length: 1_000 }, (_, column) =>
      Array.from({ length: 11 }, (_, secret) => ({
        columnId: `column-${column}`,
        encryptedValue: `encrypted-${secret}`,
        name: `SECRET_${secret}`,
        sourceUserId: column === 999 ? 'foreign-user' : 'user-1',
        sourceWorkspaceId: 'workspace-1',
      }))
    ).flat()

    const classified = classifyTableRowSecretProvenanceForCopy({
      secretProvenanceVersion: 1,
      provenanceIsCurrent: true,
      provenance: { status: 'exact', entries },
    })
    expect(classified).toMatchObject({ mode: 'tracked', status: 'exact' })
    if (classified.mode !== 'tracked') throw new Error('Expected tracked provenance')
    expect(classified.entries).toHaveLength(11_000)
    expect(new Set(classified.entries.map((entry) => JSON.stringify(entry)))).toEqual(
      new Set(entries.map((entry) => JSON.stringify(entry)))
    )
  })

  it('deduplicates repeated bindings before charging the secret or serialized budgets', () => {
    const entry = { columnId: 'column-1', encryptedValue: 'encrypted-secret' }
    expect(
      classifyTableRowSecretProvenanceForCopy({
        secretProvenanceVersion: 1,
        provenanceIsCurrent: true,
        provenance: { status: 'exact', entries: Array.from({ length: 11_000 }, () => entry) },
      })
    ).toEqual({ mode: 'tracked', status: 'exact', entries: [entry] })
  })

  it('keeps distinct binding fields separate even when they contain delimiter characters', () => {
    const entries = [
      { columnId: 'column\u0000one', encryptedValue: 'two' },
      { columnId: 'column', encryptedValue: 'one\u0000two' },
    ]
    expect(
      classifyTableRowSecretProvenanceForCopy({
        secretProvenanceVersion: 1,
        provenanceIsCurrent: true,
        provenance: { status: 'exact', entries },
      })
    ).toEqual({ mode: 'tracked', status: 'exact', entries: [entries[1], entries[0]] })
  })

  it('still rejects a stored row carrying ten thousand and one distinct encrypted values', () => {
    const entries = Array.from({ length: 10_001 }, (_, index) => ({
      columnId: 'column-1',
      encryptedValue: `encrypted-${index}`,
    }))
    expect(
      classifyTableRowSecretProvenanceForCopy({
        secretProvenanceVersion: 1,
        provenanceIsCurrent: true,
        provenance: { status: 'exact', entries },
      })
    ).toEqual({ mode: 'tracked', status: 'unknown', entries: [] })
  })

  it('stops before later bindings when one entry already exceeds the serialized budget', () => {
    const entries = [
      { columnId: 'column-1', encryptedValue: 'x'.repeat(PROVENANCE_MAX_SERIALIZED_BYTES + 1) },
    ]
    const readNextEntry = vi.fn(() => {
      throw new Error('Oversized provenance must stop before the next entry')
    })
    Object.defineProperty(entries, 1, { get: readNextEntry, enumerable: true })
    expect(
      classifyTableRowSecretProvenanceForCopy({
        secretProvenanceVersion: 1,
        provenanceIsCurrent: true,
        provenance: { status: 'exact', entries },
      })
    ).toEqual({ mode: 'tracked', status: 'unknown', entries: [] })
    expect(readNextEntry).not.toHaveBeenCalled()
  })

  it('charges each retained column binding against the serialized budget even for one secret', () => {
    const encryptedValue = 'x'.repeat(PROVENANCE_MAX_SERIALIZED_BYTES / 2)
    expect(
      classifyTableRowSecretProvenanceForCopy({
        secretProvenanceVersion: 1,
        provenanceIsCurrent: true,
        provenance: {
          status: 'exact',
          entries: [
            { columnId: 'column-1', encryptedValue },
            { columnId: 'column-2', encryptedValue },
          ],
        },
      })
    ).toEqual({ mode: 'tracked', status: 'unknown', entries: [] })
  })

  it('copies only exact provenance bound to the current source row version', () => {
    const exact = classifyTableRowSecretProvenanceForCopy({
      secretProvenanceVersion: 1,
      provenanceIsCurrent: true,
      provenance: {
        status: 'exact',
        entries: [{ columnId: 'column-a', encryptedValue: 'encrypted-a', name: 'A' }],
      },
    })
    const stale = classifyTableRowSecretProvenanceForCopy({
      secretProvenanceVersion: 1,
      provenanceIsCurrent: false,
      provenance: {
        status: 'exact',
        entries: [{ columnId: 'column-a', encryptedValue: 'encrypted-a', name: 'A' }],
      },
    })

    expect(exact).toEqual({
      mode: 'tracked',
      status: 'exact',
      entries: [{ columnId: 'column-a', encryptedValue: 'encrypted-a', name: 'A' }],
    })
    expect(stale).toEqual({ mode: 'tracked', status: 'unknown', entries: [] })
  })

  it('fails closed for tracked, missing, or inconsistent fork sidecars', () => {
    expect(
      classifyTableRowSecretProvenanceForCopy({
        secretProvenanceVersion: 1,
        provenanceIsCurrent: false,
        provenance: null,
      })
    ).toEqual({ mode: 'tracked', status: 'unknown', entries: [] })
    expect(
      classifyTableRowSecretProvenanceForCopy({
        secretProvenanceVersion: null,
        provenanceIsCurrent: true,
        provenance: { status: 'exact', entries: [] },
      })
    ).toEqual({ mode: 'legacy' })
    expect(
      classifyTableRowSecretProvenanceForCopy({
        secretProvenanceVersion: 1,
        provenanceIsCurrent: true,
        provenance: { status: 'unknown', entries: [] },
      })
    ).toEqual({ mode: 'tracked', status: 'unknown', entries: [] })
    expect(
      classifyTableRowSecretProvenanceForCopy({
        secretProvenanceVersion: 1,
        provenanceIsCurrent: true,
        provenance: {
          status: 'exact',
          entries: [{ columnId: '', encryptedValue: 'malformed' }],
        },
      })
    ).toEqual({ mode: 'tracked', status: 'unknown', entries: [] })
  })
})
