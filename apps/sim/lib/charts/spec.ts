/**
 * The `.chart` document contract for the file viewer: parsing/validation and
 * the table-source shaping (group → aggregate → pivot). Pure JSON-in/JSON-out
 * — no React, no echarts.
 */

import { getErrorMessage } from '@sim/utils/errors'
import { getColumnId } from '@/lib/table/column-keys'
import type { ColumnDefinition } from '@/lib/table/types'

/** Hard cap on rows a table-backed chart pulls per read; the spec's `limit` clamps under it. */
export const CHART_ROWS_MAX = 5000
export const CHART_ROWS_DEFAULT = 1000

export type ChartAggregateOp = 'sum' | 'avg' | 'min' | 'max' | 'count'

export const CHART_AGGREGATE_OPS = new Set<string>(['sum', 'avg', 'min', 'max', 'count'])

export interface ChartTableSource {
  type: 'table'
  tableId: string
  filter?: unknown
  sort?: unknown
  limit?: number
  /** Group rows by these columns; requires `aggregate`. */
  groupBy?: string[]
  /** Metric column → op, computed per group. */
  aggregate?: Record<string, ChartAggregateOp>
  /** Fan the aggregated metric(s) out into one column per distinct value of this column. */
  pivot?: string
}

export interface ChartStaticSource {
  type: 'static'
  rows?: Array<Record<string, unknown>>
}

/**
 * A `.chart` file (`text/x-sim-chart`): a declarative ECharts document. The
 * `option` is a plain ECharts option object; `source` optionally supplies the
 * data — inline rows, or a live read of a Sim table injected as
 * `option.dataset.source` so the chart stays current with the table.
 */
export interface ChartSpec {
  schema_version: number
  title?: string
  source?: ChartStaticSource | ChartTableSource
  option: Record<string, unknown>
}

export function parseChartSpec(content: string): { spec?: ChartSpec; error?: string } {
  let raw: unknown
  try {
    raw = JSON.parse(content)
  } catch (e) {
    return { error: getErrorMessage(e, 'not valid JSON') }
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'chart document must be a JSON object' }
  }
  const doc = raw as Record<string, unknown>
  if (doc.schema_version !== 1) {
    return { error: 'chart document must declare "schema_version": 1' }
  }
  if (doc.option === null || typeof doc.option !== 'object' || Array.isArray(doc.option)) {
    return { error: 'chart document must declare an "option" object (an ECharts option)' }
  }
  const source = doc.source as ChartSpec['source']
  if (source !== undefined) {
    if (source === null || typeof source !== 'object') {
      return { error: '"source" must be an object' }
    }
    if (source.type === 'table') {
      if (typeof source.tableId !== 'string' || source.tableId === '') {
        return { error: 'a table source must declare "tableId"' }
      }
      if (source.groupBy !== undefined) {
        if (!Array.isArray(source.groupBy) || source.groupBy.some((c) => typeof c !== 'string')) {
          return { error: '"groupBy" must be an array of column names' }
        }
        if (source.aggregate === null || typeof source.aggregate !== 'object') {
          return { error: '"groupBy" requires an "aggregate" object ({column: op})' }
        }
        const ops = Object.values(source.aggregate)
        if (ops.length === 0 || ops.some((op) => !CHART_AGGREGATE_OPS.has(String(op)))) {
          return { error: '"aggregate" ops must be sum, avg, min, max, or count' }
        }
      }
      if (source.pivot !== undefined) {
        if (typeof source.pivot !== 'string') return { error: '"pivot" must be a column name' }
        if (!source.groupBy) return { error: '"pivot" requires "groupBy" and "aggregate"' }
      }
    } else if (source.type === 'static') {
      if (source.rows !== undefined && !Array.isArray(source.rows)) {
        return { error: 'a static source\'s "rows" must be an array' }
      }
    } else {
      return { error: '"source.type" must be "static" or "table"' }
    }
  }
  // Built explicitly from the validated fields — no blanket cast, and no
  // unvalidated extra keys riding along on the parsed spec.
  return {
    spec: {
      schema_version: 1,
      title: typeof doc.title === 'string' ? doc.title : undefined,
      source,
      option: doc.option as Record<string, unknown>,
    },
  }
}

/**
 * Table rows arrive keyed by column ID (an opaque uuid); chart specs — like
 * the mothership table tool and the public API — speak column NAMES. Remap so
 * `encode`/dimension references in the option match what the author sees in
 * the table UI.
 */
export function mapRowsToColumnNames(
  rows: Array<{ data: Record<string, unknown> }>,
  columns: Array<Pick<ColumnDefinition, 'id' | 'name'>>
): Array<Record<string, unknown>> {
  const nameByStorageKey = new Map<string, string>()
  for (const col of columns) nameByStorageKey.set(getColumnId(col), col.name)
  return rows.map((row) => {
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(row.data)) {
      out[nameByStorageKey.get(key) ?? key] = value
    }
    return out
  })
}

function aggregateValues(
  rows: Array<Record<string, unknown>>,
  column: string,
  op: ChartAggregateOp
): number {
  if (op === 'count') return rows.length
  const values = rows.map((r) => Number(r[column])).filter((n) => Number.isFinite(n))
  if (values.length === 0) return 0
  switch (op) {
    case 'sum':
      return values.reduce((a, b) => a + b, 0)
    case 'avg':
      return values.reduce((a, b) => a + b, 0) / values.length
    case 'min':
      return Math.min(...values)
    case 'max':
      return Math.max(...values)
  }
}

/**
 * Client-side shaping for table sources: group → aggregate → optionally pivot
 * one column's distinct values into per-value columns. Groups keep first-seen
 * order, so the source's `sort` decides the category order. This is the whole
 * "query engine" — deliberately tiny; anything fancier belongs in a static
 * source with precomputed rows.
 */
export function shapeTableRows(
  rows: Array<Record<string, unknown>>,
  source: ChartTableSource
): Array<Record<string, unknown>> {
  const { groupBy, aggregate, pivot } = source
  if (!groupBy || groupBy.length === 0 || !aggregate) return rows

  const groups = new Map<string, Array<Record<string, unknown>>>()
  for (const row of rows) {
    const key = groupBy.map((c) => String(row[c] ?? '')).join('\u0000')
    const bucket = groups.get(key)
    if (bucket) bucket.push(row)
    else groups.set(key, [row])
  }

  const metrics = Object.entries(aggregate)
  const out: Array<Record<string, unknown>> = []
  for (const bucket of groups.values()) {
    const shaped: Record<string, unknown> = {}
    for (const c of groupBy) shaped[c] = bucket[0][c]
    if (pivot) {
      const byValue = new Map<string, Array<Record<string, unknown>>>()
      for (const row of bucket) {
        const value = String(row[pivot] ?? '')
        const slice = byValue.get(value)
        if (slice) slice.push(row)
        else byValue.set(value, [row])
      }
      for (const [value, slice] of byValue) {
        for (const [column, op] of metrics) {
          const name = metrics.length === 1 ? value : `${value} ${column}`
          shaped[name] = aggregateValues(slice, column, op)
        }
      }
    } else {
      for (const [column, op] of metrics) {
        shaped[column] = aggregateValues(bucket, column, op)
      }
    }
    out.push(shaped)
  }
  return out
}
