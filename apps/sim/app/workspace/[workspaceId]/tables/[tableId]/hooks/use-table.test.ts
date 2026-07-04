/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Capture useEffect calls so tests can trigger them manually.
const capturedEffects: Array<() => undefined | (() => void)> = []

// Mock React hooks to be passthrough so useTable() can be called without a
// React root. useCallback returns its function arg; useMemo executes
// immediately; useEffect is captured for manual triggering.
vi.mock('react', () => ({
  useCallback: (fn: unknown) => fn,
  useMemo: (fn: () => unknown) => fn(),
  useEffect: (fn: () => undefined | (() => void)) => {
    capturedEffects.push(fn)
  },
  useRef: (init: unknown) => ({ current: init }),
}))

const mockGetQueryData = vi.fn()
const mockFetchNextPage = vi.fn()
const mockQueryClient = {
  getQueryData: mockGetQueryData,
}

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: vi.fn(() => mockQueryClient),
}))

vi.mock('@/hooks/queries/tables', () => ({
  tableRowsInfiniteOptions: vi.fn(({ tableId, pageSize, filter, sort }) => ({
    queryKey: [
      'tables',
      'detail',
      tableId,
      'rows',
      'infinite',
      JSON.stringify({ pageSize, filter, sort }),
    ],
    queryFn: vi.fn(),
    initialPageParam: 0,
    staleTime: 30000,
  })),
  useInfiniteTableRows: vi.fn(() => ({
    data: { pages: [] },
    isLoading: false,
    refetch: vi.fn().mockResolvedValue(undefined),
    fetchNextPage: mockFetchNextPage,
    hasNextPage: false,
    isFetchingNextPage: false,
  })),
  useTable: vi.fn(() => ({
    data: undefined,
    isLoading: false,
  })),
}))

vi.mock('@/hooks/queries/workflows', () => ({
  useWorkflows: vi.fn(() => ({ data: undefined })),
  useWorkflowStates: vi.fn(() => new Map()),
}))

vi.mock('@/blocks', () => ({
  getBlock: vi.fn(() => undefined),
}))

vi.mock('@/lib/table/constants', () => ({
  TABLE_LIMITS: { MAX_QUERY_LIMIT: 1000 },
}))

import { useTable } from '@/app/workspace/[workspaceId]/tables/[tableId]/hooks/use-table'

const WORKSPACE_ID = 'ws-1'
const TABLE_ID = 'tbl-1'
const QUERY_OPTIONS = { filter: null, sort: null }

function makeRow(id: string, position: number) {
  return { id, data: { name: `Row ${id}` }, position, executions: {} }
}

function makePages(rowsPerPage: number[], totalCount: number | null) {
  return rowsPerPage.map((count, pageIdx) => ({
    rows: Array.from({ length: count }, (_, i) =>
      makeRow(`r${pageIdx * 1000 + i}`, pageIdx * 1000 + i)
    ),
    totalCount,
  }))
}

const OK = { status: 'success', hasNextPage: false } as const

function makeHook(queryOptions = QUERY_OPTIONS) {
  return useTable({ workspaceId: WORKSPACE_ID, tableId: TABLE_ID, queryOptions })
}

beforeEach(() => {
  capturedEffects.length = 0
  vi.clearAllMocks()
  mockGetQueryData.mockReturnValue(undefined)
  mockFetchNextPage.mockResolvedValue(OK)
})

