import { isRecordLike } from '@sim/utils/object'
import { truncate } from '@sim/utils/string'

const MAX_SPANS = 100
const MAX_TOOL_CALLS = 100
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

  const failures: Record<string, unknown>[] = []
  const observedBlocks: Record<string, unknown>[] = []
  /** Iterator frames keep traversal memory proportional to depth, not trace width. */
  const pending = [(Array.isArray(log.traceSpans) ? log.traceSpans : [])[Symbol.iterator]()]
  let visited = 0
  let visitedToolCalls = 0
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
      blockId: span.blockId,
      name: span.name,
      status: span.status,
    }
    if (typeof span.blockId === 'string') observedBlocks.push(identity)
    if (span.errorMessage || span.status === 'error' || span.status === 'failed') {
      if (failures.length < MAX_FAILURES) {
        failures.push({
          ...identity,
          error: span.errorMessage,
          handled: span.errorHandled === true,
          input: span.input,
          output: span.output,
        })
      } else truncated = true
    } else if (Array.isArray(span.toolCalls)) {
      /** Older persisted traces store tool calls here instead of in child spans. */
      for (let index = 0; index < span.toolCalls.length; index++) {
        if (visitedToolCalls === MAX_TOOL_CALLS) {
          truncated = true
          break
        }
        visitedToolCalls++
        const call = span.toolCalls[index]
        if (!isRecordLike(call)) continue
        if (call.status !== 'error' && (typeof call.error !== 'string' || !call.error)) continue
        if (failures.length === MAX_FAILURES) {
          truncated = true
          break
        }
        failures.push({
          blockId: identity.blockId,
          name: call.name,
          status: call.status,
          error: call.error,
          handled: span.errorHandled === true,
          input: call.input,
          output: call.output,
        })
      }
    }
    if (Array.isArray(span.children)) pending.push(span.children[Symbol.iterator]())
  }
  if (pending.some((iterator) => !iterator.next().done)) truncated = true

  /** Keep bounded failure evidence before arbitrary payloads consume the shared value budget. */
  const compactFailures: Record<string, unknown>[] = failures.map((failure) => ({
    blockId: compact(failure.blockId),
    name: compact(failure.name),
    status: compact(failure.status),
    error: compact(failure.error),
    handled: failure.handled,
  }))
  const finalOutput = compact(log.finalOutput)
  const files = compact(log.files)
  for (const [index, failure] of failures.entries()) {
    compactFailures[index].input = compact(failure.input)
    compactFailures[index].output = compact(failure.output)
  }
  const compactBlocks = observedBlocks.map((block) => ({
    blockId: compact(block.blockId),
    name: compact(block.name),
    status: compact(block.status),
  }))

  return {
    runId: log.runId,
    executionStatus: log.status,
    finalOutput,
    failures: compactFailures,
    observedBlocks: compactBlocks,
    files,
    truncated,
    scope:
      'Recorded trace only; absent spans may be unexecuted or expired. finalOutput is workflow-defined; execution success does not establish delivery or output quality. Binary content is omitted. Use the run-file download command for bytes.',
  }
}
