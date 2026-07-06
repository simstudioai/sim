import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { env } from '@/lib/core/config/env'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import { chunkIndicesByBudget } from '@/lib/guardrails/pii-batching'

const logger = createLogger('PIIValidator')

/**
 * Concurrent chunk requests in flight from a single mask-batch call. Each chunk is
 * itself a batched service call (spaCy `nlp.pipe` over many strings). Default 4;
 * raise via `PII_SERVICE_CHUNK_CONCURRENCY` for a scaled Presidio fleet (this is
 * the route → Presidio fan-out, inner to the app → route `PII_MASK_CHUNK_CONCURRENCY`).
 */
const CHUNK_CONCURRENCY = env.PII_SERVICE_CHUNK_CONCURRENCY ?? 4

/** Presidio service serving both /analyze and /anonymize (VIN is native there). */
const PII_URL = env.PII_URL || 'http://localhost:5001'

export interface PIIValidationInput {
  text: string
  entityTypes: string[] // e.g., ["PERSON", "EMAIL_ADDRESS", "CREDIT_CARD"]
  mode: 'block' | 'mask' // block = fail if PII found, mask = return masked text
  language?: string // default: "en"
  requestId: string
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

/**
 * Detect PII spans via the Presidio analyzer. An empty `entityTypes` ⇒ detect all.
 * Throws on transport/HTTP failure so callers can apply their own fail-safe.
 */
async function analyze(
  text: string,
  entityTypes: string[],
  language: string
): Promise<AnalyzerSpan[]> {
  const entities = entityTypes.length > 0 ? entityTypes : undefined

  // boundary-raw-fetch: internal call to the Presidio analyzer service via PII_URL
  const response = await fetch(`${PII_URL}/analyze`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, language, ...(entities ? { entities } : {}) }),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Presidio analyze failed (${response.status}): ${detail.slice(0, 200)}`)
  }
  return (await response.json()) as AnalyzerSpan[]
}

/**
 * Detect PII spans for many texts in a single analyzer pass (spaCy `nlp.pipe`),
 * the batched counterpart to {@link analyze}. Returns one span array per input,
 * in order. An empty `entityTypes` ⇒ detect all. Throws on transport/HTTP failure.
 */
async function analyzeBatch(
  texts: string[],
  entityTypes: string[],
  language: string
): Promise<AnalyzerSpan[][]> {
  const entities = entityTypes.length > 0 ? entityTypes : undefined

  // boundary-raw-fetch: internal call to the Presidio analyzer service via PII_URL
  const response = await fetch(`${PII_URL}/analyze_batch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ texts, language, ...(entities ? { entities } : {}) }),
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
async function anonymizeBatch(items: AnonymizeBatchItem[]): Promise<string[]> {
  if (items.length === 0) return []

  // boundary-raw-fetch: internal call to the Presidio anonymizer service via PII_URL
  const response = await fetch(`${PII_URL}/anonymize_batch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ items }),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Presidio anonymize failed (${response.status}): ${detail.slice(0, 200)}`)
  }
  const data = (await response.json()) as { texts: string[] }
  return data.texts
}

/**
 * Mask spans via the Presidio anonymizer service. Omitting `anonymizers` uses the
 * default `replace` operator, which yields `<ENTITY_TYPE>`. Throws on failure.
 */
async function anonymize(text: string, spans: AnalyzerSpan[]): Promise<string> {
  if (spans.length === 0) return text

  // boundary-raw-fetch: internal call to the Presidio anonymizer service via PII_URL
  const response = await fetch(`${PII_URL}/anonymize`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, analyzer_results: spans }),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Presidio anonymize failed (${response.status}): ${detail.slice(0, 200)}`)
  }
  const data = (await response.json()) as { text: string }
  return data.text
}

/**
 * Validate text for PII using the Presidio service.
 *
 * - block: fails validation if any PII is detected
 * - mask: passes and returns masked text with PII replaced by `<ENTITY_TYPE>`
 */
export async function validatePII(input: PIIValidationInput): Promise<PIIValidationResult> {
  const { text, entityTypes, mode, language = 'en', requestId } = input

  logger.info(`[${requestId}] Starting PII validation`, {
    textLength: text.length,
    entityTypes,
    mode,
    language,
  })

  try {
    const spans = await analyze(text, entityTypes, language)

    const detectedEntities: DetectedPIIEntity[] = spans.map((s) => ({
      type: s.entity_type,
      start: s.start,
      end: s.end,
      score: s.score,
      text: text.slice(s.start, s.end),
    }))

    if (spans.length === 0) {
      logger.info(`[${requestId}] PII validation completed`, { passed: true, detectedCount: 0 })
      return { passed: true, detectedEntities: [], maskedText: mode === 'mask' ? text : undefined }
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
      return { passed: false, error: `PII detected: ${summary}`, detectedEntities }
    }

    // mask mode: the anonymizer replaces every span with `<ENTITY_TYPE>`.
    const maskedText = await anonymize(text, spans)
    logger.info(`[${requestId}] PII validation completed`, {
      passed: true,
      detectedCount: detectedEntities.length,
      hasMaskedText: true,
    })
    return { passed: true, detectedEntities, maskedText }
  } catch (error) {
    logger.error(`[${requestId}] PII validation failed`, { error: getErrorMessage(error) })
    return {
      passed: false,
      error: `PII validation failed: ${getErrorMessage(error)}`,
      detectedEntities: [],
    }
  }
}

/**
 * Mask PII across many strings via the Presidio service, preserving input order.
 *
 * Strings are grouped into byte/count-budgeted chunks (see {@link chunkIndicesByBudget}),
 * and each chunk runs one batched `analyze` pass followed by one batched `anonymize`
 * pass over only the strings that actually matched — so the service round-trip count
 * scales with payload size, not leaf count, and spaCy batches NER via `nlp.pipe`.
 * Chunks run with bounded concurrency. Strings with no detected PII pass through
 * unchanged. Rejects on any service failure (which fails the whole batch) so callers
 * can apply their own fail-safe (scrub).
 */
export async function maskPIIBatch(
  texts: string[],
  entityTypes: string[],
  language = 'en'
): Promise<string[]> {
  if (texts.length === 0) return []

  const result = new Array<string>(texts.length)

  await mapWithConcurrency(chunkIndicesByBudget(texts), CHUNK_CONCURRENCY, async (indices) => {
    const chunkTexts = indices.map((i) => texts[i])
    const spansPerText = await analyzeBatch(chunkTexts, entityTypes, language)

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

    const masked = await anonymizeBatch(toAnonymize)
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