describe('useTable – ensureAllRowsLoaded', () => {
  it('returns an empty array when cache is empty', async () => {
    mockGetQueryData.mockReturnValue(undefined)
    const { ensureAllRowsLoaded } = makeHook()
    const rows = await ensureAllRowsLoaded()
    expect(rows).toEqual([])
    expect(mockFetchNextPage).not.toHaveBeenCalled()
  })

  it('returns cached rows without fetching when the count is covered by a partial page', async () => {
    mockGetQueryData.mockReturnValue({ pages: makePages([3], 3) })
    const { ensureAllRowsLoaded } = makeHook()
    const rows = await ensureAllRowsLoaded()
    expect(rows).toHaveLength(3)
    expect(rows.map((r) => r.id)).toEqual(['r0', 'r1', 'r2'])
    expect(mockFetchNextPage).not.toHaveBeenCalled()
  })

  it('returns cached rows without fetching when the count is covered by exactly one full page', async () => {
    // The totalCount fast-path terminates a covered drain without the
    // empty-page confirmation request the old page-fullness heuristic needed.
    mockGetQueryData.mockReturnValue({ pages: makePages([1000], 1000) })
    const { ensureAllRowsLoaded } = makeHook()
    const rows = await ensureAllRowsLoaded()
    expect(rows).toHaveLength(1000)
    expect(mockFetchNextPage).not.toHaveBeenCalled()
  })

  it('keeps paging past a short page when the count says more rows exist', async () => {
    // The regression this termination rule exists for: a page shorter than the
    // requested size must not be read as end-of-table.
    const [shortPage] = makePages([36], 100)
    const rest = {
      rows: Array.from({ length: 64 }, (_, i) => makeRow(`r${1000 + i}`, 1000 + i)),
      totalCount: null,
    }
    mockGetQueryData
      .mockReturnValueOnce({ pages: [shortPage] }) // iter 1 check: 36 < 100 → fetch
      .mockReturnValueOnce({ pages: [shortPage, rest] }) // iter 1 progress: 2 > 1
      .mockReturnValue({ pages: [shortPage, rest] }) // iter 2 check: covered → break; final read
    const { ensureAllRowsLoaded } = makeHook()
    const rows = await ensureAllRowsLoaded()
    expect(rows).toHaveLength(100)
    expect(mockFetchNextPage).toHaveBeenCalledTimes(1)
  })

  it('drains until an empty page when the count is unknown', async () => {
    const [page0] = makePages([1000], null)
    const emptyPage = { rows: [], totalCount: null }
    mockGetQueryData
      .mockReturnValueOnce({ pages: [page0] }) // iter 1 check: unknown count → fetch
      .mockReturnValueOnce({ pages: [page0, emptyPage] }) // iter 1 progress: 2 > 1
      .mockReturnValue({ pages: [page0, emptyPage] }) // iter 2 check: empty page → break; final read
    const { ensureAllRowsLoaded } = makeHook()
    const rows = await ensureAllRowsLoaded()
    expect(rows).toHaveLength(1000)
    expect(mockFetchNextPage).toHaveBeenCalledTimes(1)
  })

  it('fetches multiple pages for a large table until the count is covered', async () => {
    const [page0, page1, page2] = makePages([1000, 1000, 500], 2500)
    mockGetQueryData
      .mockReturnValueOnce({ pages: [page0] }) // iter 1 check: 1000 < 2500 → fetch
      .mockReturnValueOnce({ pages: [page0, page1] }) // iter 1 progress: 2 > 1
      .mockReturnValueOnce({ pages: [page0, page1] }) // iter 2 check: 2000 < 2500 → fetch
      .mockReturnValueOnce({ pages: [page0, page1, page2] }) // iter 2 progress: 3 > 2
      .mockReturnValue({ pages: [page0, page1, page2] }) // iter 3 check: covered → break; final read
    const { ensureAllRowsLoaded } = makeHook()
    const rows = await ensureAllRowsLoaded()
    expect(rows).toHaveLength(2500)
    expect(rows[0].id).toBe('r0')
    expect(rows[1000].id).toBe('r1000')
    expect(rows[2499].id).toBe('r2499')
    expect(mockFetchNextPage).toHaveBeenCalledTimes(2)
  })

  it('throws when fetchNextPage returns an error status', async () => {
    mockGetQueryData.mockReturnValue({ pages: makePages([1000], 2000) })
    const error = new Error('Network failure')
    mockFetchNextPage.mockResolvedValueOnce({ status: 'error', error })
    const { ensureAllRowsLoaded } = makeHook()
    await expect(ensureAllRowsLoaded()).rejects.toThrow('Network failure')
  })

  it('throws when a fetch makes no progress instead of spinning', async () => {
    // A cancelQueries race can resolve fetchNextPage without appending a page.
    mockGetQueryData.mockReturnValue({ pages: makePages([1000], 2000) })
    const { ensureAllRowsLoaded } = makeHook()
    await expect(ensureAllRowsLoaded()).rejects.toThrow('no progress')
    expect(mockFetchNextPage).toHaveBeenCalledTimes(1)
  })

  it('does not call fetchNextPage or getQueryData when workspaceId is empty', async () => {
    const { ensureAllRowsLoaded } = useTable({
      workspaceId: '',
      tableId: TABLE_ID,
      queryOptions: QUERY_OPTIONS,
    })
    const rows = await ensureAllRowsLoaded()
    expect(rows).toEqual([])
    expect(mockFetchNextPage).not.toHaveBeenCalled()
    expect(mockGetQueryData).not.toHaveBeenCalled()
  })

  it('does not call fetchNextPage or getQueryData when tableId is empty', async () => {
    const { ensureAllRowsLoaded } = useTable({
      workspaceId: WORKSPACE_ID,
      tableId: '',
      queryOptions: QUERY_OPTIONS,
    })
    const rows = await ensureAllRowsLoaded()
    expect(rows).toEqual([])
    expect(mockFetchNextPage).not.toHaveBeenCalled()
    expect(mockGetQueryData).not.toHaveBeenCalled()
  })

  it('encodes queryOptions.filter into the queryKey passed to getQueryData', async () => {
    const filter = { column: 'name', operator: 'eq', value: 'Alice' } as never
    mockGetQueryData.mockReturnValue({ pages: makePages([3], 3) })
    const { ensureAllRowsLoaded } = makeHook({ filter, sort: null })
    await ensureAllRowsLoaded()
    const queryKey = mockGetQueryData.mock.calls[0][0] as unknown[]
    expect(JSON.stringify(queryKey)).toContain('Alice')
  })
})

