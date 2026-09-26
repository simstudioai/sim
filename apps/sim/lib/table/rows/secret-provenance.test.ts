import { userTableDefinitions, userTableRows } from '@sim/db/schema'
import { dbChainMock, dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { getMockLogger } from '@sim/testing/mocks/logger.mock'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DbTransaction } from '@/lib/table/planner'
import {
  classifyTableRowSecretProvenanceForCopy,
  getTableSnapshotModelMountSafety,
  loadTableRowSecretProvenance,
  mutateTableRowsWithSecretProvenance,
  TableRowProvenanceReader,
  updateTableRowsWithDerivedSecretProvenance,
} from '@/lib/table/rows/secret-provenance'

const { error: mockError } = getMockLogger('TableRowSecretProvenance')

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
    resetDbChainMock()
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
  })

  it('refuses snapshot provenance absences', async () => {
    queueTableRows(userTableDefinitions, [{ rowsVersion: 7 }])
    queueTableRows(userTableDefinitions, [{ rowsVersion: 7 }])
    queueTableRows(userTableRows, [{ unsafeCount: '0', unrecordedCount: '3' }])

    await expect(
      getTableSnapshotModelMountSafety({
        tableId: 'table-1',
        workspaceId: 'workspace-1',
        rowsVersion: 7,
      })
    ).resolves.toBe('unsafe-provenance')
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

  it.each([{ selectedColumns: ['input-column'] }, { selectedColumns: [] }])(
    'captures only selected worker input columns: %j',
    async ({ selectedColumns }) => {
      queueTableRows(userTableRows, [
        {
          id: 'tracked-row',
          updatedAt: ROW_UPDATED_AT,
          secretProvenanceVersion: 1,
          sidecarStatus: 'exact',
          sidecarIsCurrent: true,
          sidecarEntries: ['input-column', 'output-column'].map((columnId) => ({
            columnId,
            encryptedValue: `encrypted-${columnId}`,
            name: columnId,
            sourceUserId: 'user-1',
            sourceWorkspaceId: 'workspace-1',
          })),
        },
      ])
      const reader = new TableRowProvenanceReader(
        { userId: 'user-1', workspaceId: 'workspace-1' },
        new Set(selectedColumns)
      )

      await reader.capture(dbChainMock.db as unknown as DbTransaction, [
        {
          id: 'tracked-row',
          updatedAt: ROW_UPDATED_AT,
          data: { 'input-column': 'input-secret', 'output-column': 'output-secret' },
        },
      ])

      expect(reader.exportProvenance()).toEqual({
        version: 1,
        complete: true,
        scope: { userId: 'user-1', workspaceId: 'workspace-1' },
        entries: selectedColumns.map((name) => ({ name, encryptedValue: `encrypted-${name}` })),
      })
    }
  )

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

  it('refuses stale tracked rows', async () => {
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

  it('refuses a page containing an unknown tracked row', async () => {
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
      complete: false,
      entries: [],
      scope: { userId: 'user-1', workspaceId: 'workspace-1' },
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
