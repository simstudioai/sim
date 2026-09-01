/**
 * @vitest-environment node
 */
import * as echarts from 'echarts'
import { describe, expect, it } from 'vitest'
import { buildChartRenderOption } from '@/lib/charts/option'
import { parseChartSpec, shapeTableRows } from '@/lib/charts/spec'

/** Parses a chart document written as a plain object, asserting it was accepted. */
function parse(doc: Record<string, unknown>): Record<string, unknown> {
  const { spec, error } = parseChartSpec(JSON.stringify(doc))
  expect(error).toBeUndefined()
  return spec!.option
}

const rows = [
  { month: '2024-01', region: 'NA', revenue: 100, conversion: 4 },
  { month: '2024-01', region: 'EMEA', revenue: 50, conversion: 2 },
  { month: '2024-02', region: 'NA', revenue: 200, conversion: 6 },
  { month: '2024-02', region: 'EMEA', revenue: 80, conversion: 4 },
]

describe('shapeTableRows', () => {
  it('passes rows through without groupBy', () => {
    expect(shapeTableRows(rows, { type: 'table', tableId: 't' })).toBe(rows)
  })

  it('groups and aggregates, keeping first-seen group order', () => {
    const shaped = shapeTableRows(rows, {
      type: 'table',
      tableId: 't',
      groupBy: ['month'],
      aggregate: { revenue: 'sum', conversion: 'avg' },
    })
    expect(shaped).toEqual([
      { month: '2024-01', revenue: 150, conversion: 3 },
      { month: '2024-02', revenue: 280, conversion: 5 },
    ])
  })

  it('pivots a single metric into per-value columns', () => {
    const shaped = shapeTableRows(rows, {
      type: 'table',
      tableId: 't',
      groupBy: ['month'],
      aggregate: { revenue: 'sum' },
      pivot: 'region',
    })
    expect(shaped).toEqual([
      { month: '2024-01', NA: 100, EMEA: 50 },
      { month: '2024-02', NA: 200, EMEA: 80 },
    ])
  })

  it('prefixes pivot columns when several metrics are aggregated', () => {
    const shaped = shapeTableRows(rows, {
      type: 'table',
      tableId: 't',
      groupBy: ['month'],
      aggregate: { revenue: 'sum', conversion: 'avg' },
      pivot: 'region',
    })
    expect(shaped[0]).toEqual({
      month: '2024-01',
      'NA revenue': 100,
      'NA conversion': 4,
      'EMEA revenue': 50,
      'EMEA conversion': 2,
    })
  })

  it('counts rows and ignores non-numeric values in numeric ops', () => {
    const noisy = [
      { g: 'a', v: 1 },
      { g: 'a', v: 'oops' },
      { g: 'a', v: 3 },
    ]
    expect(
      shapeTableRows(noisy, {
        type: 'table',
        tableId: 't',
        groupBy: ['g'],
        aggregate: { v: 'count' },
      })
    ).toEqual([{ g: 'a', v: 3 }])
    expect(
      shapeTableRows(noisy, {
        type: 'table',
        tableId: 't',
        groupBy: ['g'],
        aggregate: { v: 'avg' },
      })
    ).toEqual([{ g: 'a', v: 2 }])
  })
})

const XSS_FORMATTER = '<img src=x onerror="alert(1)">'
const XSS_LINK = 'javascript:alert(document.domain)'

