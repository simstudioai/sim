/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DashboardInteractionContext } from '@/components/dashboards/dashboard-interactions'
import { DashboardPanel } from '@/components/dashboards/dashboard-panel'
import type { QueryTableAnalyticsResponse } from '@/lib/api/contracts/table-analytics'
import { createDashboardCursorStore } from '@/stores/dashboards/cursor'

const mocks = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock('@/hooks/queries/table-analytics', () => ({ useTableAnalytics: mocks.query }))
vi.mock('@/components/charts/echarts-view', () => ({
  EChartsView: ({ label }: { label: string }) => <div role='img' aria-label={label} />,
}))

describe('dashboard empty-range transitions', () => {
  let root: Root
  let container: HTMLDivElement
  const interactions = {
    cursorStore: createDashboardCursorStore(),
    timeZone: 'UTC',
    onZoom: vi.fn(),
  }
  async function render(rows: QueryTableAnalyticsResponse['rows']) {
    mocks.query.mockReturnValue({
      data: {
        rows,
        columns: ['total'],
        columnLabels: { total: 'total' },
        bucket: null,
        truncated: false,
      },
      isPending: false,
      isError: false,
      isFetching: false,
    })
    await act(async () =>
      root.render(
        <DashboardInteractionContext value={interactions}>
          <DashboardPanel
            block={{
              chart: 'Reports',
              source: { tableId: 'table-1', aggregate: { total: { op: 'count' } } },
              option: { series: [{ type: 'bar' }] },
            }}
            workspaceId='workspace-1'
            range={{ from: '2026-09-17T00:00:00Z', to: '2026-09-24T00:00:00Z' }}
            now={Date.parse('2026-09-24T00:00:00Z')}
          />
        </DashboardInteractionContext>
      )
    )
  }
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    container = document.createElement('div')
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    vi.resetAllMocks()
    vi.unstubAllGlobals()
  })

  it('keeps the chart mounted through populated, empty, and populated ranges', async () => {
    await render([{ total: 38 }])
    const chart = container.querySelector('[role="img"]')
    expect(chart).not.toBeNull()
    await render([])
    expect(container.querySelector('[role="img"]')).toBe(chart)
    expect(container.textContent).toContain('No data in this time range')
    await render([{ total: 12 }])
    expect(container.querySelector('[role="img"]')).toBe(chart)
    expect(container.textContent).not.toContain('No data in this time range')
  })
})
