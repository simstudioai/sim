/** @vitest-environment jsdom */
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DashboardPreview } from '@/components/dashboards/dashboard-preview'
import { tableAnalyticsKeys } from '@/hooks/queries/table-analytics'

const { layout } = vi.hoisted(() => ({ layout: vi.fn((_props: { now: number }) => null) }))

/** Panels would issue analytics requests; this suite exercises the controls and query cache. */
vi.mock('@/components/dashboards/dashboard-layout', () => ({ DashboardLayout: layout }))

const content =
  'title: Example\ntime: 7d\nsource: {tableId: table-1}\nblocks: [{stat: Total, source: {aggregate: {total: {op: count}}}}]'
const range = { from: '2026-09-17T00:00:00.000Z', to: '2026-09-24T00:00:00.000Z' }

describe('dashboard refresh', () => {
  let root: Root
  let container: HTMLDivElement
  let client: QueryClient
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    layout.mockClear()
    client = new QueryClient()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    client.clear()
  })

  it('refreshes by re-keying its panels to a new now, leaving other caches alone', async () => {
    const key = (workspaceId: string, tableId: string) =>
      tableAnalyticsKeys.query(
        tableId,
        { workspaceId, query: { ...range, aggregate: { total: { op: 'count' } } } },
        0
      )
    const matching = key('workspace-1', 'table-1')
    const otherTable = key('workspace-1', 'other-table')
    const otherWorkspace = key('workspace-2', 'table-1')
    for (const queryKey of [matching, otherTable, otherWorkspace]) client.setQueryData(queryKey, {})
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <NuqsTestingAdapter
            hasMemory
            searchParams='?dash-example-range=custom&dash-example-from=2026-09-17T00:00:00&dash-example-to=2026-09-24T00:00:00&dash-example-zone=utc'
          >
            <DashboardPreview content={content} workspaceId='workspace-1' dashboardId='example' />
          </NuqsTestingAdapter>
        </QueryClientProvider>
      )
    )
    const refresh = await vi.waitFor(() => {
      const button = container.querySelector<HTMLButtonElement>(
        'button[aria-label="Refresh dashboard"]'
      )
      if (!button) throw new Error('Refresh button not rendered')
      return button
    })
    const before = layout.mock.lastCall?.[0].now
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 60_000)
    await act(async () => refresh.click())
    vi.useRealTimers()
    expect(layout.mock.lastCall?.[0].now).toBeGreaterThan(before ?? Number.POSITIVE_INFINITY)
    for (const queryKey of [matching, otherTable, otherWorkspace])
      expect(client.getQueryState(queryKey)?.isInvalidated).toBe(false)
  })
})
