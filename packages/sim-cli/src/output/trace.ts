import { styles } from '#cli/output/presentation'
import type { OutputFormat } from '../config/index'
import { duration, sanitize } from './render'

type TraceSpan = Record<string, unknown>

function traceSpan(value: unknown): TraceSpan {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Trace contains a malformed span')
  }
  return value as TraceSpan
}

function requiredText(span: TraceSpan, field: string): string {
  const value = span[field]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Trace span is missing ${field}`)
  }
  return sanitize(value).replace(/\s+/g, ' ').trim()
}

function optionalText(span: TraceSpan, field: string): string | undefined {
  const value = span[field]
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Error(`Trace span ${field} must be a string`)
  return sanitize(value).replace(/\s+/g, ' ').trim()
}

function optionalNumber(span: TraceSpan, field: string): number | undefined {
  const value = span[field]
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Trace span ${field} must be a finite number`)
  }
  return value
}

function costTotal(span: TraceSpan): number | undefined {
  const value = span.cost
  if (value === undefined) return undefined
  const cost = traceSpan(value)
  return optionalNumber(cost, 'total')
}

function appendValue(lines: string[], indent: string, label: string, value: unknown): void {
  if (value === undefined) return
  const encoded = JSON.stringify(value, null, 2)
  if (encoded === undefined) throw new Error(`Trace span ${label} cannot be rendered`)
  const valueLines = sanitize(encoded).split('\n')
  if (valueLines.length === 1) {
    lines.push(`${indent}${label}: ${valueLines[0]}`)
    return
  }
  lines.push(`${indent}${label}:`)
  lines.push(...valueLines.map((line) => `${indent}  ${line}`))
}

function renderSpan(value: unknown, depth: number): string[] {
  const span = traceSpan(value)
  const indent = '  '.repeat(depth)
  const detailIndent = `${indent}  `
  const name = requiredText(span, 'name')
  const type = requiredText(span, 'type')
  const status = optionalText(span, 'status')
  const elapsed = optionalNumber(span, 'durationMs') ?? optionalNumber(span, 'duration')
  const totalCost = costTotal(span)
  const summary = [
    `${indent}- ${name}`,
    `[${type}]`,
    status,
    elapsed === undefined ? undefined : duration(Math.round(elapsed)),
    totalCost === undefined ? undefined : `$${totalCost.toFixed(4)}`,
  ]
    .filter((part): part is string => Boolean(part))
    .join(' ')
  const lines = [summary, `${detailIndent}id: ${requiredText(span, 'id')}`]
  const blockId = optionalText(span, 'blockId')
  if (blockId) lines.push(`${detailIndent}block: ${blockId}`)
  const startTime = optionalText(span, 'startTime')
  const endTime = optionalText(span, 'endTime')
  if (startTime || endTime) {
    lines.push(`${detailIndent}time: ${startTime ?? '—'} → ${endTime ?? '—'}`)
  }
  const relativeStartMs = optionalNumber(span, 'relativeStartMs')
  if (relativeStartMs !== undefined) {
    lines.push(`${detailIndent}relative start: ${duration(Math.round(relativeStartMs))}`)
  }
  const errorType = optionalText(span, 'errorType')
  const errorMessage = optionalText(span, 'errorMessage')
  if (errorType || errorMessage) {
    lines.push(`${detailIndent}error: ${[errorType, errorMessage].filter(Boolean).join(': ')}`)
  }
  appendValue(lines, detailIndent, 'tokens', span.tokens)
  appendValue(lines, detailIndent, 'input', span.input)
  appendValue(lines, detailIndent, 'output', span.output)
  appendValue(lines, detailIndent, 'tool calls', span.toolCalls)

  if (span.children !== undefined) {
    if (!Array.isArray(span.children)) throw new Error('Trace span children must be an array')
    for (const child of span.children) lines.push(...renderSpan(child, depth + 1))
  }
  return lines
}

/** Prints the complete recursive run trace for an explicitly expanded log. */
export function printTraceSpans(format: OutputFormat, traceSpans: unknown[]): void {
  if (format === 'json' || format === 'yaml') return
  console.log('')
  console.log(format === 'table' ? styles().dim('trace:') : 'trace:')
  if (traceSpans.length === 0) {
    console.log(styles().dim('  No trace spans.'))
    return
  }
  console.log(traceSpans.flatMap((span) => renderSpan(span, 0)).join('\n'))
}
