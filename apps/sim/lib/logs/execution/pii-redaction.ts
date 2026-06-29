import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { maskPIIBatchViaHttp } from '@/lib/guardrails/mask-client'

const logger = createLogger('PiiRedaction')

/** Replaces text we could not safely mask, so PII is never persisted on failure. */
export const REDACTION_FAILED_MARKER = '[REDACTION_FAILED]'

/**
 * Upper bound on total text masked for one execution. Beyond this we scrub the
 * whole payload rather than spend minutes in NER (never leave it unmasked).
 * Typical inline logs (≤3MB) stay well under. Individual strings are never
 * skipped by size — they would otherwise persist unredacted.
 */
const PII_MAX_TOTAL_BYTES = 16 * 1024 * 1024

export interface PiiRedactionOptions {
  /** Presidio entity types to mask. Empty = redact all detected PII. */
  entityTypes: string[]
  language?: string
}

export interface RedactablePayload {
  traceSpans?: unknown
  finalOutput?: unknown
  workflowInput?: unknown
  error?: unknown
  completionFailure?: unknown
  trigger?: unknown
  executionState?: unknown
  environment?: unknown
  correlation?: unknown
}

/** Keys of {@link RedactablePayload} processed by the redactor, in order. */
const REDACTABLE_KEYS: (keyof RedactablePayload)[] = [
  'traceSpans',
  'finalOutput',
  'workflowInput',
  'error',
  'completionFailure',
  'trigger',
  'executionState',
  'environment',
  'correlation',
]

/** Trace-span fields that carry runtime content (and therefore possible PII). */
const SPAN_CONTENT_FIELDS = [
  'input',
  'output',
  'thinking',
  'modelToolCalls',
  'toolCalls',
  'error',
  'errorMessage',
] as const

function isEligibleString(value: string): boolean {
  return value.length > 0
}

/**
 * Rebuild `value` replacing every eligible string leaf with `handle(leaf)`.
 * Used for both collection (handle records and returns the input) and
 * substitution (handle returns the masked value), so traversal order and
 * eligibility are guaranteed identical across the two passes.
 */
function transformStrings(value: unknown, handle: (s: string) => string): unknown {
  if (typeof value === 'string') {
    return isEligibleString(value) ? handle(value) : value
  }
  if (Array.isArray(value)) {
    return value.map((item) => transformStrings(item, handle))
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, v] of Object.entries(value)) {
      out[key] = transformStrings(v, handle)
    }
    return out
  }
  return value
}

/**
 * Redact a trace span: only its content fields ({@link SPAN_CONTENT_FIELDS}) and
 * nested `children` are walked, leaving structural metadata (blockId, name,
 * status, timing) untouched so log correlation/display is preserved.
 */
function transformSpan(span: unknown, handle: (s: string) => string): unknown {
  if (span === null || typeof span !== 'object' || Array.isArray(span)) {
    return transformStrings(span, handle)
  }
  const source = span as Record<string, unknown>
  const out: Record<string, unknown> = { ...source }
  for (const field of SPAN_CONTENT_FIELDS) {
    if (field in out) out[field] = transformStrings(out[field], handle)
  }
  if (Array.isArray(source.children)) {
    out.children = source.children.map((child) => transformSpan(child, handle))
  }
  return out
}

function transformUnit(
  key: keyof RedactablePayload,
  value: unknown,
  handle: (s: string) => string
): unknown {
  if (key === 'traceSpans' && Array.isArray(value)) {
    return value.map((span) => transformSpan(span, handle))
  }
  return transformStrings(value, handle)
}

/**
 * Mask PII across an execution's `traceSpans` / `finalOutput` / `workflowInput`.
 *
 * All eligible string leaves are collected in one deterministic pass and masked
 * in a single batched (byte-chunked) Presidio call — so subprocess count scales
 * with payload size, not block count. Each unit is then rebuilt independently
 * from the masked slice, preserving the JSON structure (Presidio never sees the
 * envelope). On a hard masking failure or when the payload exceeds the ceiling,
 * eligible strings are replaced with {@link REDACTION_FAILED_MARKER} rather than
 * left unredacted — PII is never persisted on the failure path.
 */
export async function redactPIIFromExecution(
  payload: RedactablePayload,
  options: PiiRedactionOptions
): Promise<RedactablePayload> {
  const { entityTypes } = options
  const language = options.language ?? 'en'
  const startedAt = performance.now()

  const units = REDACTABLE_KEYS.filter((key) => payload[key] !== undefined).map((key) => ({
    key,
    value: payload[key],
  }))

  const collected: string[] = []
  let totalBytes = 0
  for (const unit of units) {
    transformUnit(unit.key, unit.value, (s) => {
      collected.push(s)
      totalBytes += Buffer.byteLength(s, 'utf8')
      return s
    })
  }

  if (collected.length === 0) return payload

  let masked: string[]
  let scrubbed = false
  if (totalBytes > PII_MAX_TOTAL_BYTES) {
    logger.warn('Execution exceeds PII redaction ceiling; scrubbing text', {
      totalBytes,
      ceiling: PII_MAX_TOTAL_BYTES,
    })
    masked = collected.map(() => REDACTION_FAILED_MARKER)
    scrubbed = true
  } else {
    try {
      // Presidio runs only in the app container; the persist path also runs in
      // the trigger.dev runtime, so masking always goes over HTTP to the app.
      masked = await maskPIIBatchViaHttp(collected, entityTypes, language)
    } catch (error) {
      logger.error('PII masking failed; scrubbing text to avoid leaking PII', {
        error: getErrorMessage(error),
        stringCount: collected.length,
      })
      masked = collected.map(() => REDACTION_FAILED_MARKER)
      scrubbed = true
    }
  }

  let index = 0
  const result: RedactablePayload = { ...payload }
  for (const unit of units) {
    result[unit.key] = transformUnit(unit.key, unit.value, () => masked[index++])
  }

  logger.info('PII redaction completed', {
    stringCount: collected.length,
    totalBytes,
    durationMs: Math.round(performance.now() - startedAt),
    scrubbed,
  })
  return result
}
