import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { isLargeArrayManifest } from '@/lib/execution/payloads/large-array-manifest-metadata'
import { isLargeValueRef } from '@/lib/execution/payloads/large-value-ref'
import { maskPIIBatchViaHttp } from '@/lib/guardrails/mask-client'
import type { CustomPiiPattern } from '@/lib/guardrails/pii-entities'

const logger = createLogger('PiiRedaction')

/** Replaces text we could not safely mask, so PII is never persisted on failure. */
export const REDACTION_FAILED_MARKER = '[REDACTION_FAILED]'

/** Replaces an encoded file body in the execution log (see {@link isEncodedBinary}). */
export const BINARY_CONTENT_REDACTED_MARKER = '[BINARY_CONTENT_REDACTED]'

/**
 * Shortest bare base64 string treated as an encoded file body. Far longer than any
 * word, identifier, hash, or token, so only encoded payloads reach it.
 */
const MIN_ENCODED_BINARY_CHARS = 1024

const STANDARD_BASE64 = /^[A-Za-z0-9+/]+={0,2}$/
const URL_SAFE_BASE64 = /^[A-Za-z0-9_-]+={0,2}$/
/** A `data:` URL's header through its comma, declaring base64 (RFC 2397). */
const BASE64_DATA_URL_HEADER = /^data:(?:[\w.+-]+\/[\w.+-]+)?(?:;[\w.+-]+=[^;,]*)*;base64,$/i

/** Narrowest and widest lines encoders wrap base64 at: 60 (common), 64 (PEM), 76 (MIME). */
const MIN_WRAP_WIDTH = 60
const MAX_WRAP_WIDTH = 76

function isBase64(value: string): boolean {
  return STANDARD_BASE64.test(value) || URL_SAFE_BASE64.test(value)
}

/**
 * The base64 in `value` with trailing whitespace dropped and, when it is wrapped
 * the way encoders wrap it (every line but the last a fixed width, a multiple of 4
 * between {@link MIN_WRAP_WIDTH} and {@link MAX_WRAP_WIDTH}), its line breaks
 * removed. Returns `null` when `value` is not base64.
 */
function base64Body(value: string): string | null {
  const body = value.trimEnd()
  const firstBreak = body.indexOf('\n')
  if (firstBreak === -1) return isBase64(body) ? body : null
  const width = body[firstBreak - 1] === '\r' ? firstBreak - 1 : firstBreak
  if (width < MIN_WRAP_WIDTH || width > MAX_WRAP_WIDTH || width % 4 !== 0) return null
  if (!isBase64(body.slice(0, width))) return null
  const lines = body.split(/\r?\n/)
  const last = lines[lines.length - 1]
  const fixedWidth = lines.every((line, i) => i === lines.length - 1 || line.length === width)
  if (!fixedWidth || last.length === 0 || last.length > width) return null
  const joined = lines.join('')
  return isBase64(joined) ? joined : null
}

/**
 * Whether `value` is an encoded file body: a `data:` URL declaring base64, or a
 * bare base64 string at least {@link MIN_ENCODED_BINARY_CHARS} long, either one
 * optionally wrapped the way encoders wrap it (see {@link base64Body}). Text
 * masking cannot check such a value for PII, which lives inside the decoded file.
 */
function isEncodedBinary(value: string): boolean {
  if (value.startsWith('data:')) {
    const comma = value.indexOf(',')
    return (
      comma !== -1 &&
      BASE64_DATA_URL_HEADER.test(value.slice(0, comma + 1)) &&
      base64Body(value.slice(comma + 1)) !== null
    )
  }
  if (value.length < MIN_ENCODED_BINARY_CHARS) return false
  const body = base64Body(value)
  return body !== null && body.length >= MIN_ENCODED_BINARY_CHARS
}

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
  /**
   * Replace encoded file bodies (see {@link isEncodedBinary}) with
   * {@link BINARY_CONTENT_REDACTED_MARKER} instead of masking them as text. Only
   * for the execution log: masking cannot see PII inside a file, so the log drops
   * the file rather than keep content it never checked. Replacing can only remove
   * content, so a string misread as a file costs log detail, never PII. Live data
   * leaves this off, keeping every string on the masking path so none can skip
   * redaction by its shape, and keeping file bytes the next block reads.
   */
  replaceEncodedBinary?: boolean
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
 * and, when set, `encodedBinary` for an encoded file body it never sees (see
 * {@link isEncodedBinary}). Without `encodedBinary` every string is text.
 */
interface StringVisitor {
  text: (s: string) => string
  encodedBinary?: (s: string) => string
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
    return visit.encodedBinary && isEncodedBinary(value)
      ? visit.encodedBinary(value)
      : visit.text(value)
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

/** What a collection pass found: the strings to mask and how many encoded file bodies. */
interface CollectedStrings {
  collected: string[]
  encodedBinaryCount: number
}

function collectStrings(
  walk: (visit: StringVisitor) => void,
  replaceEncodedBinary: boolean
): CollectedStrings {
  const collected: string[] = []
  let encodedBinaryCount = 0
  walk({
    text: (s) => {
      collected.push(s)
      return s
    },
    encodedBinary: replaceEncodedBinary
      ? (s) => {
          encodedBinaryCount++
          return s
        }
      : undefined,
  })
  return { collected, encodedBinaryCount }
}

/** Mask the collected strings and return the substitution pass's visitor. */
async function substitutionVisitor(
  collected: string[],
  options: PiiRedactionOptions,
  replaceEncodedBinary: boolean
): Promise<{ visit: StringVisitor; scrubbedCount: number }> {
  const { masked, scrubbedCount } = await maskCollected(collected, options)
  let index = 0
  return {
    visit: {
      text: () => masked[index++],
      encodedBinary: replaceEncodedBinary ? () => BINARY_CONTENT_REDACTED_MARKER : undefined,
    },
    scrubbedCount,
  }
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
  const replaceEncodedBinary = options.replaceEncodedBinary ?? false
  const found = collectStrings((visit) => transformStrings(value, visit), replaceEncodedBinary)
  if (found.collected.length === 0 && found.encodedBinaryCount === 0) return value

  const { visit } = await substitutionVisitor(found.collected, options, replaceEncodedBinary)
  return transformStrings(value, visit) as T
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
 * the failure path. This payload is the execution log, so encoded file bodies are
 * always replaced with {@link BINARY_CONTENT_REDACTED_MARKER} (see
 * {@link PiiRedactionOptions.replaceEncodedBinary}).
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

  const found = collectStrings((visit) => {
    for (const unit of units) transformUnit(unit.key, unit.value, visit)
  }, true)
  if (found.collected.length === 0 && found.encodedBinaryCount === 0) return payload

  const { visit, scrubbedCount } = await substitutionVisitor(found.collected, options, true)
  const result: RedactablePayload = { ...payload }
  for (const unit of units) {
    result[unit.key] = transformUnit(unit.key, unit.value, visit)
  }

  logger.info('PII redaction completed', {
    stringCount: found.collected.length,
    totalBytes: found.collected.reduce((sum, s) => sum + Buffer.byteLength(s, 'utf8'), 0),
    encodedBinaryCount: found.encodedBinaryCount,
    durationMs: Math.round(performance.now() - startedAt),
    scrubbedCount,
  })
  return result
}
