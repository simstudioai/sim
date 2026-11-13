import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { isLargeArrayManifest } from '@/lib/execution/payloads/large-array-manifest-metadata'
import { isLargeValueRef } from '@/lib/execution/payloads/large-value-ref'
import { maskPIIBatchViaHttp } from '@/lib/guardrails/mask-client'
import type { CustomPiiPattern } from '@/lib/guardrails/pii-entities'

const logger = createLogger('PiiRedaction')

/** Replaces text we could not safely mask, so PII is never persisted on failure. */
export const REDACTION_FAILED_MARKER = '[REDACTION_FAILED]'

/** Replaces an encoded file body in a persisted record (see {@link isEncodedBinary}). */
export const BINARY_CONTENT_REDACTED_MARKER = '[BINARY_CONTENT_REDACTED]'

/**
 * Shortest bare base64 string treated as an encoded file body. Far longer than any
 * word, identifier, hash, or token, so only encoded payloads reach it.
 */
const MIN_ENCODED_BINARY_CHARS = 1024

const STANDARD_BASE64 = /^[A-Za-z0-9+/]+={0,2}$/
const URL_SAFE_BASE64 = /^[A-Za-z0-9_-]+={0,2}$/
const BASE64_DATA_URL = /^data:(?:[\w.+-]+\/[\w.+-]+)?(?:;[\w.+-]+=[^;,]*)*;base64,/i

/** Narrowest and widest lines encoders wrap base64 at: 60 (common), 64 (PEM), 76 (MIME). */
const MIN_WRAP_WIDTH = 60
const MAX_WRAP_WIDTH = 76

function isBase64(value: string): boolean {
  return STANDARD_BASE64.test(value) || URL_SAFE_BASE64.test(value)
}

/**
 * `value` with trailing whitespace dropped and, when it is wrapped the way base64
 * encoders wrap (every line but the last one fixed width, a multiple of 4 between
 * {@link MIN_WRAP_WIDTH} and {@link MAX_WRAP_WIDTH}), its line breaks removed.
 * Returns `null` for multi-line text without that shape, which is never base64.
 */
function unwrapBase64(value: string): string | null {
  const body = value.trimEnd()
  const firstBreak = body.indexOf('\n')
  if (firstBreak === -1) return body
  const width = body[firstBreak - 1] === '\r' ? firstBreak - 1 : firstBreak
  if (width < MIN_WRAP_WIDTH || width > MAX_WRAP_WIDTH || width % 4 !== 0) return null
  const lines = body.split(/\r?\n/)
  const last = lines[lines.length - 1]
  const fixedWidth = lines.slice(0, -1).every((line) => line.length === width)
  return fixedWidth && last.length > 0 && last.length <= width ? lines.join('') : null
}

/**
 * Whether `value` is an encoded file body: a `data:` URL declaring base64, or a
 * bare base64 string at least {@link MIN_ENCODED_BINARY_CHARS} long, either one
 * optionally wrapped the way encoders wrap it (see {@link unwrapBase64}). A bare
 * string must also mix upper case, lower case, and digits, as encoded bytes always
 * do, so a run of digits, lowercase hex, or a list of codes is still masked as text.
 *
 * Presidio cannot redact such a value: spaCy reads base64 as one token, and the
 * pattern recognizers only ever match it by coincidence at a `+` or `/`, where a
 * replacement would corrupt the bytes rather than remove anything readable. Any
 * PII is inside the decoded file, which text masking never sees.
 */
function isEncodedBinary(value: string): boolean {
  if (value.startsWith('data:')) {
    const prefix = BASE64_DATA_URL.exec(value.slice(0, 512))
    if (prefix === null) return false
    const payload = unwrapBase64(value.slice(prefix[0].length))
    return payload !== null && isBase64(payload)
  }
  if (value.length < MIN_ENCODED_BINARY_CHARS) return false
  const body = unwrapBase64(value)
  return (
    body !== null &&
    body.length >= MIN_ENCODED_BINARY_CHARS &&
    isBase64(body) &&
    /[A-Z]/.test(body) &&
    /[a-z]/.test(body) &&
    /\d/.test(body)
  )
}

/**
 * Whether a redaction pass is producing the execution record or data a later step
 * reads, which decides both how a masking failure is handled and what becomes of
 * an encoded file body Presidio cannot mask:
 * - `'scrub'` (default), the execution log: a failure replaces the affected strings
 *   with {@link REDACTION_FAILED_MARKER}, and an encoded file body is replaced with
 *   {@link BINARY_CONTENT_REDACTED_MARKER}, since the log must not keep content
 *   that cannot be checked for PII. Safe because execution already succeeded.
 * - `'throw'`, data a later step reads: workflow input, block outputs, and agent
 *   memory stored for later turns. A failure throws {@link PiiRedactionError} and
 *   aborts the run, since a marker would corrupt that data and fail-open would
 *   leak. An encoded file body passes through unchanged, since the step that
 *   reads it needs its bytes and masking could only corrupt them.
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
 * What one pass does with each string leaf: `text` for a string Presidio masks,
 * `encodedBinary` for an encoded file body it never sees (see {@link isEncodedBinary}).
 */
interface StringVisitor {
  text: (s: string) => string
  encodedBinary: (s: string) => string
}

/**
 * Rebuild `value` replacing every eligible string leaf with the visitor's result.
 * Used for both collection (the visitor records and returns the input) and
 * substitution (it returns the masked value), so traversal order, eligibility, and
 * the text/binary split are guaranteed identical across the two passes.
 */
