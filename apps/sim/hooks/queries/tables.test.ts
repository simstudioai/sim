/**
 * @vitest-environment node
 */

import { useQuery } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { queryClient, cacheStore } = vi.hoisted(() => {
  const cache = new Map<string, unknown>()
  return {
    cacheStore: cache,
    queryClient: {
      cancelQueries: vi.fn().mockResolvedValue(undefined),
      invalidateQueries: vi.fn().mockResolvedValue(undefined),
      getQueryData: vi.fn((key: readonly unknown[]) => cache.get(JSON.stringify(key))),
      setQueryData: vi.fn((key: readonly unknown[], updater: unknown) => {
        const k = JSON.stringify(key)
        const prev = cache.get(k)
        const next =
          typeof updater === 'function' ? (updater as (p: unknown) => unknown)(prev) : updater
        cache.set(k, next)
        return next
      }),
      getQueriesData: vi.fn((opts: { queryKey: readonly unknown[] }) => {
        const prefix = JSON.stringify(opts.queryKey).slice(0, -1)
        return [...cache.entries()]
          .filter(([k]) => k.startsWith(prefix))
          .map(([k, v]) => [JSON.parse(k), v])
      }),
      fetchQuery: vi.fn(),
      removeQueries: vi.fn(),
    },
  }
})

vi.mock('@tanstack/react-query', () => ({
  keepPreviousData: {},
  infiniteQueryOptions: (opts: unknown) => opts,
  useQuery: vi.fn(),
  useInfiniteQuery: vi.fn(),
  useQueryClient: vi.fn(() => queryClient),
  useMutation: vi.fn((options) => options),
}))

vi.mock('@/lib/api/client/request', () => ({
  requestJson: vi.fn(),
}))

vi.mock('@/lib/api/client/errors', () => ({
  isValidationError: vi.fn(() => false),
  isApiClientError: vi.fn(() => false),
  extractValidationIssues: vi.fn(() => []),
}))

vi.mock('@/app/workspace/providers/socket-provider', () => ({
  useSocket: vi.fn(() => ({ socket: null })),
}))

