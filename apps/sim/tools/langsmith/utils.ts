import { generateId } from '@sim/utils/id'
import type { LangsmithRunPayload } from '@/tools/langsmith/types'

/** Versioned LangSmith API base. Only `/api/v1/*` paths are declared in the published OpenAPI spec. */
export const LANGSMITH_API_BASE = 'https://api.smith.langchain.com/api/v1'

/**
 * Upper bound on upstream error bodies echoed into a thrown message. An HTML
 * error page or a large payload echo would otherwise land whole in the error
 * string, the execution log, and the model's context.
 */
export const ERROR_TEXT_MAX_LENGTH = 500

interface NormalizedRunPayload {
  payload: LangsmithRunPayload
  runId: string
}

const toCompactTimestamp = (startTime?: string): string => {
  const parsed = startTime ? new Date(startTime) : new Date()
  const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed
  const pad = (value: number, length: number) => value.toString().padStart(length, '0')
  const year = date.getUTCFullYear()
  const month = pad(date.getUTCMonth() + 1, 2)
  const day = pad(date.getUTCDate(), 2)
  const hours = pad(date.getUTCHours(), 2)
  const minutes = pad(date.getUTCMinutes(), 2)
  const seconds = pad(date.getUTCSeconds(), 2)
  const micros = pad(date.getUTCMilliseconds() * 1000, 6)
  return `${year}${month}${day}T${hours}${minutes}${seconds}${micros}`
}

export const normalizeLangsmithRunPayload = (run: LangsmithRunPayload): NormalizedRunPayload => {
  const runId = run.id ?? generateId()
  const traceId = run.trace_id ?? runId
  const startTime = run.start_time ?? new Date().toISOString()
  const dottedOrder = run.dotted_order ?? `${toCompactTimestamp(startTime)}Z${runId}`

  return {
    runId,
    payload: {
      ...run,
      id: runId,
      trace_id: traceId,
      start_time: startTime,
      dotted_order: dottedOrder,
    },
  }
}
