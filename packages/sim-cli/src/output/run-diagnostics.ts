import { isRecordLike } from '@sim/utils/object'
import { truncate } from '@sim/utils/string'

const MAX_SPANS = 100
const MAX_FAILURES = 10
const MAX_FIELDS = 12
const MAX_DEPTH = 4
const MAX_TEXT = 400
const MAX_VALUES = 300

function isMediaType(value: unknown): boolean {
  return typeof value === 'string' && value.length <= 255 && /^[^\s/]+\/[^\s/]+$/.test(value)
}

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
    const entries: [string, unknown][] = []
    for (const key in value) {
      if (!Object.hasOwn(value, key)) continue
      if (entries.length === MAX_FIELDS) {
        truncated = true
        break
      }
      const child = value[key]
      const binary =
        key === 'data' &&
        ((typeof child === 'string' &&
          (isMediaType(value.mimeType) ||
            (typeof value.name === 'string' && isMediaType(value.type)))) ||
          (value.type === 'Buffer' && Array.isArray(child)))
      if (key.length > MAX_TEXT) truncated = true
      entries.push([
        truncate(key, MAX_TEXT),
        binary ? '[binary omitted]' : compact(child, depth + 1, key),
      ])
    }
    return Object.fromEntries(entries)
  }

  const finalOutput = compact(log.finalOutput)
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
    finalOutput,
    failures,
    observedBlocks,
    files,
    truncated,
    scope:
      'Recorded trace only; absent spans may be unexecuted or expired. finalOutput is workflow-defined; execution success does not establish delivery or output quality. Binary content is omitted. Use the run-file download command for bytes.',
  }
}
