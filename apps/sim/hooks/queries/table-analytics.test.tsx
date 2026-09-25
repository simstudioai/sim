/** @vitest-environment jsdom */
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  QueryTableAnalyticsBody,
  QueryTableAnalyticsResponse,
} from '@/lib/api/contracts/table-analytics'
import { useTableAnalytics } from '@/hooks/queries/table-analytics'

const mocks = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@/lib/api/client/request', () => ({ requestJson: mocks.request }))

const BODY: QueryTableAnalyticsBody = {
  workspaceId: 'workspace-1',
  query: {
    from: '2026-09-17T00:00:00Z',
    to: '2026-09-24T00:00:00Z',
    aggregate: { total: { op: 'count' } },
  },
}
const DATA: QueryTableAnalyticsResponse = {
  rows: [{ total: 38 }],
  columns: ['total'],
  columnLabels: { total: 'total' },
  bucket: null,
  truncated: false,
}
interface ProbeProps {
  tableId: string
  body: QueryTableAnalyticsBody
}

describe('dashboard range transitions', () => {
  let root: Root
  let client: QueryClient
  let result: ReturnType<typeof useTableAnalytics>

  function Probe(props: ProbeProps) {
    result = useTableAnalytics(props)
    return null
  }
  async function render(body = BODY, tableId = 'table-1') {
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <Probe tableId={tableId} body={body} />
        </QueryClientProvider>
      )
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
  }
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    mocks.request.mockResolvedValue(DATA)
    client = new QueryClient()
    root = createRoot(document.createElement('div'))
  })
  afterEach(() => {
    act(() => root.unmount())
    client.clear()
    vi.resetAllMocks()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('keeps results while the new range loads, then replaces them', async () => {
    await render()
    let finish!: (value: QueryTableAnalyticsResponse) => void
    mocks.request.mockReturnValue(
      new Promise<QueryTableAnalyticsResponse>((resolve) => {
        finish = resolve
      })
    )
    await render({ ...BODY, query: { ...BODY.query, from: '2026-09-20T00:00:00Z' } })
    expect(result.isPlaceholderData).toBe(true)
    expect(result.isFetching).toBe(true)
    expect(result.data).toEqual({
      ...DATA,
      queryRange: { from: BODY.query.from, to: BODY.query.to },
    })
    await act(async () => {
      finish({ ...DATA, rows: [{ total: 12 }] })
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(result.isPlaceholderData).toBe(false)
    expect(result.data?.rows).toEqual([{ total: 12 }])
    expect(result.data?.queryRange).toEqual({ from: '2026-09-20T00:00:00Z', to: BODY.query.to })
  })

  it.each(['table', 'workspace', 'selection'] as const)(
    'does not retain results across a different %s',
    async (scope) => {
      await render()
      mocks.request.mockReturnValue(new Promise(() => {}))
      await render(
        scope === 'workspace'
          ? { ...BODY, workspaceId: 'workspace-2' }
          : scope === 'selection'
            ? {
                ...BODY,
                query: {
                  ...BODY.query,
                  aggregate: { total: { op: 'countDistinct', field: 'alarm' } },
                },
              }
            : BODY,
        scope === 'table' ? 'table-2' : 'table-1'
      )
      expect(result.isPending).toBe(true)
      expect(result.data).toBeUndefined()
    }
  )

  it('shows an error instead of keeping stale values after a failed range query', async () => {
    await render()
    mocks.request.mockRejectedValue(new Error('Database unavailable'))
    await render({ ...BODY, query: { ...BODY.query, from: '2026-09-20T00:00:00Z' } })
    expect(result.isError).toBe(true)
    expect(result.error?.message).toBe('Database unavailable')
    expect(result.data).toBeUndefined()
  })
})
