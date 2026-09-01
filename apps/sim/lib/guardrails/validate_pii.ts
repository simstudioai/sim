import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { truncate } from '@sim/utils/string'
import { env } from '@/lib/core/config/env'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import {
  DEFAULT_MAX_ERROR_BODY_BYTES,
  readResponseJsonWithLimit,
  readResponseTextWithLimit,
} from '@/lib/core/utils/stream-limits'
import { chunkIndicesByBudget } from '@/lib/guardrails/pii-batching'
import type { CustomPiiPattern } from '@/lib/guardrails/pii-entities'
import {
  MAX_PII_VALIDATION_DETECTED_ENTITIES,
  MAX_PII_VALIDATION_RESPONSE_BYTES,
  MAX_PII_VALIDATION_TEXT_CHARACTERS,
} from '@/lib/guardrails/pii-limits'
import { isAbortError } from '@/providers/streaming-tool-loop-shared'

const logger = createLogger('PIIValidator')

/**
 * Entity list for the batch (data-retention) paths, where an empty selection with
 * custom patterns means "redact ONLY these custom patterns" (the user unchecked
 * every built-in entity). An explicit empty array is sent so the server detects
 * only the custom entities, never "all". With neither, `undefined` preserves the
 * legacy "detect all" default.
 *
 * The guardrails single-text path uses the opposite convention — empty selection
 * means "detect all" — so it does NOT use this helper (see {@link analyze}).
 */
function resolveBatchEntities(
  entityTypes: string[],
  patterns?: CustomPiiPattern[]
): string[] | undefined {
  if (entityTypes.length > 0) return entityTypes
  if ((patterns?.length ?? 0) > 0) return []
  return undefined
}

/** Map a detected entity type back to its user-facing custom-pattern name, if it is one. */
function displayEntityType(type: string, patterns?: CustomPiiPattern[]): string {
  const match = /^CUSTOM_(\d+)$/.exec(type)
  if (!match) return type
  const pattern = patterns?.[Number(match[1])]
  return pattern?.name || type
}

/**
 * Concurrent chunk requests in flight from a single mask-batch call. Each chunk is
 * itself a batched service call (spaCy `nlp.pipe` over many strings). Default 4;
 * raise via `PII_SERVICE_CHUNK_CONCURRENCY` for a scaled Presidio fleet (this is
 * the route → Presidio fan-out, inner to the app → route `PII_MASK_CHUNK_CONCURRENCY`).
 */
const CHUNK_CONCURRENCY = env.PII_SERVICE_CHUNK_CONCURRENCY ?? 4

/** Presidio service serving /analyze, /anonymize, and combined /redact (VIN is native there). */
const PII_URL = env.PII_URL || 'http://localhost:5001'

export interface PIIValidationInput {
  text: string
  entityTypes: string[] // e.g., ["PERSON", "EMAIL_ADDRESS", "CREDIT_CARD"]
  mode: 'block' | 'mask' // block = fail if PII found, mask = return masked text
  language?: string // default: "en"
  /** User-supplied custom regex patterns applied alongside `entityTypes`. */
  customPatterns?: CustomPiiPattern[]
  requestId: string
  abortSignal?: AbortSignal
}

interface DetectedPIIEntity {
  type: string
  start: number
  end: number
  score: number
  text: string
}

export interface PIIValidationResult {
  passed: boolean
  error?: string
  detectedEntities: DetectedPIIEntity[]
  maskedText?: string
}

interface AnalyzerSpan {
  entity_type: string
  start: number
  end: number
  score: number
}

function parseAnalyzerSpans(value: unknown, textLength: number): AnalyzerSpan[] {
  if (!Array.isArray(value)) throw new Error('PII analyzer returned an invalid result')
  if (value.length > MAX_PII_VALIDATION_DETECTED_ENTITIES) {
    throw new Error(
      `PII analyzer returned more than ${MAX_PII_VALIDATION_DETECTED_ENTITIES} detected entities`
    )
  }

  return value.map((span, index) => {
    if (!span || typeof span !== 'object' || Array.isArray(span)) {
      throw new Error(`PII analyzer returned an invalid entity at index ${index}`)
    }
    const record = span as Record<string, unknown>
    if (
      typeof record.entity_type !== 'string' ||
      !record.entity_type ||
      record.entity_type.length > 100 ||
      typeof record.start !== 'number' ||
      typeof record.end !== 'number' ||
      !Number.isInteger(record.start) ||
      !Number.isInteger(record.end) ||
      record.start < 0 ||
      record.end < record.start ||
      record.end > textLength ||
      typeof record.score !== 'number' ||
      record.score < 0 ||
      record.score > 1
    ) {
      throw new Error(`PII analyzer returned an invalid entity at index ${index}`)
    }
    return {
      entity_type: record.entity_type,
      start: record.start,
      end: record.end,
      score: record.score,
    }
  })
}

