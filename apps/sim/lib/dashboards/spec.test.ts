import { describe, expect, it } from 'vitest'
import { parseDashboardSpec } from '@/lib/dashboards/spec'
import {
  dashboardRangeFromCalendar,
  parseDashboardCustomRange,
  relativeDashboardRange,
} from '@/lib/dashboards/time'

const dashboard = (block: object) =>
  JSON.stringify({ title: 'Test', source: { tableId: 'tbl_test' }, blocks: [block] })
describe('dashboard source', () => {
  it('supports rows, tabs, weights and per-panel sources', () => {
    expect(
      parseDashboardSpec(
        dashboard({
          row: [
            { stat: 'Total', flex: 2, source: { aggregate: { total: { op: 'count' } } } },
            { tabs: { Detail: [{ table: 'Recent', source: { columns: ['createdAt'] } }] } },
          ],
        })
      ).spec
    ).toBeDefined()
  })
  it.each([
    { stat: 'Bad', source: { aggregate: { v: { op: 'percentile' } } } },
    { stat: 'Bad', source: { aggregate: { v: { op: 'avg' } } } },
    { stat: 'Bad', source: { aggregate: { v: { op: 'count' } }, groupBy: ['createdAt'] } },
    { table: 'Bad', source: { columns: ['createdAt'], aggregate: { n: { op: 'count' } } } },
    { text: 'Bad', css: 'color:red' },
    { text: 'Bad', flex: 0 },
    {
      table: 'Bad',
      source: { columns: ['id'], filter: { field: 'id', op: 'invented', value: 'x' } },
    },
    { table: 'Bad', source: { columns: ['id'], filter: { all: [] } } },
    {
      table: 'Bad',
      source: { columns: ['id'], filter: { field: 'id', op: 'eq', value: 'x', rawSql: 'true' } },
    },
  ])('rejects invalid authoring: %j', (block) =>
    expect(parseDashboardSpec(dashboard(block))).toHaveProperty('error')
  )
  it('rejects missing tables, cyclic YAML and excessive blocks', () => {
    expect(
      parseDashboardSpec(
        'title: Test\nblocks: [{stat: Total, source: {aggregate: {n: {op: count}}}}]'
      )
    ).toHaveProperty('error')
    expect(parseDashboardSpec('title: Test\nblocks: &a [{row: *a}]')).toHaveProperty('error')
    expect(
      parseDashboardSpec(
        dashboard({
          row: Array.from({ length: 12 }, () => ({
            row: Array.from({ length: 5 }, () => ({ text: 'hi' })),
          })),
        })
      )
    ).toHaveProperty('error')
  })
  it('confines nested ECharts tooltips and navigation', () => {
    const parsed = parseDashboardSpec(
      dashboard({
        chart: 'Chart',
        source: { columns: ['id'] },
        option: {
          tooltip: { renderMode: 'html', formatter: '<img onerror=alert(1)>' },
          toolbox: {},
          title: { link: 'javascript:alert(1)' },
          media: [{ option: { tooltip: {} } }],
        },
      })
    )
    expect(parsed.spec?.blocks[0]).toMatchObject({
      option: {
        tooltip: { renderMode: 'richText' },
        title: {},
        media: [{ option: { tooltip: { renderMode: 'richText' } } }],
      },
    })
    expect(JSON.stringify(parsed.spec)).not.toContain('javascript:')
    expect(JSON.stringify(parsed.spec)).not.toContain('toolbox')
  })
})
describe('UTC ranges', () => {
  it('includes the whole end minute selected in the calendar', () => {
    expect(dashboardRangeFromCalendar('2026-09-30T00:00', '2026-09-30T23:59:59')).toEqual({
      from: '2026-09-30T00:00:00.000Z',
      to: '2026-10-01T00:00:00.000Z',
    })
    expect(dashboardRangeFromCalendar('2026-09-18T12:30', '2026-09-18T12:30:59')).toEqual({
      from: '2026-09-18T12:30:00.000Z',
      to: '2026-09-18T12:31:00.000Z',
    })
  })
  it('shares exact boundaries even across DST', () => {
    expect(relativeDashboardRange('24h', Date.parse('2026-03-09T00:00:00Z'))).toEqual({
      from: '2026-03-08T00:00:00.000Z',
      to: '2026-03-09T00:00:00.000Z',
    })
    expect(parseDashboardCustomRange('2026-03-08T02:30', '2026-03-08T03:30')).toEqual({
      from: '2026-03-08T02:30:00.000Z',
      to: '2026-03-08T03:30:00.000Z',
    })
  })
  it.each([
    ['', ''],
    ['2026-02-30T00:00', '2026-03-03T00:00'],
    ['2026-03-09T00:00', '2026-03-08T00:00'],
  ])('refuses invalid bounds', (from, to) =>
    expect(() => parseDashboardCustomRange(from, to)).toThrow()
  )
})

describe('panel query modes', () => {
  it('lets a panel switch between detail columns and aggregates inherited from the dashboard', () => {
    const detailDefault = parseDashboardSpec(
      'title: T\nsource: {tableId: tbl_1, columns: [status]}\nblocks:\n  - stat: Total\n    source: {aggregate: {n: {op: count}}}\n'
    )
    expect(detailDefault.error).toBeUndefined()
    const aggregateDefault = parseDashboardSpec(
      'title: T\nsource: {tableId: tbl_1, groupBy: [status], aggregate: {n: {op: count}}}\nblocks:\n  - table: Rows\n    source: {columns: [status]}\n'
    )
    expect(aggregateDefault.error).toBeUndefined()
  })
})

describe('dashboard parse errors', () => {
  it('names the block path, the allowed block kinds and any unknown key', () => {
    expect(parseDashboardSpec('title: Probe\nblocks:\n  - bogus: 1\n').error).toBe(
      'blocks.0: expected a block with one of text, stat, chart, table, row, tabs; unknown key "bogus"'
    )
  })

  it('does not describe a measure union as a block', () => {
    const error = parseDashboardSpec(
      'title: Probe\nsource: {tableId: tbl_1}\nblocks:\n  - stat: Total\n    source: {aggregate: {n: {op: nope}}}\n'
    ).error
    expect(error).toMatch(/^source\.aggregate\.n\.op: |^blocks\.0\.source\.aggregate\.n/)
    expect(error).not.toContain('expected a block')
  })

  it('reports field errors at their path', () => {
    expect(parseDashboardSpec('title: Probe\nblocks: []\n').error).toBe(
      'blocks: Too small: expected array to have >=1 items'
    )
  })
})
