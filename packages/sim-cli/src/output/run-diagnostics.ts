import { isRecordLike } from '@sim/utils/object'
import { truncate } from '@sim/utils/string'

const MAX_SPANS = 100
const MAX_FAILURES = 10
const MAX_FIELDS = 12
const MAX_DEPTH = 4
const MAX_TEXT = 400
const MAX_VALUES = 300

/** Projects recorded evidence without inferring delivery from an execution status. */
export function summarizeRun(log: unknown): Record<string, unknown> {
  if (!isRecordLike(log)) throw new Error('Run diagnostics expected a log record')
  let truncated = false
  let remaining = MAX_VALUES

  const compact = (value: unknown, depth = 0, field = ''): unknown => {
    if (--remaining < 0 || depth > MAX_DEPTH) {
      truncated = true
      return '[omitted]'
    }
    if (/^(?:base64|fileBase64|dataUrl)$/i.test(field)) return '[binary omitted]'
    if (typeof value === 'string') {
      if (value.startsWith('data:') && value.includes(';base64,')) return '[binary omitted]'
      if (value.length > MAX_TEXT) truncated = true
      return truncate(value, MAX_TEXT)
    }
    if (Array.isArray(value)) {
      if (value.length > MAX_FIELDS) truncated = true
      return value.slice(0, MAX_FIELDS).map((item) => compact(item, depth + 1))
    }
    if (!isRecordLike(value)) return value ?? null
    const entries = Object.entries(value)
    if (entries.length > MAX_FIELDS) truncated = true
    return Object.fromEntries(
      entries.slice(0, MAX_FIELDS).map(([key, child]) => {
        const binary = key === 'data' && ('mimeType' in value || 'type' in value || 'name' in value)
        if (key.length > MAX_TEXT) truncated = true
        return [
          truncate(key, MAX_TEXT),
          binary ? '[binary omitted]' : compact(child, depth + 1, key),
        ]
      })
    )
  }

  const output = isRecordLike(log.finalOutput) ? log.finalOutput : null
  /** Function and Response blocks retain their standard result/data wrappers in stored logs. */
  const outcomeContainers = [output, output?.result, output?.data]
  const outcomeContainer = outcomeContainers.find(
    (value) => isRecordLike(value) && Object.hasOwn(value, 'applicationOutcome')
  )
  const applicationOutcome = compact(
    isRecordLike(outcomeContainer) ? outcomeContainer.applicationOutcome : null
  )
  const files = compact(log.files)

  const failures: Record<string, unknown>[] = []
  const observedBlocks: Record<string, unknown>[] = []
  /** Iterator frames keep traversal memory proportional to depth, not trace width. */
  const pending = [(Array.isArray(log.traceSpans) ? log.traceSpans : [])[Symbol.iterator]()]
  let visited = 0
  while (pending.length > 0 && visited < MAX_SPANS) {
    const next = pending[pending.length - 1].next()
    if (next.done) {
      pending.pop()
      continue
    }
    visited++
    const span = next.value
    if (!isRecordLike(span)) continue
    const identity = {
      blockId: compact(span.blockId),
      name: compact(span.name),
      status: compact(span.status),
    }
    if (typeof span.blockId === 'string') observedBlocks.push(identity)
    if (span.errorMessage || span.status === 'error' || span.status === 'failed') {
      if (failures.length < MAX_FAILURES) {
        failures.push({
          ...identity,
          error: compact(span.errorMessage),
          handled: span.errorHandled === true,
          input: compact(span.input),
          output: compact(span.output),
        })
      } else truncated = true
    }
    if (Array.isArray(span.children)) pending.push(span.children[Symbol.iterator]())
  }
  if (pending.some((iterator) => !iterator.next().done)) truncated = true

  return {
    runId: log.runId,
    executionStatus: log.status,
    applicationOutcome,
    failures,
    observedBlocks,
    files,
    truncated,
    scope:
      'Recorded trace only; absent spans may be unexecuted or expired. applicationOutcome is workflow-defined; null means not reported. Binary content is omitted. Use the run-file download command for bytes.',
  }
}
