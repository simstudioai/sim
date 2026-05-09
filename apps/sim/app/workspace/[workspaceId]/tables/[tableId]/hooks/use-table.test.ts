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

function makePages(rowsPerPage: number[], totalCount: number) {
  return rowsPerPage.map((count, pageIdx) => ({
    rows: Array.from({ length: count }, (_, i) =>
      makeRow(`r${pageIdx * 1000 + i}`, pageIdx * 1000 + i)
    ),
    totalCount,
  }))
}

const OK = { status: 'success', hasNextPage: false } as const

beforeEach(() => {
  capturedEffects.length = 0
  vi.clearAllMocks()
  mockGetQueryData.mockReturnValue(undefined)
  mockFetchNextPage.mockResolvedValue(OK)
})

describe('useTable – ensureAllRowsLoaded', () => {
  it('returns an empty array when cache is empty', async () => {
    mockGetQueryData.mockReturnValue(undefined)
    const { ensureAllRowsLoaded } = useTable({
      workspaceId: WORKSPACE_ID,
      tableId: TABLE_ID,
      queryOptions: QUERY_OPTIONS,
    })
    const rows = await ensureAllRowsLoaded()
    expect(rows).toEqual([])
    expect(mockFetchNextPage).not.toHaveBeenCalled()
  })

  it('returns rows from cache immediately when last page is partial (< 1 page)', async () => {
    const [page] = makePages([3], 3)
    mockGetQueryData.mockReturnValue({ pages: [page] })
    const { ensureAllRowsLoaded } = useTable({
      workspaceId: WORKSPACE_ID,
      tableId: TABLE_ID,
      queryOptions: QUERY_OPTIONS,
    })
    const rows = await ensureAllRowsLoaded()
    expect(rows).toHaveLength(3)
    expect(rows.map((r) => r.id)).toEqual(['r0', 'r1', 'r2'])
    // Cache already complete — no HTTP request needed.
    expect(mockFetchNextPage).not.toHaveBeenCalled()
  })

  it('returns rows from cache immediately when last page is exactly one full page', async () => {
    // A full page means getNextPageParam returns the next offset, so we must
    // fetch once to confirm there is no page 2 (which returns 0 rows). After
    // that empty page the last page is partial (0 < 1000) and the loop breaks.
    const [page0] = makePages([1000], 1000)
    const emptyPage = { rows: [], totalCount: 1000 }
    mockGetQueryData
      .mockReturnValueOnce({ pages: [page0] }) // loop iter 1: full → fetch
      .mockReturnValueOnce({ pages: [page0, emptyPage] }) // loop iter 2: empty → break
      .mockReturnValue({ pages: [page0, emptyPage] }) // final read
    const { ensureAllRowsLoaded } = useTable({
      workspaceId: WORKSPACE_ID,
      tableId: TABLE_ID,
      queryOptions: QUERY_OPTIONS,
    })
    const rows = await ensureAllRowsLoaded()
    expect(rows).toHaveLength(1000)
    expect(rows[0].id).toBe('r0')
    expect(rows[999].id).toBe('r999')
    expect(mockFetchNextPage).toHaveBeenCalledTimes(1)
  })

  it('fetches one page when last cached page is full and there is more data', async () => {
    const [page0, page1] = makePages([1000, 500], 1500)
    mockGetQueryData
      .mockReturnValueOnce({ pages: [page0] }) // loop iter 1: full → fetch
      .mockReturnValueOnce({ pages: [page0, page1] }) // loop iter 2: partial → break
      .mockReturnValue({ pages: [page0, page1] }) // final read
    const { ensureAllRowsLoaded } = useTable({
      workspaceId: WORKSPACE_ID,
      tableId: TABLE_ID,
      queryOptions: QUERY_OPTIONS,
    })
    const rows = await ensureAllRowsLoaded()
    expect(rows).toHaveLength(1500)
    expect(rows[0].id).toBe('r0')
    expect(rows[1000].id).toBe('r1000')
    expect(mockFetchNextPage).toHaveBeenCalledTimes(1)
  })

  it('fetches multiple pages for a large table until a partial page terminates the drain', async () => {
    const [page0, page1, page2] = makePages([1000, 1000, 500], 2500)
    mockGetQueryData
      .mockReturnValueOnce({ pages: [page0] }) // iter 1: full → fetch
      .mockReturnValueOnce({ pages: [page0, page1] }) // iter 2: full → fetch
      .mockReturnValueOnce({ pages: [page0, page1, page2] }) // iter 3: partial → break
      .mockReturnValue({ pages: [page0, page1, page2] }) // final read
    const { ensureAllRowsLoaded } = useTable({
      workspaceId: WORKSPACE_ID,
      tableId: TABLE_ID,
      queryOptions: QUERY_OPTIONS,
    })
    const rows = await ensureAllRowsLoaded()
    expect(rows).toHaveLength(2500)
    expect(rows[0].id).toBe('r0')
    expect(rows[1000].id).toBe('r1000')
    expect(rows[2499].id).toBe('r2499')
    expect(mockFetchNextPage).toHaveBeenCalledTimes(2)
  })

  it('throws when fetchNextPage returns an error status', async () => {
    const [page0] = makePages([1000], 2000)
    mockGetQueryData.mockReturnValue({ pages: [page0] })
    const error = new Error('Network failure')
    mockFetchNextPage.mockResolvedValueOnce({ status: 'error', error })
    const { ensureAllRowsLoaded } = useTable({
      workspaceId: WORKSPACE_ID,
      tableId: TABLE_ID,
      queryOptions: QUERY_OPTIONS,
    })
    await expect(ensureAllRowsLoaded()).rejects.toThrow('Network failure')
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
    const [page] = makePages([3], 3)
    mockGetQueryData.mockReturnValue({ pages: [page] })
    const { ensureAllRowsLoaded } = useTable({
      workspaceId: WORKSPACE_ID,
      tableId: TABLE_ID,
      queryOptions: { filter, sort: null },
    })
    await ensureAllRowsLoaded()
    const queryKey = mockGetQueryData.mock.calls[0][0] as unknown[]
    expect(JSON.stringify(queryKey)).toContain('Alice')
  })
})
