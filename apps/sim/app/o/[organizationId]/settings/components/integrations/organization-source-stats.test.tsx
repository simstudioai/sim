/** @vitest-environment jsdom */
import { act } from 'react'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrganizationSearchStats } from '@/lib/api/contracts/knowledge/search-stats'

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  chart: vi.fn(),
  refetch: vi.fn(),
  updateUrl: vi.fn(),
}))
vi.mock('@/hooks/queries/organization-search-stats', () => ({
  useOrganizationSearchStats: mocks.query,
}))
vi.mock('@/components/charts', () => ({
  BarChart: (props: unknown) => {
    mocks.chart(props)
    return <div>Daily chart</div>
  },
}))
vi.mock('@/connectors/registry', () => ({
  CONNECTOR_META_REGISTRY: { confluence: { name: 'Confluence' }, jira: { name: 'Jira' } },
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({}) }))

import { SettingsHeaderProvider } from '@/components/settings/settings-header'
import { OrganizationSourceStats } from '@/app/o/[organizationId]/settings/components/integrations/organization-source-stats'

const data: OrganizationSearchStats = {
  start: '2026-09-04T00:00:00.000Z',
  end: '2026-09-10T20:00:00.000Z',
  totals: { invocations: 5, activePeople: 2, results: 8 },
  series: [{ timestamp: '2026-09-10T00:00:00.000Z', invocations: 5 }],
  sources: [{ sourceType: 'confluence', invocations: 4 }],
  surfaces: [
    { surface: 'dashboard', invocations: 3 },
    { surface: 'mcp', invocations: 2 },
  ],
  people: [
    {
      userId: 'person',
      name: 'Alex',
      email: 'alex@example.com',
      invocations: 5,
      sourceTypes: ['confluence', 'jira'],
    },
  ],
}
let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mocks.query.mockReturnValue({ data, isError: false, refetch: mocks.refetch })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})
async function render(searchParams = '') {
  await act(async () =>
    root.render(
      <NuqsTestingAdapter hasMemory searchParams={searchParams} onUrlUpdate={mocks.updateUrl}>
        <SettingsHeaderProvider>
          <OrganizationSourceStats organizationId='org' tabs={<span>Sources People Stats</span>} />
        </SettingsHeaderProvider>
      </NuqsTestingAdapter>
    )
  )
}

describe('organization Search stats', () => {
  it('renders request metrics, source labels, people and the canonical daily chart', async () => {
    await render()
    expect(container.textContent).not.toContain('No-result rate')
    expect(container.textContent).toContain('Confluence, Jira')
    expect(container.textContent).toContain('alex@example.com')
    expect(mocks.chart).toHaveBeenCalledWith(
      expect.objectContaining({ data: [{ timestamp: data.series[0].timestamp, value: 5 }] })
    )
    expect(container.textContent).not.toMatch(/citations|clicks|agent runs/i)
  })
  it('restores filters from the URL and scopes every metric request consistently', async () => {
    await render('?stats-period=7d&stats-surface=mcp')
    expect(mocks.query).toHaveBeenLastCalledWith({
      organizationId: 'org',
      period: '7d',
      surface: 'mcp',
    })
    expect(container.textContent).not.toContain('Invocations by surface')
    const filter = container.querySelector('button[aria-label="Search surface"]')
    const toolbar = filter?.parentElement?.parentElement
    expect(toolbar?.textContent).toContain('Sources People Stats')
  })
  it('restores a custom UTC range with the surface filter', async () => {
    await render(
      '?stats-period=custom&stats-start=2026-09-01&stats-end=2026-09-03&stats-surface=slack'
    )
    expect(mocks.query).toHaveBeenLastCalledWith({
      organizationId: 'org',
      period: 'custom',
      startDate: '2026-09-01',
      endDate: '2026-09-03',
      surface: 'slack',
    })
    expect(container.textContent).toContain('Sep 1 – Sep 3')
  })
  it('keeps the daily chart mounted with zero-valued buckets when there is no activity', async () => {
    mocks.query.mockReturnValue({
      data: {
        ...data,
        totals: { invocations: 0, activePeople: 0, results: 0 },
        series: data.series.map((point) => ({ ...point, invocations: 0 })),
        sources: [],
        surfaces: [],
        people: [],
      },
      isError: false,
    })
    await render()
    expect(container.textContent).not.toContain('No recorded Search activity')
    expect(container.querySelectorAll('dd')).toHaveLength(3)
    expect(Array.from(container.querySelectorAll('dd'), (metric) => metric.textContent)).toEqual([
      '0',
      '0',
      '0',
    ])
    expect(mocks.chart).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [{ timestamp: data.series[0].timestamp, value: 0 }],
      })
    )
  })
  it('offers retry instead of displaying stale successful totals on failure', async () => {
    mocks.query.mockReturnValue({ data, isError: true, refetch: mocks.refetch })
    await render()
    expect(container.textContent).toContain('Couldn’t load Search stats')
    expect(container.textContent).not.toContain('Search invocations')
    const retry = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Try again'
    )
    await act(async () => retry?.click())
    expect(mocks.refetch).toHaveBeenCalledOnce()
  })
})