describe('parseChartSpec option confinement', () => {
  it('forces the tooltip off the innerHTML path, keeping the formatter template', () => {
    const option = parse({
      schema_version: 1,
      option: { tooltip: { trigger: 'item', formatter: XSS_FORMATTER }, series: [{ type: 'bar' }] },
    })
    expect(option.tooltip).toEqual({
      trigger: 'item',
      formatter: XSS_FORMATTER,
      renderMode: 'richText',
    })
  })

  it('overrides a spec-declared html render mode', () => {
    const option = parse({
      schema_version: 1,
      option: { tooltip: { renderMode: 'html', formatter: XSS_FORMATTER } },
    })
    expect((option.tooltip as Record<string, unknown>).renderMode).toBe('richText')
  })

  it('reaches tooltips nested under media, baseOption, timeline options, and series', () => {
    const option = parse({
      schema_version: 1,
      option: {
        baseOption: { tooltip: { formatter: XSS_FORMATTER } },
        options: [{ tooltip: { formatter: XSS_FORMATTER } }],
        media: [{ query: { minWidth: 100 }, option: { tooltip: { formatter: XSS_FORMATTER } } }],
        series: [
          {
            type: 'bar',
            tooltip: { formatter: XSS_FORMATTER },
            data: [{ value: 1, tooltip: { formatter: XSS_FORMATTER } }],
          },
        ],
      },
    })
    const renderModes: unknown[] = []
    function collect(node: unknown): void {
      if (node === null || typeof node !== 'object') return
      if (Array.isArray(node)) {
        for (const entry of node) collect(entry)
        return
      }
      const record = node as Record<string, unknown>
      if (record.formatter === XSS_FORMATTER) renderModes.push(record.renderMode)
      for (const value of Object.values(record)) collect(value)
    }
    collect(option)
    expect(renderModes).toHaveLength(5)
    expect(renderModes.every((mode) => mode === 'richText')).toBe(true)
  })

  it('confines a tooltip declared as an array', () => {
    const option = parse({
      schema_version: 1,
      option: { tooltip: [{ formatter: XSS_FORMATTER }, { formatter: 'plain' }] },
    })
    expect(option.tooltip).toEqual([
      { formatter: XSS_FORMATTER, renderMode: 'richText' },
      { formatter: 'plain', renderMode: 'richText' },
    ])
  })

  it('drops the toolbox at every level', () => {
    const option = parse({
      schema_version: 1,
      option: {
        toolbox: { feature: { dataView: { lang: [XSS_FORMATTER] } } },
        baseOption: { toolbox: { feature: { saveAsImage: {} } } },
        media: [{ query: { minWidth: 100 }, option: { toolbox: { show: true } } }],
      },
    })
    expect(option.toolbox).toBeUndefined()
    expect((option.baseOption as Record<string, unknown>).toolbox).toBeUndefined()
    const media = option.media as Array<{ option: Record<string, unknown> }>
    expect(media[0].option.toolbox).toBeUndefined()
  })

  it('drops every navigation sink — title link/sublink and treemap/sunburst item links', () => {
    const option = parse({
      schema_version: 1,
      option: {
        title: { text: 'click me', link: XSS_LINK, sublink: XSS_LINK, target: 'self' },
        series: [
          { type: 'treemap', data: [{ name: 'a', value: 1, link: XSS_LINK }] },
          { type: 'sunburst', data: [{ name: 'b', value: 1, link: XSS_LINK }] },
        ],
        baseOption: { title: { link: XSS_LINK } },
        media: [{ query: { minWidth: 100 }, option: { title: { link: XSS_LINK } } }],
      },
    })
    expect(JSON.stringify(option)).not.toContain('javascript:')
    expect(option.title).toEqual({ text: 'click me', target: 'self' })
  })

  it('adds no tooltip to a document that declares none', () => {
    const option = parse({ schema_version: 1, option: { series: [{ type: 'bar', data: [1] }] } })
    expect('tooltip' in option).toBe(false)
  })

  it('rejects a document too deep to walk instead of throwing', () => {
    const nest = (depth: number) => {
      let series = '1'
      for (let i = 0; i < depth; i++) series = `[${series}]`
      return `{"schema_version":1,"option":{"series":${series}}}`
    }
    expect(parseChartSpec(nest(500)).error).toBeUndefined()
    expect(parseChartSpec(nest(50_000)).error).toMatch(/deeply/)
  })

  it('leaves dataset rows alone — they hold data, not components', () => {
    const rows = [{ tooltip: 'ok', toolbox: 'ok', link: 'ok' }]
    const option = parse({ schema_version: 1, option: { dataset: { source: rows } } })
    expect((option.dataset as Record<string, unknown>).source).toEqual(rows)
  })
})

