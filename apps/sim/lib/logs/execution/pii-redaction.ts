import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { isLargeArrayManifest } from '@/lib/execution/payloads/large-array-manifest-metadata'
import { isLargeValueRef } from '@/lib/execution/payloads/large-value-ref'
import { maskPIIBatchViaHttp } from '@/lib/guardrails/mask-client'
import type { CustomPiiPattern } from '@/lib/guardrails/pii-entities'

const logger = createLogger('PiiRedaction')

/** Replaces text we could not safely mask, so PII is never persisted on failure. */
export const REDACTION_FAILED_MARKER = '[REDACTION_FAILED]'

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
  /** User-supplied custom regex patterns applied alongside `entityTypes`. */
  customPatterns?: CustomPiiPattern[]
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
  // Treat offloaded large-value refs as opaque: masking their internal `key`/`id`
  // strings would corrupt the reference. Their content is handled separately
  // (hydrate → mask → re-store) before this runs.
  if (isLargeValueRef(value) || isLargeArrayManifest(value)) {
    return value
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
 * Mask a batch of collected strings via Presidio. On a hard failure, either scrub
 * to {@link REDACTION_FAILED_MARKER} or throw {@link PiiRedactionError}, per
 * `options.onFailure`. Returns masked values aligned 1:1 with `collected`.
 *
 * There is no total-size ceiling — the batching layer chunks the request and
 * fans out with bounded concurrency, so payloads of any size are masked properly
 * rather than scrubbed. Transient chunk failures retry with backoff inside the
 * mask client; a failure surfacing here means the retry budget is exhausted or
 * the failure is deterministic.
 */
async function maskCollected(
  collected: string[],
  options: PiiRedactionOptions
): Promise<{ masked: string[]; scrubbed: boolean }> {
  const onFailure = options.onFailure ?? 'scrub'
  const language = options.language ?? 'en'

  try {
    // Presidio runs only in the app container; the persist + execution paths also
    // run in the trigger.dev runtime, so masking always goes over HTTP to the app.
    const masked = await maskPIIBatchViaHttp(
      collected,
      options.entityTypes,
      language,
      options.customPatterns
    )
    return { masked, scrubbed: false }
  } catch (error) {
    logger.error('PII masking failed', {
      error: getErrorMessage(error),
      stringCount: collected.length,
      onFailure,
    })
    if (onFailure === 'throw') {
      throw new PiiRedactionError(`PII redaction failed: ${getErrorMessage(error)}`)
    }
    return { masked: collected.map(() => REDACTION_FAILED_MARKER), scrubbed: true }
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
  transformStrings(value, (s) => {
    collected.push(s)
    return s
  })

  if (collected.length === 0) return value

  const { masked } = await maskCollected(collected, options)
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

  const { masked, scrubbed } = await maskCollected(collected, options)

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
