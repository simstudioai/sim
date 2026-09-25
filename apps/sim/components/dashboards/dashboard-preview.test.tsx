/** @vitest-environment jsdom */
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDashboardInteractions } from '@/components/dashboards/dashboard-interactions'
import { DashboardPreview } from '@/components/dashboards/dashboard-preview'
import { tableAnalyticsKeys } from '@/hooks/queries/table-analytics'

const mocks = vi.hoisted(() => ({
  controls: vi.fn(),
  layout: vi.fn(),
  url: vi.fn(),
  timezone: vi.fn(),
}))
vi.mock('@/lib/core/utils/timezone', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/core/utils/timezone')>()),
  getBrowserTimezone: mocks.timezone,
}))
vi.mock('@/components/dashboards/dashboard-controls', () => ({
  DashboardControls: (props: unknown) => {
    mocks.controls(props)
    return null
  },
}))
vi.mock('@/components/dashboards/dashboard-layout', () => ({
  DashboardLayout: (props: unknown) => {
    mocks.layout(props, useDashboardInteractions())
    return null
  },
}))
const content =
  'title: Example\ntime: 7d\nsource: {tableId: table-1}\nblocks: [{stat: Total, source: {aggregate: {total: {op: count}}}}]'
const zoom = { from: '2026-09-20T17:26:54.766Z', to: '2026-09-21T03:49:57.697Z' }

describe('dashboard view state', () => {
  let root: Root
  let client: QueryClient
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.timezone.mockReturnValue('America/Los_Angeles')
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    client = new QueryClient()
    root = createRoot(document.createElement('div'))
  })
  afterEach(() => {
    act(() => root.unmount())
    client.clear()
    vi.unstubAllGlobals()
  })
  async function render(searchParams = '') {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <NuqsTestingAdapter hasMemory searchParams={searchParams} onUrlUpdate={mocks.url}>
            <DashboardPreview content={content} workspaceId='workspace-1' fileId='example' />
          </NuqsTestingAdapter>
        </QueryClientProvider>
      )
    )
  }
  const controls = () => mocks.controls.mock.lastCall![0]
  const layout = () => mocks.layout.mock.lastCall![0]
  const interactions = () => mocks.layout.mock.lastCall![1]

  it.each(['America/Los_Angeles', 'Asia/Tokyo'])(
    'defaults to the viewer timezone %s and allows UTC without changing the interval',
    async (timezone) => {
      mocks.timezone.mockReturnValue(timezone)
      await render()
      expect(controls().zone).toBe('local')
      expect(interactions().timeZone).toBe(timezone)
      const original = layout().range
      await act(async () => controls().onZoneChange('utc'))
      expect(interactions().timeZone).toBe('UTC')
      expect(layout().range).toEqual(original)
      await vi.waitFor(() => {
        expect(mocks.url.mock.lastCall![0].searchParams.get('dash-example-zone')).toBe('utc')
      })
      await act(async () => controls().onZoneChange('local'))
      expect(interactions().timeZone).toBe(timezone)
      await vi.waitFor(() => {
        expect(mocks.url.mock.lastCall![0].searchParams.has('dash-example-zone')).toBe(false)
      })
    }
  )

  it('sets exact shared bounds without navigation and leaves zoom by choosing a preset', async () => {
    await render()
    await act(async () => interactions().onZoom(zoom))
    expect(layout().range).toEqual(zoom)
    expect(controls().period).toBe('custom')
    await vi.waitFor(() => expect(mocks.url.mock.lastCall?.[0].options.shallow).toBe(true))
    await act(async () => controls().onPeriodChange('7d'))
    expect(controls().period).toBe('7d')
    expect(Date.parse(layout().range.to) - Date.parse(layout().range.from)).toBe(7 * 86400000)
  })
  it('commits the calendar dates and custom mode together, preserving the view on invalid input', async () => {
    await render('?dash-example-range=30d&dash-example-zone=utc')
    expect(controls().zone).toBe('utc')
    await act(async () => {
      expect(controls().onCalendarChange('2026-09-17T00:00', '2026-09-23T23:59:59')).toBe(true)
    })
    expect(controls().period).toBe('custom')
    expect(layout().range).toEqual({
      from: '2026-09-17T00:00:00.000Z',
      to: '2026-09-24T00:00:00.000Z',
    })
    const selected = layout().range
    await act(async () => {
      expect(controls().onCalendarChange('invalid', 'invalid')).toBe(false)
    })
    expect(layout().range).toEqual(selected)
  })
  it('keeps exact bounds through repeated zooms and timezone changes', async () => {
    await render(
      '?dash-example-range=custom&dash-example-from=2026-09-17T00:00:00&dash-example-to=2026-09-24T00:00:00'
    )
    await act(async () => interactions().onZoom(zoom))
    const selected = { ...zoom, to: '2026-09-20T18:00:00.000Z' }
    await act(async () => interactions().onZoom(selected))
    expect(layout().range).toEqual(selected)
    await act(async () => controls().onZoneChange('utc'))
    expect(layout().range).toEqual(selected)
    expect(controls().zone).toBe('utc')
  })
  it('refreshes custom-range queries only for this workspace and this dashboard tables', async () => {
    const key = (workspaceId: string, tableId: string) =>
      tableAnalyticsKeys.query(tableId, {
        workspaceId,
        query: { ...zoom, aggregate: { total: { op: 'count' } } },
      })
    const matching = key('workspace-1', 'table-1')
    const otherTable = key('workspace-1', 'other-table')
    const otherWorkspace = key('workspace-2', 'table-1')
    for (const queryKey of [matching, otherTable, otherWorkspace]) client.setQueryData(queryKey, {})
    await render(
      '?dash-example-range=custom&dash-example-from=2026-09-17T00:00:00&dash-example-to=2026-09-24T00:00:00'
    )
    const original = layout().range
    await act(async () => controls().onRefresh())
    expect(layout().range).toEqual(original)
    expect(client.getQueryState(matching)?.isInvalidated).toBe(true)
    expect(client.getQueryState(otherTable)?.isInvalidated).toBe(false)
    expect(client.getQueryState(otherWorkspace)?.isInvalidated).toBe(false)
  })
})