vi.mock('@sim/emcn', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

import { isApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import {
  getTableRowContract,
  listTableNamesContract,
  type TableViewWire,
} from '@/lib/api/contracts/tables'
import {
  TABLE_DETAIL_STALE_TIME,
  tableRowsInfiniteOptions,
  tableRowsParamsKey,
  useBatchUpdateTableRows,
  useDeleteColumn,
  useDeleteTableRow,
  useDeleteTableRows,
  useReferenceRowPreview,
  useRestoreTable,
  useTableNames,
  useUpdateColumn,
  useUpdateTableRow,
  useUpdateTableView,
} from '@/hooks/queries/tables'
import { tableKeys } from '@/hooks/queries/utils/table-keys'

const TABLE_ID = 'tbl-1'
const WORKSPACE_ID = 'ws-1'

/**
 * Where a paged row list actually lives. Seeding at the bare `rowsRoot` prefix would
 * exercise a key no hook writes, and would keep matching a cache walk that has been
 * narrowed away from the `find` sibling hanging off the same parent.
 */
const ROWS_KEY = tableKeys.infiniteRows(TABLE_ID, tableRowsParamsKey({ pageSize: 1000 }))

function setCache(key: readonly unknown[], value: unknown) {
  cacheStore.set(JSON.stringify(key), value)
}

function getCache<T>(key: readonly unknown[]): T | undefined {
  return cacheStore.get(JSON.stringify(key)) as T | undefined
}

beforeEach(() => {
  cacheStore.clear()
  vi.clearAllMocks()
})

describe('useTableNames', () => {
  it('loads only the requested table names once with a canonical cache key', async () => {
    vi.mocked(requestJson).mockResolvedValueOnce({
      success: true,
      data: { tables: [{ id: TABLE_ID, name: 'Accounts' }] },
    })

    useTableNames(WORKSPACE_ID, ['tbl-2', TABLE_ID, 'tbl-2'])

    const options = vi.mocked(useQuery).mock.calls.at(-1)?.[0] as {
      enabled: boolean
      queryKey: readonly unknown[]
      queryFn: (context: { signal: AbortSignal }) => Promise<unknown>
    }
    const signal = new AbortController().signal
    await expect(options.queryFn({ signal })).resolves.toEqual([{ id: TABLE_ID, name: 'Accounts' }])
    expect(options).toMatchObject({
      enabled: true,
      queryKey: tableKeys.names(WORKSPACE_ID, [TABLE_ID, 'tbl-2']),
    })
    expect(options.queryKey.slice(0, tableKeys.namesRoot().length)).toEqual(tableKeys.namesRoot())
    expect(options.queryKey.slice(0, tableKeys.lists().length)).not.toEqual(tableKeys.lists())
    expect(requestJson).toHaveBeenCalledWith(listTableNamesContract, {
      body: { workspaceId: WORKSPACE_ID, tableIds: [TABLE_ID, 'tbl-2'] },
      signal,
    })
  })

  it('does not fetch when there are no referenced tables', () => {
    useTableNames(WORKSPACE_ID, [])

    const options = vi.mocked(useQuery).mock.calls.at(-1)?.[0] as { enabled: boolean }
    expect(options.enabled).toBe(false)
  })
})

describe('useReferenceRowPreview', () => {
  function getQueryOptions() {
    return vi.mocked(useQuery).mock.calls.at(-1)?.[0] as {
      enabled: boolean
      gcTime: number
      queryKey: readonly unknown[]
      refetchOnMount: 'always'
      refetchOnReconnect: boolean
      refetchOnWindowFocus: boolean
      staleTime: number
      queryFn: (context: { signal: AbortSignal }) => Promise<unknown>
    }
  }

  it('isolates each opening and fetches only the referenced row', async () => {
    const row = { id: 'row-1', data: { name: 'Acme' } }
    const table = { id: TABLE_ID, name: 'Accounts', schema: { columns: [] } }
    const signal = new AbortController().signal
    queryClient.fetchQuery.mockResolvedValueOnce(table)
    vi.mocked(requestJson).mockResolvedValueOnce({ data: { row } })

    useReferenceRowPreview({
      workspaceId: WORKSPACE_ID,
      tableId: TABLE_ID,
      rowId: row.id,
      sourceRowId: 'source-row-1',
      sourceColumnKey: 'account',
    })

    const options = getQueryOptions()
    expect(options).toMatchObject({
      enabled: true,
      gcTime: 0,
      queryKey: tableKeys.referencePreview(TABLE_ID, row.id, 'source-row-1', 'account'),
      refetchOnMount: 'always',
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
      staleTime: Number.POSITIVE_INFINITY,
    })
    await expect(options.queryFn({ signal })).resolves.toEqual({
      table,
      row,
      referenceTables: [],
    })
    expect(options).not.toHaveProperty('placeholderData')
    expect(queryClient.fetchQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: tableKeys.detail(TABLE_ID),
        staleTime: TABLE_DETAIL_STALE_TIME,
      })
    )
    expect(requestJson).toHaveBeenCalledOnce()
    expect(requestJson).toHaveBeenCalledWith(getTableRowContract, {
      params: { tableId: TABLE_ID, rowId: row.id },
      query: { workspaceId: WORKSPACE_ID },
      signal,
    })
  })

  it('loads nested reference table names in one request before resolving the preview', async () => {
    const row = { id: 'row-1', data: { owner: 'owner-row-1' } }
    const table = {
      id: TABLE_ID,
      name: 'Accounts',
      schema: {
        columns: [
          {
            id: 'owner-1',
            name: 'Owner',
            type: 'reference',
            referenceTableId: 'tbl-owners',
          },
          {
            id: 'owner-2',
            name: 'Backup owner',
            type: 'reference',
            referenceTableId: 'tbl-owners',
          },
        ],
      },
    }
    const referenceTables = [{ id: 'tbl-owners', name: 'Owners' }]
    const signal = new AbortController().signal
    queryClient.fetchQuery.mockResolvedValueOnce(table)
    vi.mocked(requestJson)
      .mockResolvedValueOnce({ data: { row } })
      .mockResolvedValueOnce({ success: true, data: { tables: referenceTables } })

    useReferenceRowPreview({
      workspaceId: WORKSPACE_ID,
      tableId: TABLE_ID,
      rowId: row.id,
      sourceRowId: 'source-row-1',
      sourceColumnKey: 'account',
    })

    await expect(getQueryOptions().queryFn({ signal })).resolves.toEqual({
      table,
      row,
      referenceTables,
    })
    expect(requestJson).toHaveBeenNthCalledWith(2, listTableNamesContract, {
      body: { workspaceId: WORKSPACE_ID, tableIds: ['tbl-owners'] },
      signal,
    })
  })

  it('does not fetch until every referenced-row identity is available', () => {
    useReferenceRowPreview({
      workspaceId: WORKSPACE_ID,
      tableId: TABLE_ID,
      rowId: undefined,
    })

    expect(getQueryOptions().enabled).toBe(false)
  })

  it('returns a null row when the referenced row no longer exists', async () => {
    const table = { id: TABLE_ID, name: 'Accounts', schema: { columns: [] } }
    queryClient.fetchQuery.mockResolvedValueOnce(table)
    vi.mocked(requestJson).mockRejectedValueOnce({ status: 404 })
    vi.mocked(isApiClientError).mockReturnValueOnce(true)

    useReferenceRowPreview({
      workspaceId: WORKSPACE_ID,
      tableId: TABLE_ID,
      rowId: 'missing-row',
      sourceRowId: 'source-row-1',
      sourceColumnKey: 'account',
    })

    await expect(
      getQueryOptions().queryFn({ signal: new AbortController().signal })
    ).resolves.toEqual({
      table,
      row: null,
      referenceTables: [],
    })
  })

  it('propagates non-not-found row errors', async () => {
    const error = new Error('Failed to load row')
    queryClient.fetchQuery.mockResolvedValueOnce({
      id: TABLE_ID,
      name: 'Accounts',
      schema: { columns: [] },
    })
    vi.mocked(requestJson).mockRejectedValueOnce(error)

    useReferenceRowPreview({
      workspaceId: WORKSPACE_ID,
      tableId: TABLE_ID,
      rowId: 'row-1',
      sourceRowId: 'source-row-1',
      sourceColumnKey: 'account',
    })

    await expect(getQueryOptions().queryFn({ signal: new AbortController().signal })).rejects.toBe(
      error
    )
  })

  it('uses the source cell to identify each preview opening', () => {
    useReferenceRowPreview({
      workspaceId: WORKSPACE_ID,
      tableId: TABLE_ID,
      rowId: 'row-1',
      sourceRowId: 'source-row-1',
      sourceColumnKey: 'account',
    })
    const firstOpening = getQueryOptions().queryKey

    useReferenceRowPreview({
      workspaceId: WORKSPACE_ID,
      tableId: TABLE_ID,
      rowId: 'row-1',
      sourceRowId: 'source-row-2',
      sourceColumnKey: 'account',
    })

    expect(getQueryOptions().queryKey).not.toEqual(firstOpening)
  })
})

