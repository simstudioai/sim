/** @vitest-environment node */
import { ChartDataTable, DashboardMetric } from '@sim/emcn'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

describe('Chart accessibility', () => {
  it('preserves fractional values in the nonvisual chart table', () => {
    const markup = renderToStaticMarkup(
      <ChartDataTable
        label='Cost'
        series={[
          {
            label: 'Credits',
            data: [
              { timestamp: '2026-01-01T00:00:00Z', value: 0.00000123456789 },
              { timestamp: '2026-01-02T00:00:00Z', value: 1.234567891234567 },
            ],
          },
        ]}
      />
    )
    expect(markup).toContain('0.00000123456789')
    expect(markup).toContain('1.234567891234567')
  })

  it('provides loading text instead of an inaccessible skeleton label', () => {
    const markup = renderToStaticMarkup(<DashboardMetric label='Runs' value='25' loading />)
    expect(markup).toContain('aria-busy="true"')
    expect(markup).toContain('>Loading value</span>')
    expect(markup).not.toContain('aria-label="Loading value"')
    expect(markup).not.toContain('25')
  })
})
