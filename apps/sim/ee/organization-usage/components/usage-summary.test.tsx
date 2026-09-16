/** @vitest-environment node */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { OrganizationUsageSummary } from '@/lib/api/contracts/organization-usage'
import { UsageSummary } from '@/ee/organization-usage/components/usage-summary'

const summary: OrganizationUsageSummary = {
  window: { start: '2026-01-01', end: '2026-01-08', source: 'range' },
  bucket: 'day',
  totals: { credits: 200 },
  previousTotals: { credits: 100 },
  series: [],
}

describe('UsageSummary', () => {
  it('hides stale usage badges when a refresh fails', () => {
    const render = (isError: boolean) =>
      renderToStaticMarkup(
        <UsageSummary summary={summary} limitCredits={150} isLoading={false} isError={isError} />
      )
    expect(render(false)).toContain('Over limit')
    expect(render(false)).toContain('compared with the previous period')
    const failed = render(true)
    expect(failed).not.toContain('Over limit')
    expect(failed).not.toContain('compared with the previous period')
    expect(failed).toContain('load credits.')
  })
})