describe('useBatchUpdateTableRows', () => {
  it('invalidates matching reference previews after a batch write settles', () => {
    const hook = useBatchUpdateTableRows({ workspaceId: WORKSPACE_ID, tableId: TABLE_ID })
    const updates = [
      { rowId: 'row-1', data: { name: 'Acme' } },
      { rowId: 'row-2', data: { name: 'Globex' } },
    ]

    hook.onSettled?.(undefined, null, { updates }, undefined)

    expect(queryClient.invalidateQueries).toHaveBeenCalledOnce()
    const options = queryClient.invalidateQueries.mock.calls[0]?.[0]
    expect(options?.queryKey).toEqual(tableKeys.referencePreviews())
    expect(
      options?.predicate({
        queryKey: tableKeys.referencePreview(TABLE_ID, 'row-1', 'source-row', 'account'),
      })
    ).toBe(true)
    expect(
      options?.predicate({
        queryKey: tableKeys.referencePreview(TABLE_ID, 'row-3', 'source-row', 'account'),
      })
    ).toBe(false)
    expect(
      options?.predicate({
        queryKey: tableKeys.referencePreview('other-table', 'row-1', 'source-row', 'account'),
      })
    ).toBe(false)
  })
})

describe('reference preview invalidation', () => {
  function expectPreviewInvalidation(rowIds: string[]) {
    const call = queryClient.invalidateQueries.mock.calls.find(
      ([options]) =>
        JSON.stringify(options?.queryKey) === JSON.stringify(tableKeys.referencePreviews())
    )
    expect(call).toBeDefined()
    const options = call?.[0]
    for (const rowId of rowIds) {
      expect(
        options?.predicate({
          queryKey: tableKeys.referencePreview(TABLE_ID, rowId, 'source-row', 'account'),
        })
      ).toBe(true)
    }
    expect(
      options?.predicate({
        queryKey: tableKeys.referencePreview(TABLE_ID, 'untouched-row', 'source-row', 'account'),
      })
    ).toBe(false)
  }

  it('invalidates a referenced row after an update settles', () => {
    const hook = useUpdateTableRow({ workspaceId: WORKSPACE_ID, tableId: TABLE_ID })

    hook.onSettled?.(undefined, null, { rowId: 'row-1', data: { name: 'Acme' } }, undefined)

    expectPreviewInvalidation(['row-1'])
  })

  it('invalidates a referenced row after a delete settles', () => {
    const hook = useDeleteTableRow({ workspaceId: WORKSPACE_ID, tableId: TABLE_ID })

    hook.onSettled?.(undefined, null, 'row-1', undefined)

    expectPreviewInvalidation(['row-1'])
  })

  it('invalidates every referenced row after a bulk delete settles', () => {
    const hook = useDeleteTableRows({ workspaceId: WORKSPACE_ID, tableId: TABLE_ID })

    hook.onSettled?.(undefined, null, ['row-1', 'row-2'], undefined)

    expectPreviewInvalidation(['row-1', 'row-2'])
  })
})