function transformStrings(value: unknown, visit: StringVisitor): unknown {
  if (typeof value === 'string') {
    if (!isEligibleString(value)) return value
    return isEncodedBinary(value) ? visit.encodedBinary(value) : visit.text(value)
  }
  // Treat offloaded large-value refs as opaque: masking their internal `key`/`id`
  // strings would corrupt the reference. Their content is handled separately
  // (hydrate → mask → re-store) before this runs.
  if (isLargeValueRef(value) || isLargeArrayManifest(value)) {
    return value
  }
  if (Array.isArray(value)) {
    return value.map((item) => transformStrings(item, visit))
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, v] of Object.entries(value)) {
      out[key] = transformStrings(v, visit)
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
function transformSpan(span: unknown, visit: StringVisitor): unknown {
  if (span === null || typeof span !== 'object' || Array.isArray(span)) {
    return transformStrings(span, visit)
  }
  const source = span as Record<string, unknown>
  const out: Record<string, unknown> = { ...source }
  for (const field of SPAN_CONTENT_FIELDS) {
    if (field in out) out[field] = transformStrings(out[field], visit)
  }
  if (Array.isArray(source.children)) {
    out.children = source.children.map((child) => transformSpan(child, visit))
  }
  return out
}

function transformUnit(
  key: keyof RedactablePayload,
  value: unknown,
  visit: StringVisitor
): unknown {
  if (key === 'traceSpans' && Array.isArray(value)) {
    return value.map((span) => transformSpan(span, visit))
  }
  return transformStrings(value, visit)
}

/** What an encoded file body becomes under `onFailure` (see {@link PiiRedactionFailureMode}). */
function encodedBinaryReplacement(onFailure: PiiRedactionFailureMode): (s: string) => string {
  return onFailure === 'scrub' ? () => BINARY_CONTENT_REDACTED_MARKER : (s) => s
}

/** A collection pass: records every string to mask and counts encoded file bodies. */
function collectStrings() {
  const collected: string[] = []
  let encodedBinaryCount = 0
  const visit: StringVisitor = {
    text: (s) => {
      collected.push(s)
      return s
    },
    encodedBinary: (s) => {
      encodedBinaryCount++
      return s
    },
  }
  return { collected, visit, encodedBinaryCount: () => encodedBinaryCount }
}

/**
 * Mask a batch of collected strings via Presidio. On a hard failure, either scrub
 * to {@link REDACTION_FAILED_MARKER} or throw {@link PiiRedactionError}, per
 * `options.onFailure`. Returns masked values aligned 1:1 with `collected`.
 *
 * In `'scrub'` mode the marker replaces only the strings of the request chunks
 * that failed, so one unmaskable chunk does not erase the rest of the payload;
 * a failed string is still never kept.
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
): Promise<{ masked: string[]; scrubbedCount: number }> {
  const onFailure = options.onFailure ?? 'scrub'
  const language = options.language ?? 'en'

  try {
    // Presidio runs only in the app container; the persist + execution paths also
    // run in the trigger.dev runtime, so masking always goes over HTTP to the app.
    return await maskPIIBatchViaHttp(
      collected,
      options.entityTypes,
      language,
      options.customPatterns,
      onFailure === 'scrub' ? { failedChunkPlaceholder: REDACTION_FAILED_MARKER } : {}
    )
  } catch (error) {
    logger.error('PII masking failed', {
      error: getErrorMessage(error),
      stringCount: collected.length,
      onFailure,
    })
    if (onFailure === 'throw') {
      throw new PiiRedactionError(`PII redaction failed: ${getErrorMessage(error)}`)
    }
    return {
      masked: collected.map(() => REDACTION_FAILED_MARKER),
      scrubbedCount: collected.length,
    }
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
  const collection = collectStrings()
  transformStrings(value, collection.visit)
  const { collected } = collection

  if (collected.length === 0 && collection.encodedBinaryCount() === 0) return value

  const { masked } =
    collected.length === 0 ? { masked: [] } : await maskCollected(collected, options)
  let index = 0
  return transformStrings(value, {
    text: () => masked[index++],
    encodedBinary: encodedBinaryReplacement(options.onFailure ?? 'scrub'),
  }) as T
}

/**
 * Mask PII across an execution's `traceSpans` / `finalOutput` / `workflowInput`.
 *
 * All eligible string leaves are collected in one deterministic pass and masked
 * in a single batched (byte-chunked) Presidio call — so subprocess count scales
 * with payload size, not block count. Each unit is then rebuilt independently
 * from the masked slice, preserving the JSON structure (Presidio never sees the
 * envelope). On a hard masking failure, the eligible strings of every request
 * chunk that failed are replaced with {@link REDACTION_FAILED_MARKER} (the default
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

  const collection = collectStrings()
  for (const unit of units) transformUnit(unit.key, unit.value, collection.visit)
  const { collected } = collection
  const encodedBinaryCount = collection.encodedBinaryCount()

  if (collected.length === 0 && encodedBinaryCount === 0) return payload

  const { masked, scrubbedCount } =
    collected.length === 0
      ? { masked: [], scrubbedCount: 0 }
      : await maskCollected(collected, options)

  let index = 0
  const visit: StringVisitor = {
    text: () => masked[index++],
    encodedBinary: encodedBinaryReplacement(options.onFailure ?? 'scrub'),
  }
  const result: RedactablePayload = { ...payload }
  for (const unit of units) {
    result[unit.key] = transformUnit(unit.key, unit.value, visit)
  }

  logger.info('PII redaction completed', {
    stringCount: collected.length,
    totalBytes: collected.reduce((sum, s) => sum + Buffer.byteLength(s, 'utf8'), 0),
    encodedBinaryCount,
    durationMs: Math.round(performance.now() - startedAt),
    scrubbedCount,
  })
  return result
}
