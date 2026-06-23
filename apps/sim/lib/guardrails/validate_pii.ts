import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { env } from '@/lib/core/config/env'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'

const logger = createLogger('PIIValidator')

/** Just above the analyzer's spaCy NER budget so a stuck sidecar aborts gracefully. */
const REQUEST_TIMEOUT_MS = 45_000

/** Concurrent per-string sidecar calls within one batch; the warm model handles parallelism. */
const MASK_CONCURRENCY = 8

/** Single Presidio sidecar serving both /analyze and /anonymize (VIN is native there). */
const PRESIDIO_URL = env.PRESIDIO_URL || 'http://localhost:5001'

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

  // boundary-raw-fetch: internal call to the Presidio analyzer sidecar over localhost
  const response = await fetch(`${PRESIDIO_URL}/analyze`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, language, ...(entities ? { entities } : {}) }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Presidio analyze failed (${response.status}): ${detail.slice(0, 200)}`)
  }
  return (await response.json()) as AnalyzerSpan[]
}

/**
 * Mask spans via the Presidio anonymizer sidecar. Omitting `anonymizers` uses the
 * default `replace` operator, which yields `<ENTITY_TYPE>`. Throws on failure.
 */
async function anonymize(text: string, spans: AnalyzerSpan[]): Promise<string> {
  if (spans.length === 0) return text

  // boundary-raw-fetch: internal call to the Presidio anonymizer sidecar over localhost
  const response = await fetch(`${PRESIDIO_URL}/anonymize`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, analyzer_results: spans }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Presidio anonymize failed (${response.status}): ${detail.slice(0, 200)}`)
  }
  const data = (await response.json()) as { text: string }
  return data.text
}

/**
 * Validate text for PII using the Presidio sidecar.
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
 * Mask PII across many strings via the Presidio sidecar, preserving input order.
 * Each string runs analyze → anonymize; strings with no detected PII are returned
 * unchanged. Calls run with bounded concurrency: the sidecar's model is warm, so
 * the bottleneck is round-trip latency, and a batch of thousands of small leaves
 * would otherwise exceed the caller's request timeout if run strictly sequentially.
 * Rejects on any sidecar failure (which fails the whole batch) so callers can apply
 * their own fail-safe (scrub).
 */
export async function maskPIIBatch(
  texts: string[],
  entityTypes: string[],
  language = 'en'
): Promise<string[]> {
  if (texts.length === 0) return []

  return mapWithConcurrency(texts, MASK_CONCURRENCY, async (text) => {
    if (!text) return text
    const spans = await analyze(text, entityTypes, language)
    return anonymize(text, spans)
  })
}

export { type PIIEntityType, SUPPORTED_PII_ENTITIES } from '@/lib/guardrails/pii-entities'