describe('chart option confinement against echarts', () => {
  /**
   * Pins the library behavior the confinement relies on: the tooltip's render
   * mode is resolved from the single tooltip component, and a tooltip reaching
   * that component only through `media` would otherwise default to HTML. Renders
   * server-side so the assertion runs without a DOM.
   */
  function renderModel(option: Record<string, unknown>) {
    const chart = echarts.init(null, null, {
      renderer: 'svg',
      ssr: true,
      width: 400,
      height: 300,
    })
    try {
      chart.setOption(buildChartRenderOption({ option, rows: null }))
      return chart.getModel()
    } finally {
      chart.dispose()
    }
  }

  it('resolves a media-only tooltip to the canvas render mode', () => {
    const model = renderModel(
      parse({
        schema_version: 1,
        option: {
          xAxis: {},
          yAxis: {},
          series: [{ type: 'bar', data: [1, 2] }],
          media: [{ query: { minWidth: 100 }, option: { tooltip: { formatter: XSS_FORMATTER } } }],
        },
      })
    )
    expect(model.getComponent('tooltip')?.get('renderMode')).toBe('richText')
  })

  it.each([
    ['top-level', { tooltip: { formatter: XSS_FORMATTER } }],
    [
      'series-level',
      { series: [{ type: 'bar', data: [1], tooltip: { formatter: XSS_FORMATTER } }] },
    ],
    ['non-object top-level', { tooltip: 'x', series: [{ type: 'bar', data: [1], tooltip: {} }] }],
    ['array', { tooltip: [{ formatter: XSS_FORMATTER }] }],
    ['baseOption', { baseOption: { tooltip: { formatter: XSS_FORMATTER } } }],
  ])('leaves no tooltip component on the innerHTML path (%s)', (_label, declaration) => {
    const model = renderModel(
      parse({
        schema_version: 1,
        option: { xAxis: {}, yAxis: {}, series: [{ type: 'bar', data: [1] }], ...declaration },
      })
    )
    const renderMode = model.getComponent('tooltip')?.get('renderMode')
    expect(renderMode === undefined || renderMode === 'richText').toBe(true)
  })

  it('never instantiates a toolbox component', () => {
    const model = renderModel(
      parse({
        schema_version: 1,
        option: {
          xAxis: {},
          yAxis: {},
          series: [{ type: 'bar', data: [1] }],
          toolbox: { feature: { dataView: {} } },
        },
      })
    )
    expect(model.getComponent('toolbox')).toBeUndefined()
  })

  it('leaves the title component no link to hand to windowOpen', () => {
    const model = renderModel(
      parse({
        schema_version: 1,
        option: {
          xAxis: {},
          yAxis: {},
          series: [{ type: 'bar', data: [1] }],
          title: { text: 'click me', link: XSS_LINK, sublink: XSS_LINK },
        },
      })
    )
    const title = model.getComponent('title')
    expect(title?.get('text')).toBe('click me')
    expect(title?.get('link')).toBeUndefined()
    expect(title?.get('sublink')).toBeUndefined()
  })
})

describe('parseChartSpec table-shaping validation', () => {
  it('rejects groupBy without aggregate and bad ops', () => {
    const base = { schema_version: 1, option: {} }
    expect(
      parseChartSpec(
        JSON.stringify({
          ...base,
          source: { type: 'table', tableId: 't', groupBy: ['m'] },
        })
      ).error
    ).toMatch(/aggregate/)
    expect(
      parseChartSpec(
        JSON.stringify({
          ...base,
          source: { type: 'table', tableId: 't', groupBy: ['m'], aggregate: { v: 'median' } },
        })
      ).error
    ).toMatch(/ops/)
    expect(
      parseChartSpec(
        JSON.stringify({
          ...base,
          source: { type: 'table', tableId: 't', pivot: 'region' },
        })
      ).error
    ).toMatch(/pivot/)
  })
})