describe('useUpdateTableView autosave ordering', () => {
  it('serializes config and layout patches for the same table', () => {
    const hook = useUpdateTableView({ workspaceId: WORKSPACE_ID, tableId: TABLE_ID })

    expect(hook.scope).toEqual({ id: `table-view:${TABLE_ID}` })
  })

  it('does not hold the serial mutation queue open for list reconciliation', () => {
    const hook = useUpdateTableView({ workspaceId: WORKSPACE_ID, tableId: TABLE_ID })

    expect(hook.onSettled?.(undefined, null, { viewId: 'view-1' }, undefined)).toBeUndefined()
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: tableKeys.views(TABLE_ID),
    })
  })

  it('optimistically demotes the previous default when a view is promoted', () => {
    const previousDefault: TableViewWire = {
      id: 'view-default',
      tableId: TABLE_ID,
      name: 'Default',
      config: {},
      isDefault: true,
      createdBy: 'user-1',
      createdAt: new Date('2026-08-15T01:00:00.000Z'),
      updatedAt: new Date('2026-08-15T01:00:00.000Z'),
    }
    const promoted: TableViewWire = {
      ...previousDefault,
      id: 'view-promoted',
      name: 'My view',
      updatedAt: new Date('2026-08-15T02:00:00.000Z'),
    }
    setCache(tableKeys.views(TABLE_ID), [
      previousDefault,
      { ...promoted, isDefault: false, updatedAt: previousDefault.updatedAt },
    ])

    const hook = useUpdateTableView({ workspaceId: WORKSPACE_ID, tableId: TABLE_ID })
    hook.onSuccess?.(promoted, { viewId: promoted.id, isDefault: true }, undefined, undefined)

    expect(getCache<TableViewWire[]>(tableKeys.views(TABLE_ID))).toEqual([
      { ...previousDefault, isDefault: false },
      promoted,
    ])
  })

  it('ignores a stale promotion response instead of demoting the newer default', () => {
    const newerDefault: TableViewWire = {
      id: 'view-newer-default',
      tableId: TABLE_ID,
      name: 'Newer default',
      config: {},
      isDefault: true,
      createdBy: 'user-1',
      createdAt: new Date('2026-08-15T01:00:00.000Z'),
      updatedAt: new Date('2026-08-15T03:00:00.000Z'),
    }
    const stalePromotion: TableViewWire = {
      ...newerDefault,
      id: 'view-stale',
      name: 'Stale view',
      updatedAt: new Date('2026-08-15T02:00:00.000Z'),
    }
    const cachedStaleRow: TableViewWire = {
      ...stalePromotion,
      isDefault: false,
      updatedAt: new Date('2026-08-15T01:00:00.000Z'),
    }
    setCache(tableKeys.views(TABLE_ID), [newerDefault, cachedStaleRow])

    const hook = useUpdateTableView({ workspaceId: WORKSPACE_ID, tableId: TABLE_ID })
    hook.onSuccess?.(
      stalePromotion,
      { viewId: stalePromotion.id, isDefault: true },
      undefined,
      undefined
    )

    expect(getCache<TableViewWire[]>(tableKeys.views(TABLE_ID))).toEqual([
      newerDefault,
      cachedStaleRow,
    ])
  })
})

