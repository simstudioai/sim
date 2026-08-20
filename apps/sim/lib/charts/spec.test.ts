/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { parseChartSpec, shapeTableRows } from '@/lib/charts/spec'

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