function assertDetectedEntityBudget(
  text: string,
  spans: AnalyzerSpan[],
  patterns?: CustomPiiPattern[]
): void {
  let estimatedBytes = 2
  for (const span of spans) {
    const type = displayEntityType(span.entity_type, patterns)
    estimatedBytes +=
      128 +
      Buffer.byteLength(type, 'utf8') +
      Buffer.byteLength(text.slice(span.start, span.end), 'utf8')
    if (estimatedBytes > MAX_PII_VALIDATION_RESPONSE_BYTES) {
      throw new Error('PII detected entities exceed the validation response size limit')
    }
  }
}

function assertValidationResultBudget(result: PIIValidationResult): PIIValidationResult {
  if (
    result.maskedText !== undefined &&
    result.maskedText.length > MAX_PII_VALIDATION_TEXT_CHARACTERS
  ) {
    throw new Error('PII masked text exceeds the validation response size limit')
  }
  const responseBytes = Buffer.byteLength(JSON.stringify(result), 'utf8')
  if (responseBytes > MAX_PII_VALIDATION_RESPONSE_BYTES) {
    throw new Error('PII validation result exceeds the response size limit')
  }
  return result
}

/**
 * Detect PII spans via the Presidio analyzer. An empty `entityTypes` ⇒ detect all.
 * Throws on transport/HTTP failure so callers can apply their own fail-safe.
 */
async function analyze(
  text: string,
  entityTypes: string[],
  language: string,
  patterns?: CustomPiiPattern[],
  signal?: AbortSignal
): Promise<AnalyzerSpan[]> {
  // Guardrails convention: an empty selection means "detect all". Sending no
  // `entities` keeps that, and the server still runs the custom recognizers under
  // detect-all — so a custom pattern augments the built-in detectors, never
  // silently replaces them.
  const entities = entityTypes.length > 0 ? entityTypes : undefined

  // boundary-raw-fetch: internal call to the Presidio analyzer service via PII_URL
  const response = await fetch(`${PII_URL}/analyze`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      text,
      language,
      ...(entities ? { entities } : {}),
      ...(patterns?.length ? { patterns } : {}),
    }),
    signal,
  })
  if (!response.ok) {
    const detail = await readResponseTextWithLimit(response, {
      maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
      label: 'PII analyzer error response',
      signal,
    }).catch(() => '')
    throw new Error(`Presidio analyze failed (${response.status}): ${detail.slice(0, 200)}`)
  }
  const result = await readResponseJsonWithLimit(response, {
    maxBytes: MAX_PII_VALIDATION_RESPONSE_BYTES,
    label: 'PII analyzer response',
    signal,
  })
  return parseAnalyzerSpans(result, text.length)
}

/**
 * Detect PII spans for many texts in a single analyzer pass (spaCy `nlp.pipe`),
 * the batched counterpart to {@link analyze}. Returns one span array per input,
 * in order. An empty `entityTypes` ⇒ detect all. Throws on transport/HTTP failure.
 */
async function analyzeBatch(
  texts: string[],
  entityTypes: string[],
  language: string,
  patterns?: CustomPiiPattern[]
): Promise<AnalyzerSpan[][]> {
  const entities = resolveBatchEntities(entityTypes, patterns)

  // boundary-raw-fetch: internal call to the Presidio analyzer service via PII_URL
  const response = await fetch(`${PII_URL}/analyze_batch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      texts,
      language,
      ...(entities ? { entities } : {}),
      ...(patterns?.length ? { patterns } : {}),
    }),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Presidio analyze failed (${response.status}): ${detail.slice(0, 200)}`)
  }
  return (await response.json()) as AnalyzerSpan[][]
}

interface AnonymizeBatchItem {
  text: string
  analyzer_results: AnalyzerSpan[]
}

/**
 * Mask many texts in a single anonymizer pass, the batched counterpart to
 * {@link anonymize}. Each item carries its own detected spans; callers must omit
 * items with no spans (those texts pass through unchanged). Returns masked text
 * per item, in order. Throws on failure.
 */
