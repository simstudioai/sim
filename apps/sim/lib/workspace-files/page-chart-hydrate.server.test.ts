/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/uploads/core/storage-service', () => ({
  downloadFile: vi.fn(async () =>
    Buffer.from(
      JSON.stringify({
        schema_version: 1,
        title: 'Static ref',
        source: { type: 'static', rows: [{ month: 'Jan', revenue: 10 }] },
        option: {
          xAxis: { type: 'category' },
          yAxis: {},
          series: [{ type: 'bar', encode: { x: 'month', y: 'revenue' } }],
        },
      })
    )
  ),
}))
vi.mock('@/lib/uploads/server/metadata', () => ({
  getFileMetadataById: vi.fn(async (id: string) =>
    id === 'chart-1' ? { id, key: 'k1', workspaceId: 'ws-1' } : null
  ),
}))
vi.mock('@/lib/table/application/rows', () => ({
  queryTableRows: { execute: vi.fn() },
}))

import {
  injectChartHydration,
  resolveChartFileRefs,
} from '@/lib/workspace-files/page-chart-hydrate.server'
import { compileSimPage } from '@/lib/workspace-files/page-compile'

function page(body: string): string {
  return `---\ntitle: Test\n---\n\n${body}\n`
}

describe('sim:chart fences', () => {
  it('renders an inline payload to a hydratable figure', () => {
    const diagnostics: string[] = []
    const html = compileSimPage(
      page(
        [
          '```sim:chart Revenue',
          JSON.stringify({
            rows: [{ month: 'Jan', revenue: 10 }],
            option: { xAxis: {}, yAxis: {}, series: [{ type: 'bar' }] },
          }),
          '```',
        ].join('\n')
      ),
      { diagnostics }
    )
    expect(diagnostics).toEqual([])
    expect(html).toContain('class="sim-chart-spec"')
    expect(html).toContain('sim-chart-canvas')
    expect(html).toContain('Revenue')
  })

  it('emits a marker for a file reference and resolves it server-side', async () => {
    const diagnostics: string[] = []
    const compiled = compileSimPage(
      page(['```sim:chart Sales', '{"file": "sim:file/chart-1"}', '```'].join('\n')),
      { diagnostics }
    )
    expect(diagnostics).toEqual([])
    expect(compiled).toContain('data-sim-chart-file="chart-1"')

    const resolved = await resolveChartFileRefs(compiled, { workspaceId: 'ws-1' })
    expect(resolved).not.toContain('data-sim-chart-file')
    expect(resolved).toContain('class="sim-chart-spec"')
    expect(resolved).toContain('Sales')
  })

  it('degrades a cross-workspace reference to a placeholder', async () => {
    const compiled = compileSimPage(page(['```sim:chart', '{"file": "chart-1"}', '```'].join('\n')))
    const resolved = await resolveChartFileRefs(compiled, { workspaceId: 'other-ws' })
    expect(resolved).toContain('sim-chart-placeholder')
    expect(resolved).not.toContain('sim-chart-spec')
  })

  it('reports a diagnostic for an invalid payload', () => {
    const diagnostics: string[] = []
    compileSimPage(page(['```sim:chart', '{"rows": []}', '```'].join('\n')), { diagnostics })
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]).toContain('sim:chart block skipped')
  })

  it('inlines the chart runtime only when figures are present', async () => {
    const withChart = await injectChartHydration(
      '<html><body><figure class="sim-chart"></figure></body></html>'
    )
    expect(withChart).toContain('echarts')
    expect(withChart.indexOf('</body>')).toBeGreaterThan(withChart.indexOf('sim-chart'))
    const without = await injectChartHydration('<html><body><p>hi</p></body></html>')
    expect(without).not.toContain('echarts')
  })
})