describe('useDeleteColumn optimistic update', () => {
  it('removes column from schema cache, strips its width, and clears it from row data', async () => {
    setCache(tableKeys.detail(TABLE_ID), {
      id: TABLE_ID,
      schema: {
        columns: [
          { name: 'name', type: 'string' },
          { name: 'age', type: 'number' },
        ],
      },
      metadata: {
        columnWidths: { name: 200, age: 100 },
      },
    })
    setCache(ROWS_KEY, {
      rows: [
        { id: 'r1', data: { name: 'a', age: 1 } },
        { id: 'r2', data: { name: 'b', age: 2 } },
      ],
      totalCount: 2,
    })

    const hook = useDeleteColumn({ workspaceId: WORKSPACE_ID, tableId: TABLE_ID })
    const ctx = await hook.onMutate?.('age')

    const detail = getCache<{
      schema: { columns: Array<{ name: string }> }
      metadata: { columnWidths: Record<string, number> }
    }>(tableKeys.detail(TABLE_ID))
    expect(detail?.schema.columns.map((c) => c.name)).toEqual(['name'])
    expect(detail?.metadata.columnWidths).toEqual({ name: 200 })

    const rows = getCache<{ rows: Array<{ data: Record<string, unknown> }> }>(ROWS_KEY)
    expect(rows?.rows.every((r) => !('age' in r.data))).toBe(true)
    expect(rows?.rows[0]?.data).toEqual({ name: 'a' })

    expect(ctx?.previousDetail).toBeDefined()
    expect(ctx?.rowSnapshots?.length).toBeGreaterThan(0)
  })

  /**
   * The `find` cache hangs off the same `rowsRoot` parent as the paged rows but holds
   * `{matches, truncated}` — no `pages`, no `rows`. A cache walk starting at the shared
   * parent reaches it and throws inside `onMutate`, rejecting the mutation before it ever
   * reaches the server: search a table, dismiss the search, then edit a cell.
   */
  it('survives a cached search result hanging off the shared rows prefix', async () => {
    setCache(tableKeys.detail(TABLE_ID), {
      id: TABLE_ID,
      schema: { columns: [{ name: 'age', type: 'number' }] },
    })
    setCache(ROWS_KEY, {
      rows: [{ id: 'r1', data: { age: 1 } }],
      totalCount: 1,
    })
    setCache(tableKeys.find(TABLE_ID, 'q'), { matches: [{ rowId: 'r1', column: 'age' }] })

    const hook = useDeleteColumn({ workspaceId: WORKSPACE_ID, tableId: TABLE_ID })

    await expect(hook.onMutate?.('age')).resolves.toBeDefined()

    const rows = getCache<{ rows: Array<{ data: Record<string, unknown> }> }>(ROWS_KEY)
    expect(rows?.rows[0]?.data).toEqual({})
    /** The find entry is match coordinates, not row values — it must be left untouched. */
    expect(getCache<{ matches: unknown[] }>(tableKeys.find(TABLE_ID, 'q'))?.matches).toHaveLength(1)
  })

  it('rolls back schema and rows on error using snapshots', async () => {
    const originalDetail = {
      id: TABLE_ID,
      schema: { columns: [{ name: 'name' }, { name: 'age' }] },
      metadata: { columnWidths: { name: 200, age: 100 } },
    }
    const originalRows = {
      rows: [{ id: 'r1', data: { name: 'a', age: 1 } }],
      totalCount: 1,
    }
    setCache(tableKeys.detail(TABLE_ID), originalDetail)
    setCache(ROWS_KEY, originalRows)

    const hook = useDeleteColumn({ workspaceId: WORKSPACE_ID, tableId: TABLE_ID })
    const ctx = await hook.onMutate?.('age')

    expect(getCache(tableKeys.detail(TABLE_ID))).not.toEqual(originalDetail)

    hook.onError?.(new Error('boom'), 'age', ctx)

    expect(getCache(tableKeys.detail(TABLE_ID))).toEqual(originalDetail)
    expect(getCache(ROWS_KEY)).toEqual(originalRows)
  })

  it('invalidates schema, rows, lists, and mounted reference previews in onSettled', () => {
    const hook = useDeleteColumn({ workspaceId: WORKSPACE_ID, tableId: TABLE_ID })
    hook.onSettled?.(undefined, null, 'age', undefined)

    const calls = queryClient.invalidateQueries.mock.calls.map((c) => c[0]?.queryKey)
    expect(calls).toEqual(
      expect.arrayContaining([
        tableKeys.detail(TABLE_ID),
        tableKeys.rowsRoot(TABLE_ID),
        tableKeys.lists(),
        tableKeys.referencePreviewsForTable(TABLE_ID),
      ])
    )
  })
})