async function anonymizeBatch(
  items: AnonymizeBatchItem[],
  patterns?: CustomPiiPattern[]
): Promise<string[]> {
  if (items.length === 0) return []

  // boundary-raw-fetch: internal call to the Presidio anonymizer service via PII_URL
  const response = await fetch(`${PII_URL}/anonymize_batch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ items, ...(patterns?.length ? { patterns } : {}) }),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Presidio anonymize failed (${response.status}): ${detail.slice(0, 200)}`)
  }
  const data = (await response.json()) as { texts: string[] }
  return data.texts
}

/**
 * Flips to `false` the first time `/redact_batch` returns 404 — an older Presidio
 * image without the combined endpoint — so subsequent chunks skip straight to the
 * legacy analyze+anonymize path instead of re-probing. Reset on process restart
 * (a deploy), so a newly-rolled Presidio is picked up.
 */
let combinedRedactAvailable = true

/**
 * Analyze + anonymize a batch in ONE round-trip via `/redact_batch`, returning
 * masked texts in request order. Halves the app↔service round-trips (and avoids
 * shipping the text back up for anonymize) vs {@link analyzeBatch} + {@link anonymizeBatch}.
 *
 * Returns `null` when the endpoint is absent (404 — an older Presidio image), so
 * the caller falls back to the legacy two-call path. Any other non-2xx or a
 * length mismatch throws so the caller applies its fail-safe (never leaks).
 */
async function redactBatch(
  texts: string[],
  entityTypes: string[],
  language: string,
  patterns?: CustomPiiPattern[]
): Promise<string[] | null> {
  const entities = resolveBatchEntities(entityTypes, patterns)

  // boundary-raw-fetch: internal call to the Presidio combined redact service via PII_URL
  const response = await fetch(`${PII_URL}/redact_batch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      texts,
      language,
      ...(entities ? { entities } : {}),
      ...(patterns?.length ? { patterns } : {}),
    }),
  })
  if (response.status === 404) return null
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Presidio redact_batch failed (${response.status}): ${detail.slice(0, 200)}`)
  }
  const data = (await response.json()) as { texts: string[] }
  if (data.texts.length !== texts.length) {
    throw new Error(
      `Presidio redact_batch returned ${data.texts.length} result(s) for ${texts.length} input(s)`
    )
  }
  return data.texts
}

/**
 * Mask spans via the Presidio anonymizer service. Omitting `anonymizers` uses the
 * default `replace` operator, which yields `<ENTITY_TYPE>`. Throws on failure.
 */
async function anonymize(
  text: string,
  spans: AnalyzerSpan[],
  patterns?: CustomPiiPattern[],
  signal?: AbortSignal
): Promise<string> {
  if (spans.length === 0) return text

  // boundary-raw-fetch: internal call to the Presidio anonymizer service via PII_URL
  const response = await fetch(`${PII_URL}/anonymize`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      text,
      analyzer_results: spans,
      ...(patterns?.length ? { patterns } : {}),
    }),
    signal,
  })
  if (!response.ok) {
    const detail = await readResponseTextWithLimit(response, {
      maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
      label: 'PII anonymizer error response',
      signal,
    }).catch(() => '')
    throw new Error(`Presidio anonymize failed (${response.status}): ${detail.slice(0, 200)}`)
  }
  const data = await readResponseJsonWithLimit<unknown>(response, {
    maxBytes: MAX_PII_VALIDATION_RESPONSE_BYTES,
    label: 'PII anonymizer response',
    signal,
  })
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('PII anonymizer returned an invalid result')
  }
  const maskedText = (data as Record<string, unknown>).text
  if (typeof maskedText !== 'string') {
    throw new Error('PII anonymizer returned an invalid result')
  }
  return maskedText
}

/**
 * Validate text for PII using the Presidio service.
 *
 * - block: fails validation if any PII is detected
 * - mask: passes and returns masked text with PII replaced by `<ENTITY_TYPE>`
 */
