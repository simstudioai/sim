/** @vitest-environment node */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { OrganizationUsageOverview } from '@/lib/api/contracts/organization-usage'
import { UsageCredits } from '@/ee/organization-usage/components/usage-credits'

const overview: OrganizationUsageOverview = {
  window: { start: '2026-01-01', end: '2026-01-08', source: 'range' },
  bucket: 'day',
  totals: { credits: 200 },
  previousTotals: { credits: 100 },
  limitCredits: 150,
  series: [],
  members: {
    dimension: 'member',
    rows: [],
    other: { credits: 0, events: 0, rowCount: 0, tokens: 0 },
    totalCredits: 200,
  },
}

describe('UsageCredits', () => {
  it('hides stale usage badges when a refresh fails', () => {
    const render = (isError: boolean) =>
      renderToStaticMarkup(<UsageCredits overview={overview} isLoading={false} isError={isError} />)
    const ok = render(false)
    expect(ok).toContain('Over limit')
    expect(ok).toContain('compared with the previous period')
    expect(ok).toContain('133% of 150')
    const failed = render(true)
    expect(failed).not.toContain('Over limit')
    expect(failed).not.toContain('compared with the previous period')
    expect(failed).not.toContain('of 150')
    expect(failed).toContain('load credits.')
  })

  it('shows an unchanged period as neutral, not as a decrease', () => {
    const markup = renderToStaticMarkup(
      <UsageCredits
        overview={{ ...overview, totals: { credits: 100 }, previousTotals: { credits: 100 } }}
        isLoading={false}
        isError={false}
      />
    )
    expect(markup).toContain('No change compared with the previous period')
    expect(markup).not.toContain('↓')
  })

  it('omits the allowance outside the organization period', () => {
    const markup = renderToStaticMarkup(
      <UsageCredits
        overview={{ ...overview, limitCredits: null }}
        isLoading={false}
        isError={false}
      />
    )
    expect(markup).not.toContain('Over limit')
    expect(markup).not.toContain('role="meter"')
  })
})
