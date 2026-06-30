import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { isLargeArrayManifest } from '@/lib/execution/payloads/large-array-manifest-metadata'
import { isLargeValueRef } from '@/lib/execution/payloads/large-value-ref'
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

/**
 * How to handle a masking failure (Presidio error or over-ceiling payload):
 * - `'scrub'` (default): replace eligible strings with {@link REDACTION_FAILED_MARKER}.
 *   Safe for the log stage — execution already succeeded.
 * - `'throw'`: throw {@link PiiRedactionError}. Used for the execution-altering
 *   stages (input/block outputs) where a marker would corrupt computed data and
 *   fail-open would leak — so the run aborts instead.
 */
export type PiiRedactionFailureMode = 'scrub' | 'throw'

export interface PiiRedactionOptions {
  /** Presidio entity types to mask. Empty = redact all detected PII. */
  entityTypes: string[]
  language?: string
  /** Failure handling. Defaults to `'scrub'`. */
  onFailure?: PiiRedactionFailureMode
}

/** Thrown when in-flight redaction (`onFailure: 'throw'`) cannot mask safely. */
export class PiiRedactionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PiiRedactionError'
  }
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

/** Replace every offloaded large-value ref / array manifest with `handle()`. */
function transformRefs(value: unknown, handle: () => unknown): unknown {
  if (isLargeValueRef(value) || isLargeArrayManifest(value)) {
    return handle()
  }
  if (Array.isArray(value)) {
    return value.map((item) => transformRefs(item, handle))
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, v] of Object.entries(value)) {
      out[key] = transformRefs(v, handle)
    }
    return out
  }
  return value
}

/**
 * Replace offloaded large-value references with {@link REDACTION_FAILED_MARKER}.
 *
 * The string redactor only masks inline content; a value already offloaded to
 * large-value storage (>8MB) is an opaque ref it can't reach. Block outputs are
 * masked BEFORE offload only when the block-output stage is on — so when that
 * stage is off, the refs in a persisted log point to unredacted bytes. Scrubbing
 * them keeps raw PII out of the log (the rare huge field loses its content rather
 * than leaking; consistent with the over-ceiling scrub behavior).
 */
export function scrubLargeValueRefs(payload: RedactablePayload): RedactablePayload {
  const result: RedactablePayload = { ...payload }
  for (const key of REDACTABLE_KEYS) {
    if (payload[key] !== undefined) {
      result[key] = transformRefs(payload[key], () => REDACTION_FAILED_MARKER)
    }
  }
  return result
}

/**
 * Mask a batch of collected strings via Presidio. On a hard failure or when the
 * batch exceeds the ceiling, either scrub to {@link REDACTION_FAILED_MARKER} or
 * throw {@link PiiRedactionError}, per `options.onFailure`. Returns masked values
 * aligned 1:1 with `collected`.
 */
async function maskCollected(
  collected: string[],
  totalBytes: number,
  options: PiiRedactionOptions
): Promise<{ masked: string[]; scrubbed: boolean }> {
  const onFailure = options.onFailure ?? 'scrub'
  const language = options.language ?? 'en'

  const fail = (reason: string): { masked: string[]; scrubbed: boolean } => {
    if (onFailure === 'throw') throw new PiiRedactionError(reason)
    return { masked: collected.map(() => REDACTION_FAILED_MARKER), scrubbed: true }
  }

  if (totalBytes > PII_MAX_TOTAL_BYTES) {
    logger.warn('Payload exceeds PII redaction ceiling', {
      totalBytes,
      ceiling: PII_MAX_TOTAL_BYTES,
      onFailure,
    })
    return fail(
      `PII redaction skipped: payload ${totalBytes}B exceeds ${PII_MAX_TOTAL_BYTES}B ceiling`
    )
  }

  try {
    // Presidio runs only in the app container; the persist + execution paths also
    // run in the trigger.dev runtime, so masking always goes over HTTP to the app.
    const masked = await maskPIIBatchViaHttp(collected, options.entityTypes, language)
    return { masked, scrubbed: false }
  } catch (error) {
    logger.error('PII masking failed', {
      error: getErrorMessage(error),
      stringCount: collected.length,
      onFailure,
    })
    return fail(`PII redaction failed: ${getErrorMessage(error)}`)
  }
}

/**
 * Mask every eligible string leaf of an arbitrary object in place-preserving
 * fashion: collect all leaves in one deterministic pass, mask in a single batched
 * Presidio call, then rebuild from the masked slice (the identical traversal
 * order makes the two passes line up). Used for the execution-altering input and
 * block-output stages, so it defaults callers toward `onFailure: 'throw'`.
 */
export async function redactObjectStrings<T>(value: T, options: PiiRedactionOptions): Promise<T> {
  const collected: string[] = []
  let totalBytes = 0
  transformStrings(value, (s) => {
    collected.push(s)
    totalBytes += Buffer.byteLength(s, 'utf8')
    return s
  })

  if (collected.length === 0) return value

  const { masked } = await maskCollected(collected, totalBytes, options)
  let index = 0
  return transformStrings(value, () => masked[index++]) as T
}

/**
 * Mask PII across an execution's `traceSpans` / `finalOutput` / `workflowInput`.
 *
 * All eligible string leaves are collected in one deterministic pass and masked
 * in a single batched (byte-chunked) Presidio call — so subprocess count scales
 * with payload size, not block count. Each unit is then rebuilt independently
 * from the masked slice, preserving the JSON structure (Presidio never sees the
 * envelope). On a hard masking failure or when the payload exceeds the ceiling,
 * eligible strings are replaced with {@link REDACTION_FAILED_MARKER} (the default
 * `onFailure: 'scrub'`) rather than left unredacted — PII is never persisted on
 * the failure path.
 */
export async function redactPIIFromExecution(
  payload: RedactablePayload,
  options: PiiRedactionOptions
): Promise<RedactablePayload> {
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

  const { masked, scrubbed } = await maskCollected(collected, totalBytes, options)

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
