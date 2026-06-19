import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { maskPIIBatch } from '@/lib/guardrails/validate_pii'

const logger = createLogger('PiiRedaction')

/** Replaces text we could not safely mask, so PII is never persisted on failure. */
export const REDACTION_FAILED_MARKER = '[REDACTION_FAILED]'

/**
 * Strings larger than this are skipped (left as-is). They are almost always
 * base64 blobs / embedded JSON rather than PII prose, and would dominate NER time.
 */
const PII_MAX_STRING_BYTES = 128 * 1024

/**
 * Upper bound on total text masked for one execution. Beyond this we scrub rather
 * than spend minutes in NER. Typical inline logs (≤3MB) stay well under.
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
}

/** Trace-span fields that carry runtime content (and therefore possible PII). */
const SPAN_CONTENT_FIELDS = ['input', 'output', 'thinking', 'modelToolCalls'] as const

function isEligibleString(value: string): boolean {
  return value.length > 0 && Buffer.byteLength(value, 'utf8') <= PII_MAX_STRING_BYTES
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

  const units: { key: keyof RedactablePayload; value: unknown }[] = []
  if (payload.traceSpans !== undefined) units.push({ key: 'traceSpans', value: payload.traceSpans })
  if (payload.finalOutput !== undefined)
    units.push({ key: 'finalOutput', value: payload.finalOutput })
  if (payload.workflowInput !== undefined)
    units.push({ key: 'workflowInput', value: payload.workflowInput })

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
  if (totalBytes > PII_MAX_TOTAL_BYTES) {
    logger.warn('Execution exceeds PII redaction ceiling; scrubbing text', {
      totalBytes,
      ceiling: PII_MAX_TOTAL_BYTES,
    })
    masked = collected.map(() => REDACTION_FAILED_MARKER)
  } else {
    try {
      masked = await maskPIIBatch(collected, entityTypes, language)
    } catch (error) {
      logger.error('PII masking failed; scrubbing text to avoid leaking PII', {
        error: getErrorMessage(error),
        stringCount: collected.length,
      })
      masked = collected.map(() => REDACTION_FAILED_MARKER)
    }
  }

  let index = 0
  const result: RedactablePayload = { ...payload }
  for (const unit of units) {
    result[unit.key] = transformUnit(unit.key, unit.value, () => masked[index++])
  }
  return result
}