describe('useUpdateColumn optimistic update', () => {
  it('writes the column update to the schema cache and rolls back on error', async () => {
    const original = {
      id: TABLE_ID,
      schema: {
        columns: [
          { name: 'name', type: 'string' },
          { name: 'age', type: 'string' },
        ],
      },
    }
    setCache(tableKeys.detail(TABLE_ID), original)

    const hook = useUpdateColumn({ workspaceId: WORKSPACE_ID, tableId: TABLE_ID })
    const ctx = await hook.onMutate?.({ columnName: 'age', updates: { type: 'number' } })

    const after = getCache<{ schema: { columns: Array<{ name: string; type: string }> } }>(
      tableKeys.detail(TABLE_ID)
    )
    expect(after?.schema.columns.find((c) => c.name === 'age')?.type).toBe('number')

    hook.onError?.(new Error('boom'), { columnName: 'age', updates: { type: 'number' } }, ctx)

    expect(getCache(tableKeys.detail(TABLE_ID))).toEqual(original)
  })

  it('renames metadata-only: patches the column name + stamps id, leaves row data untouched', async () => {
    setCache(tableKeys.detail(TABLE_ID), {
      id: TABLE_ID,
      schema: { columns: [{ name: 'age', type: 'number' }] },
    })
    setCache(ROWS_KEY, {
      rows: [
        { id: 'r1', data: { age: 30 } },
        { id: 'r2', data: { age: 40 } },
      ],
      totalCount: 2,
    })

    const hook = useUpdateColumn({ workspaceId: WORKSPACE_ID, tableId: TABLE_ID })
    await hook.onMutate?.({ columnName: 'age', updates: { name: 'years' } })

    // Row data is id-keyed; a rename never moves it. The stored key (`age`)
    // becomes the column's stamped id, so cells stay reachable via getColumnId.
    const rows = getCache<{ rows: Array<{ data: Record<string, unknown> }> }>(ROWS_KEY)
    expect(rows?.rows[0]?.data).toEqual({ age: 30 })
    expect(rows?.rows[1]?.data).toEqual({ age: 40 })

    const detail = getCache<{ schema: { columns: Array<{ id?: string; name: string }> } }>(
      tableKeys.detail(TABLE_ID)
    )
    expect(detail?.schema.columns[0]).toMatchObject({ id: 'age', name: 'years' })
  })

  it('invalidates mounted previews when the referenced table schema changes', () => {
    const hook = useUpdateColumn({ workspaceId: WORKSPACE_ID, tableId: TABLE_ID })
    hook.onSettled?.(undefined, null, { columnName: 'age', updates: { name: 'years' } }, undefined)

    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: tableKeys.referencePreviewsForTable(TABLE_ID),
    })
  })
})

