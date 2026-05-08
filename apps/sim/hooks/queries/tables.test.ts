/**
 * @vitest-environment node
 */
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
    },
  }
})

vi.mock('@tanstack/react-query', () => ({
  keepPreviousData: {},
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
}))

vi.mock('@/lib/api/contracts/tables', () => ({
  addTableColumnContract: {},
  addWorkflowGroupContract: {},
  batchCreateTableRowsContract: {},
  batchUpdateTableRowsContract: {},
  cancelTableRunsContract: {},
  createTableContract: {},
  createTableRowContract: {},
  deleteTableColumnContract: {},
  deleteTableContract: {},
  deleteTableRowContract: {},
  deleteTableRowsContract: {},
  deleteWorkflowGroupContract: {},
  getTableContract: {},
  importCsvContract: {},
  listTableRowsContract: {},
  listTablesContract: {},
  renameTableContract: {},
  restoreTableContract: {},
  runWorkflowGroupContract: {},
  updateTableColumnContract: {},
  updateTableMetadataContract: {},
  updateTableRowContract: {},
  updateWorkflowGroupContract: {},
  uploadCsvContract: {},
}))

vi.mock('@/app/workspace/providers/socket-provider', () => ({
  useSocket: vi.fn(() => ({ socket: null })),
}))

vi.mock('@/components/emcn', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

import { tableKeys, useDeleteColumn, useUpdateColumn } from '@/hooks/queries/tables'

const TABLE_ID = 'tbl-1'
const WORKSPACE_ID = 'ws-1'

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
    setCache(tableKeys.rowsRoot(TABLE_ID), {
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

    const rows = getCache<{ rows: Array<{ data: Record<string, unknown> }> }>(
      tableKeys.rowsRoot(TABLE_ID)
    )
    expect(rows?.rows.every((r) => !('age' in r.data))).toBe(true)
    expect(rows?.rows[0]?.data).toEqual({ name: 'a' })

    expect(ctx?.previousDetail).toBeDefined()
    expect(ctx?.rowSnapshots?.length).toBeGreaterThan(0)
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
    setCache(tableKeys.rowsRoot(TABLE_ID), originalRows)

    const hook = useDeleteColumn({ workspaceId: WORKSPACE_ID, tableId: TABLE_ID })
    const ctx = await hook.onMutate?.('age')

    expect(getCache(tableKeys.detail(TABLE_ID))).not.toEqual(originalDetail)

    hook.onError?.(new Error('boom'), 'age', ctx)

    expect(getCache(tableKeys.detail(TABLE_ID))).toEqual(originalDetail)
    expect(getCache(tableKeys.rowsRoot(TABLE_ID))).toEqual(originalRows)
  })

  it('invalidates schema, rows, and lists in onSettled', () => {
    const hook = useDeleteColumn({ workspaceId: WORKSPACE_ID, tableId: TABLE_ID })
    hook.onSettled?.(undefined, null, 'age', undefined)

    const calls = queryClient.invalidateQueries.mock.calls.map((c) => c[0]?.queryKey)
    expect(calls).toEqual(
      expect.arrayContaining([
        tableKeys.detail(TABLE_ID),
        tableKeys.rowsRoot(TABLE_ID),
        tableKeys.lists(),
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

  it('renames the corresponding row-data key when updates.name is set', async () => {
    setCache(tableKeys.detail(TABLE_ID), {
      id: TABLE_ID,
      schema: { columns: [{ name: 'age', type: 'number' }] },
    })
    setCache(tableKeys.rowsRoot(TABLE_ID), {
      rows: [
        { id: 'r1', data: { age: 30 } },
        { id: 'r2', data: { age: 40 } },
      ],
      totalCount: 2,
    })

    const hook = useUpdateColumn({ workspaceId: WORKSPACE_ID, tableId: TABLE_ID })
    await hook.onMutate?.({ columnName: 'age', updates: { name: 'years' } })

    const rows = getCache<{ rows: Array<{ data: Record<string, unknown> }> }>(
      tableKeys.rowsRoot(TABLE_ID)
    )
    expect(rows?.rows[0]?.data).toEqual({ years: 30 })
    expect(rows?.rows[1]?.data).toEqual({ years: 40 })
  })
})

describe('useDeleteColumn case-insensitive row cleanup', () => {
  it('strips the row data key even when stored casing differs from the requested name', async () => {
    setCache(tableKeys.detail(TABLE_ID), {
      id: TABLE_ID,
      schema: { columns: [{ name: 'Age', type: 'number' }] },
    })
    setCache(tableKeys.rowsRoot(TABLE_ID), {
      rows: [{ id: 'r1', data: { Age: 30, name: 'a' } }],
      totalCount: 1,
    })

    const hook = useDeleteColumn({ workspaceId: WORKSPACE_ID, tableId: TABLE_ID })
    await hook.onMutate?.('age')

    const rows = getCache<{ rows: Array<{ data: Record<string, unknown> }> }>(
      tableKeys.rowsRoot(TABLE_ID)
    )
    expect(rows?.rows[0]?.data).toEqual({ name: 'a' })
  })
})