export async function validatePII(input: PIIValidationInput): Promise<PIIValidationResult> {
  const { text, entityTypes, mode, language = 'en', customPatterns, requestId, abortSignal } = input

  logger.info(`[${requestId}] Starting PII validation`, {
    textLength: text.length,
    entityTypes,
    mode,
    language,
    customPatternCount: customPatterns?.length ?? 0,
  })

  try {
    abortSignal?.throwIfAborted()
    const spans = await analyze(text, entityTypes, language, customPatterns, abortSignal)
    abortSignal?.throwIfAborted()
    assertDetectedEntityBudget(text, spans, customPatterns)

    const detectedEntities: DetectedPIIEntity[] = spans.map((s) => ({
      type: displayEntityType(s.entity_type, customPatterns),
      start: s.start,
      end: s.end,
      score: s.score,
      text: text.slice(s.start, s.end),
    }))

    if (spans.length === 0) {
      logger.info(`[${requestId}] PII validation completed`, { passed: true, detectedCount: 0 })
      return assertValidationResultBudget({
        passed: true,
        detectedEntities: [],
        maskedText: mode === 'mask' ? text : undefined,
      })
    }

    if (mode === 'block') {
      const counts = new Map<string, number>()
      for (const e of detectedEntities) counts.set(e.type, (counts.get(e.type) ?? 0) + 1)
      const summary = Array.from(counts.entries())
        .map(([type, count]) => `${count} ${type}`)
        .join(', ')
      logger.info(`[${requestId}] PII validation completed`, {
        passed: false,
        detectedCount: detectedEntities.length,
      })
      return assertValidationResultBudget({
        passed: false,
        error: `PII detected: ${summary}`,
        detectedEntities,
      })
    }

    // mask mode: the anonymizer replaces every span with `<ENTITY_TYPE>` (or the
    // pattern's `replacement` for custom-pattern spans).
    const maskedText = await anonymize(text, spans, customPatterns, abortSignal)
    abortSignal?.throwIfAborted()
    logger.info(`[${requestId}] PII validation completed`, {
      passed: true,
      detectedCount: detectedEntities.length,
      hasMaskedText: true,
    })
    return assertValidationResultBudget({ passed: true, detectedEntities, maskedText })
  } catch (error) {
    if (isAbortError(error) || abortSignal?.aborted) throw error
    const errorMessage = truncate(getErrorMessage(error), 950)
    logger.error(`[${requestId}] PII validation failed`, { error: errorMessage })
    return {
      passed: false,
      error: `PII validation failed: ${errorMessage}`,
      detectedEntities: [],
    }
  }
}

/**
 * Mask PII across many strings via the Presidio service, preserving input order.
 *
 * Strings are grouped into byte/count-budgeted chunks (see {@link chunkIndicesByBudget}),
 * and each chunk is masked via the combined `/redact_batch` endpoint (one analyze +
 * anonymize round-trip). Against an older Presidio without that endpoint, it falls
 * back to the legacy `analyze_batch` + `anonymize_batch` pair — so the app is safe
 * to deploy before or after the service. Chunks run with bounded concurrency.
 * Strings with no detected PII pass through unchanged. Rejects on any service
 * failure (which fails the whole batch) so callers can apply their own fail-safe (scrub).
 */
export async function maskPIIBatch(
  texts: string[],
  entityTypes: string[],
  language = 'en',
  customPatterns?: CustomPiiPattern[]
): Promise<string[]> {
  if (texts.length === 0) return []

  const result = new Array<string>(texts.length)

  await mapWithConcurrency(chunkIndicesByBudget(texts), CHUNK_CONCURRENCY, async (indices) => {
    const chunkTexts = indices.map((i) => texts[i])

    if (combinedRedactAvailable) {
      const masked = await redactBatch(chunkTexts, entityTypes, language, customPatterns)
      if (masked) {
        indices.forEach((originalIndex, pos) => {
          result[originalIndex] = masked[pos]
        })
        return
      }
      // 404: older Presidio image; stop probing and use the legacy path below.
      combinedRedactAvailable = false
    }

    const spansPerText = await analyzeBatch(chunkTexts, entityTypes, language, customPatterns)

    // A short/misaligned batch response would silently leave the unmatched
    // strings unmasked (fail-open). Throw so the caller applies its fail-safe
    // (scrub for logs, abort for in-flight stages) instead of leaking PII.
    if (spansPerText.length !== chunkTexts.length) {
      throw new Error(
        `Presidio analyze_batch returned ${spansPerText.length} result(s) for ${chunkTexts.length} input(s)`
      )
    }

    const toAnonymize: AnonymizeBatchItem[] = []
    const anonymizePositions: number[] = []
    indices.forEach((originalIndex, pos) => {
      const spans = spansPerText[pos] ?? []
      if (spans.length === 0) {
        result[originalIndex] = chunkTexts[pos]
        return
      }
      toAnonymize.push({ text: chunkTexts[pos], analyzer_results: spans })
      anonymizePositions.push(pos)
    })

    const masked = await anonymizeBatch(toAnonymize, customPatterns)
    if (masked.length !== toAnonymize.length) {
      throw new Error(
        `Presidio anonymize_batch returned ${masked.length} result(s) for ${toAnonymize.length} input(s)`
      )
    }
    anonymizePositions.forEach((pos, k) => {
      result[indices[pos]] = masked[k]
    })
  })

  return result
}

export { type PIIEntityType, SUPPORTED_PII_ENTITIES } from '@/lib/guardrails/pii-entities'
