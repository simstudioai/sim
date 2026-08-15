import type { OutputFormat } from '../config/index'
import type { ColumnSpec, CommandSpec } from '../contract/types'
import type { V2OperationName } from '../generated/v2-api'
import {
  bool,
  bytes,
  type Column,
  duration,
  printDocument,
  printList,
  printRecord,
  sanitize,
  text,
  timestamp,
} from '../output/render'
import { printTraceSpans } from '../output/trace'

interface RenderResultOptions {
  expandedTrace?: boolean
}

function countTraceSpans(value: unknown): number {
  if (!Array.isArray(value)) return 0
  return value.reduce((count, span) => {
    if (!span || typeof span !== 'object' || Array.isArray(span)) {
      throw new Error('Trace contains a malformed span')
    }
    return count + 1 + countTraceSpans((span as Record<string, unknown>).children)
  }, 0)
}

function at(row: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (value, key) => (value && typeof value === 'object' ? (value as never)[key] : undefined),
      row
    )
}

function renderCell(
  value: unknown,
  format: ColumnSpec['format'],
  options: RenderResultOptions = {}
): string {
  switch (format) {
    case 'timestamp':
      return timestamp(value as string | null)
    case 'bytes':
      return bytes(value as number | null)
    case 'duration':
      return duration(value as number | null)
    case 'bool':
      return bool(value as boolean | null)
    case 'cost':
      return typeof value === 'number' ? `$${value.toFixed(4)}` : text(null)
    case 'count':
      return Array.isArray(value) ? String(value.length) : text(null)
    case 'trace-count': {
      const count = countTraceSpans(value)
      return `${count} ${count === 1 ? 'span' : 'spans'}${
        options.expandedTrace ? '' : ' (use --trace)'
      }`
    }
    default:
      if (value === null || value === undefined || value === '') return text(null)
      return sanitize(typeof value === 'object' ? JSON.stringify(value) : String(value))
  }
}

const NESTED_CELL_WIDTH = 160

function recordCell(value: unknown): string {
  const rendered = renderCell(value, 'auto')
  return rendered.length > NESTED_CELL_WIDTH ? `${rendered.slice(0, NESTED_CELL_WIDTH)}…` : rendered
}

function columnsFrom(specs: ColumnSpec[]): Column<unknown>[] {
  return specs.map((spec) => ({
    header: spec.header,
    value: (row: unknown) => renderCell(at(row, spec.path ?? spec.header), spec.format),
  }))
}

function fieldsFrom(
  data: unknown,
  specs: ColumnSpec[],
  options: RenderResultOptions = {}
): Array<[string, string]> {
  return specs.flatMap((spec) => {
    const value = at(data, spec.path ?? spec.header)
    return value === undefined ? [] : [[spec.header, renderCell(value, spec.format, options)]]
  })
}

function inferColumns(rows: unknown[], expand?: string): Column<unknown>[] {
  const paths: Array<{ path: string; header: string }> = []
  const seen = new Set<string>()

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    for (const [key, value] of Object.entries(row)) {
      if (seen.has(key)) continue
      if (value !== null && typeof value === 'object') continue
      seen.add(key)
      paths.push({ path: key, header: key })
    }
  }

  if (expand) {
    const nested = new Set<string>()
    for (const row of rows) {
      const container = at(row, expand)
      if (!container || typeof container !== 'object' || Array.isArray(container)) continue
      for (const key of Object.keys(container)) {
        if (nested.has(key)) continue
        nested.add(key)
        paths.push({ path: `${expand}.${key}`, header: seen.has(key) ? `${expand}.${key}` : key })
      }
    }
  }

  return paths.map(({ path, header }) => ({
    header: sanitize(header),
    value: (row: unknown) => renderCell(at(row, path), 'auto'),
  }))
}

function unwrapResource(data: unknown): unknown {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data
  const entries = Object.entries(data)
  if (entries.length !== 1) return data
  const [, value] = entries[0]
  return value && typeof value === 'object' && !Array.isArray(value) ? value : data
}

export function renderPage(format: OutputFormat, rows: unknown[], spec: CommandSpec): void {
  printList(
    format,
    rows,
    spec.columns ? columnsFrom(spec.columns) : inferColumns(rows, spec.expand)
  )
}

/** Renders one non-paginated operation result according to its CLI contract. */
export function renderResult(
  operation: V2OperationName,
  format: OutputFormat,
  raw: unknown,
  spec: CommandSpec,
  options: RenderResultOptions = {}
): void {
  if (spec.document) {
    printDocument(format, raw)
    return
  }

  const data = unwrapResource(raw)
  if (spec.itemsPath) {
    const items = at(data, spec.itemsPath)
    if (!Array.isArray(items)) {
      throw new Error(`${operation} expected an array at response path ${spec.itemsPath}`)
    }
    printList(
      format,
      items,
      spec.columns ? columnsFrom(spec.columns) : inferColumns(items, spec.expand),
      data
    )
    return
  }

  if (Array.isArray(data)) {
    printList(
      format,
      data,
      spec.columns ? columnsFrom(spec.columns) : inferColumns(data, spec.expand)
    )
    return
  }

  const fields = spec.fields
    ? fieldsFrom(data, spec.fields, options)
    : data && typeof data === 'object'
      ? Object.entries(data).map<[string, string]>(([key, value]) => [key, recordCell(value)])
      : []

  printRecord(format, fields, data)
  if (spec.expandedTrace && options.expandedTrace) {
    const traceSpans = at(data, 'traceSpans')
    if (!Array.isArray(traceSpans)) {
      throw new Error(`${operation} expected a traceSpans array`)
    }
    printTraceSpans(format, traceSpans)
  }
}
