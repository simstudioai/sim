import { apiClientRequestMock } from '@sim/testing/mocks/api-client-request.mock'
import { emcnMock } from '@sim/testing/mocks/emcn.mock'
import { reactQueryMock, reactQueryMockFns } from '@sim/testing/mocks/react-query.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-query', () => reactQueryMock)

vi.mock('@/lib/api/client/request', () => apiClientRequestMock)

vi.mock('@/lib/api/client/errors', () => ({
  isValidationError: vi.fn(() => false),
  isApiClientError: vi.fn(() => false),
  extractValidationIssues: vi.fn(() => []),
}))

vi.mock('@/app/workspace/providers/socket-provider', () => ({
  useSocket: vi.fn(() => ({ socket: null })),
}))

vi.mock('@sim/emcn', () => emcnMock)

import type { TableViewWire } from '@/lib/api/contracts/tables'
import {
  tableRowsInfiniteOptions,
  tableRowsParamsKey,
  useDeleteColumn,
  useUpdateTableView,
} from '@/hooks/queries/tables'
import { tableKeys } from '@/hooks/queries/utils/table-keys'

const cacheStore = new Map<string, unknown>()
const queryClient = reactQueryMockFns.mockQueryClient
queryClient.getQueryData.mockImplementation((key: readonly unknown[]) =>
  cacheStore.get(JSON.stringify(key))
)
queryClient.setQueryData.mockImplementation((key: readonly unknown[], updater: unknown) => {
  const k = JSON.stringify(key)
  const prev = cacheStore.get(k)
  const next = typeof updater === 'function' ? (updater as (p: unknown) => unknown)(prev) : updater
  cacheStore.set(k, next)
  return next
})
queryClient.getQueriesData.mockImplementation((opts: { queryKey: readonly unknown[] }) => {
  const prefix = JSON.stringify(opts.queryKey).slice(0, -1)
  return [...cacheStore.entries()]
    .filter(([k]) => k.startsWith(prefix))
    .map(([k, v]) => [JSON.parse(k), v])
})

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
})

describe('useUpdateTableView autosave ordering', () => {
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

  it('getNextPageParam continues past a short page when the count says more rows exist', () => {
    // The regression the termination rule exists for: a page shorter than the
    // requested size (e.g. a byte-cut page) must not be read as end-of-table.
    const opts = makeOpts()
    expect(next(opts, [makePage(36, 100)])).toBe(36)
  })

  it('getNextPageParam falls back to offset for sorted views even with orderKey present', () => {
    const opts = makeOpts(PAGE_SIZE, { column: 'name', direction: 'asc' })
    const p0 = makePage(PAGE_SIZE, 3000, 0, true)
    const p1 = makePage(PAGE_SIZE, null, 1000, true)
    expect(next(opts, [p0])).toBe(PAGE_SIZE)
    expect(next(opts, [p0, p1], PAGE_SIZE)).toBe(PAGE_SIZE * 2)
  })
})
