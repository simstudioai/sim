/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
// Side-effect import: registers the SSR sim:chart renderer with page-compile.
import '@/lib/workspace-files/page-chart-ssr.server'
import { compileSimPage } from '@/lib/workspace-files/page-compile'

function page(body: string): string {
  return `---\ntitle: Test\n---\n\n${body}\n`
}

describe('sim:chart SSR rendering', () => {
  it('renders a chart fence to themed inline SVGs', () => {
    const source = page(
      [
        '```sim:chart Revenue by month',
        JSON.stringify({
          height: 240,
          option: {
            xAxis: { type: 'category', data: ['Jan', 'Feb'] },
            yAxis: { type: 'value' },
            series: [{ type: 'bar', data: [3, 5] }],
          },
        }),
        '```',
      ].join('\n')
    )
    const diagnostics: string[] = []
    const html = compileSimPage(source, { diagnostics })
    expect(diagnostics).toEqual([])
    expect(html).toContain('<figure class="sim-chart">')
    expect(html).toContain('sim-chart-light')
    expect(html).toContain('sim-chart-dark')
    expect(html).toContain('<svg')
    expect(html).toContain('Revenue by month')
  })

  it('injects rows as the dataset for encode-based options', () => {
    const source = page(
      [
        '```sim:chart',
        JSON.stringify({
          rows: [
            { month: 'Jan', revenue: 10 },
            { month: 'Feb', revenue: 20 },
          ],
          option: {
            xAxis: { type: 'category' },
            yAxis: { type: 'value' },
            series: [{ type: 'bar', encode: { x: 'month', y: 'revenue' } }],
          },
        }),
        '```',
      ].join('\n')
    )
    const diagnostics: string[] = []
    const html = compileSimPage(source, { diagnostics })
    expect(diagnostics).toEqual([])
    expect(html).toContain('<svg')
    expect(html).toContain('Feb')
  })

  it('reports a diagnostic for a payload without an option object', () => {
    const source = page(['```sim:chart', '{"rows": []}', '```'].join('\n'))
    const diagnostics: string[] = []
    const html = compileSimPage(source, { diagnostics })
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]).toContain('sim:chart block skipped')
    expect(html).not.toContain('<figure class="sim-chart">')
  })
})