describe('useRestoreTable cache invalidation', () => {
  it('primes the table detail cache and clears stale rows for the restored table', () => {
    const hook = useRestoreTable()
    const table = {
      id: TABLE_ID,
      name: 'Restored table',
      schema: { columns: [{ name: 'name', type: 'string' }] },
      rowCount: 1,
      maxRows: 100,
      workspaceId: WORKSPACE_ID,
      createdBy: 'user-1',
      archivedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    hook.onSuccess?.({ success: true, data: { table } }, TABLE_ID, undefined)

    expect(getCache(tableKeys.detail(TABLE_ID))).toEqual(table)
    expect(queryClient.removeQueries).toHaveBeenCalledWith({
      queryKey: tableKeys.rowsRoot(TABLE_ID),
    })
  })

  it('invalidates names, previews, lists, table detail, and row data for the restored table', () => {
    const hook = useRestoreTable()
    hook.onSettled?.(undefined, null, TABLE_ID, undefined)

    const calls = queryClient.invalidateQueries.mock.calls.map((c) => c[0]?.queryKey)
    expect(calls).toEqual(
      expect.arrayContaining([
        tableKeys.lists(),
        tableKeys.namesRoot(),
        tableKeys.detail(TABLE_ID),
        tableKeys.rowsRoot(TABLE_ID),
        tableKeys.referencePreviewsForTable(TABLE_ID),
      ])
    )
  })
})

describe('useDeleteColumn case-insensitive row cleanup', () => {
  it('strips the row data key even when stored casing differs from the requested name', async () => {
    setCache(tableKeys.detail(TABLE_ID), {
      id: TABLE_ID,
      schema: { columns: [{ name: 'Age', type: 'number' }] },
    })
    setCache(ROWS_KEY, {
      rows: [{ id: 'r1', data: { Age: 30, name: 'a' } }],
      totalCount: 1,
    })

    const hook = useDeleteColumn({ workspaceId: WORKSPACE_ID, tableId: TABLE_ID })
    await hook.onMutate?.('age')

    const rows = getCache<{ rows: Array<{ data: Record<string, unknown> }> }>(ROWS_KEY)
    expect(rows?.rows[0]?.data).toEqual({ name: 'a' })
  })
})

describe('tableRowsParamsKey', () => {
  it('produces the same key for identical params', () => {
    const k1 = tableRowsParamsKey({ pageSize: 1000, filter: null, sort: null })
    const k2 = tableRowsParamsKey({ pageSize: 1000, filter: null, sort: null })
    expect(k1).toBe(k2)
  })

  it('treats undefined filter and sort as null', () => {
    const withUndefined = tableRowsParamsKey({ pageSize: 1000, filter: undefined, sort: undefined })
    const withNull = tableRowsParamsKey({ pageSize: 1000, filter: null, sort: null })
    expect(withUndefined).toBe(withNull)
  })

  it('produces different keys for different filters', () => {
    const k1 = tableRowsParamsKey({ pageSize: 1000, filter: null, sort: null })
    const k2 = tableRowsParamsKey({
      pageSize: 1000,
      filter: { column: 'name', operator: 'eq', value: 'Alice' } as never,
      sort: null,
    })
    expect(k1).not.toBe(k2)
  })

  it('produces different keys for different page sizes', () => {
    const k1 = tableRowsParamsKey({ pageSize: 1000, filter: null, sort: null })
    const k2 = tableRowsParamsKey({ pageSize: 500, filter: null, sort: null })
    expect(k1).not.toBe(k2)
  })

  it('produces different keys for different sorts', () => {
    const k1 = tableRowsParamsKey({ pageSize: 1000, filter: null, sort: null })
    const k2 = tableRowsParamsKey({
      pageSize: 1000,
      filter: null,
      sort: { column: 'name', direction: 'asc' } as never,
    })
    expect(k1).not.toBe(k2)
  })
})

describe('tableRowsInfiniteOptions', () => {
  const PAGE_SIZE = 1000

  interface PageFixture {
    rows: Array<{ id: string; orderKey?: string }>
    totalCount: number | null
  }

  function makeOpts(pageSize = PAGE_SIZE, sort: unknown = null) {
    return tableRowsInfiniteOptions({
      workspaceId: WORKSPACE_ID,
      tableId: TABLE_ID,
      pageSize,
      filter: null,
      sort: sort as never,
    }) as {
      queryKey: readonly unknown[]
      getNextPageParam: (
        lastPage: PageFixture,
        allPages: PageFixture[],
        lastPageParam: unknown
      ) => number | { orderKey: string; id: string } | undefined
    }
  }

  function makePage(count: number, totalCount: number | null, startAt = 0, withOrderKey = false) {
    return {
      rows: Array.from({ length: count }, (_, i) => ({
        id: `r${startAt + i}`,
        ...(withOrderKey ? { orderKey: `a${startAt + i}` } : {}),
      })),
      totalCount,
    }
  }

  function next(
    opts: ReturnType<typeof makeOpts>,
    pages: PageFixture[],
    lastPageParam: unknown = 0
  ) {
    return opts.getNextPageParam(pages[pages.length - 1], pages, lastPageParam)
  }

  it('getNextPageParam terminates when the count is covered by a partial page', () => {
    const opts = makeOpts()
    expect(next(opts, [makePage(500, 500)])).toBeUndefined()
  })

  it('getNextPageParam terminates on an empty page', () => {
    const opts = makeOpts()
    expect(next(opts, [makePage(1000, null), makePage(0, null, 1000)])).toBeUndefined()
  })

  it('getNextPageParam continues past a short page when the count says more rows exist', () => {
    // The regression the termination rule exists for: a page shorter than the
    // requested size (e.g. a byte-cut page) must not be read as end-of-table.
    const opts = makeOpts()
    expect(next(opts, [makePage(36, 100)])).toBe(36)
  })

  it('getNextPageParam terminates a full page when the count is covered', () => {
    const opts = makeOpts()
    expect(next(opts, [makePage(PAGE_SIZE, PAGE_SIZE)])).toBeUndefined()
  })

  it('getNextPageParam returns next offset for a full page with an unknown count', () => {
    const opts = makeOpts()
    expect(next(opts, [makePage(PAGE_SIZE, null)])).toBe(PAGE_SIZE)
  })

  it('getNextPageParam advances correctly across three pages', () => {
    const opts = makeOpts()
    const p0 = makePage(PAGE_SIZE, 2200)
    const p1 = makePage(PAGE_SIZE, null, 1000)
    const p2 = makePage(200, null, 2000)

    expect(next(opts, [p0])).toBe(1000)
    expect(next(opts, [p0, p1], 1000)).toBe(2000)
    expect(next(opts, [p0, p1, p2], 2000)).toBeUndefined()
  })

  it('getNextPageParam returns a keyset cursor when rows carry orderKey and there is no sort', () => {
    const opts = makeOpts()
    const pages = [makePage(PAGE_SIZE, 2000, 0, true)]
    expect(next(opts, pages)).toEqual({
      orderKey: `a${PAGE_SIZE - 1}`,
      id: `r${PAGE_SIZE - 1}`,
    })
  })

  it('getNextPageParam falls back to offset for sorted views even with orderKey present', () => {
    const opts = makeOpts(PAGE_SIZE, { column: 'name', direction: 'asc' })
    const p0 = makePage(PAGE_SIZE, 3000, 0, true)
    const p1 = makePage(PAGE_SIZE, null, 1000, true)
    expect(next(opts, [p0])).toBe(PAGE_SIZE)
    expect(next(opts, [p0, p1], PAGE_SIZE)).toBe(PAGE_SIZE * 2)
  })

  it('queryKey includes the result of tableRowsParamsKey', () => {
    const paramsKey = tableRowsParamsKey({ pageSize: PAGE_SIZE, filter: null, sort: null })
    const opts = makeOpts(PAGE_SIZE)
    // queryKey is a tuple; one element must be exactly the paramsKey string
    expect(opts.queryKey).toContain(paramsKey)
  })

  it('queryKey differs when filter changes', () => {
    const opts1 = tableRowsInfiniteOptions({
      workspaceId: WORKSPACE_ID,
      tableId: TABLE_ID,
      pageSize: PAGE_SIZE,
      filter: null,
      sort: null,
    }) as { queryKey: readonly unknown[] }
    const opts2 = tableRowsInfiniteOptions({
      workspaceId: WORKSPACE_ID,
      tableId: TABLE_ID,
      pageSize: PAGE_SIZE,
      filter: { column: 'name', operator: 'eq', value: 'Alice' } as never,
      sort: null,
    }) as { queryKey: readonly unknown[] }
    expect(JSON.stringify(opts1.queryKey)).not.toBe(JSON.stringify(opts2.queryKey))
  })
})