describe('useTable – ensureRowsLoadedUpTo', () => {
  it('returns the first maxRows with hasMore when the cache already exceeds the cap', async () => {
    mockGetQueryData.mockReturnValue({ pages: makePages([1000, 1000], 2000) })
    const { ensureRowsLoadedUpTo } = makeHook()
    const result = await ensureRowsLoadedUpTo(1500)
    expect(result.rows).toHaveLength(1500)
    expect(result.hasMore).toBe(true)
    expect(mockFetchNextPage).not.toHaveBeenCalled()
  })

  it('returns everything with hasMore false when the table fits under the cap', async () => {
    mockGetQueryData.mockReturnValue({ pages: makePages([3], 3) })
    const { ensureRowsLoadedUpTo } = makeHook()
    const result = await ensureRowsLoadedUpTo(50)
    expect(result.rows).toHaveLength(3)
    expect(result.hasMore).toBe(false)
    expect(mockFetchNextPage).not.toHaveBeenCalled()
  })

  it('loads one row past the cap to make hasMore exact at the boundary', async () => {
    const [page0, page1] = makePages([1000, 1000], 2000)
    mockGetQueryData
      .mockReturnValueOnce({ pages: [page0] }) // check: at cap but more exist → fetch
      .mockReturnValueOnce({ pages: [page0, page1] }) // progress: 2 > 1
      .mockReturnValue({ pages: [page0, page1] }) // check: past cap → break; final read
    const { ensureRowsLoadedUpTo } = makeHook()
    const result = await ensureRowsLoadedUpTo(1000)
    expect(result.rows).toHaveLength(1000)
    expect(result.hasMore).toBe(true)
    expect(mockFetchNextPage).toHaveBeenCalledTimes(1)
  })

  it('skips the boundary probe when the count is already covered', async () => {
    mockGetQueryData.mockReturnValue({ pages: makePages([1000], 1000) })
    const { ensureRowsLoadedUpTo } = makeHook()
    const result = await ensureRowsLoadedUpTo(1000)
    expect(result.rows).toHaveLength(1000)
    expect(result.hasMore).toBe(false)
    expect(mockFetchNextPage).not.toHaveBeenCalled()
  })

  it('returns empty with hasMore false when ids are missing', async () => {
    const { ensureRowsLoadedUpTo } = useTable({
      workspaceId: '',
      tableId: TABLE_ID,
      queryOptions: QUERY_OPTIONS,
    })
    const result = await ensureRowsLoadedUpTo(10)
    expect(result).toEqual({ rows: [], hasMore: false })
    expect(mockFetchNextPage).not.toHaveBeenCalled()
  })
})
