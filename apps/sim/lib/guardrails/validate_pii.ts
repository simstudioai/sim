import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { env } from '@/lib/core/config/env'
import { CUSTOM_ENTITY_TYPES, CUSTOM_RECOGNIZERS } from '@/lib/guardrails/recognizers'

const logger = createLogger('PIIValidator')

/** Just above the analyzer's spaCy NER budget so a stuck sidecar aborts gracefully. */
const REQUEST_TIMEOUT_MS = 45_000

const ANALYZER_URL = env.PRESIDIO_ANALYZER_URL || 'http://localhost:5002'
const ANONYMIZER_URL = env.PRESIDIO_ANONYMIZER_URL || 'http://localhost:5001'

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
 * Detect PII spans via the Presidio analyzer sidecar. Returns [] when the request
 * targets only custom entities (nothing left for Presidio). Throws on transport/HTTP failure.
 */
async function analyze(
  text: string,
  entities: string[] | undefined,
  language: string
): Promise<AnalyzerSpan[]> {
  // Custom-only request: the analyzer has nothing to do.
  if (entities && entities.length === 0) return []

  // boundary-raw-fetch: internal call to the Presidio analyzer sidecar over localhost
  const response = await fetch(`${ANALYZER_URL}/analyze`, {
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
  const response = await fetch(`${ANONYMIZER_URL}/anonymize`, {
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
 * All PII spans in `text`: spans from the custom TS recognizers plus the analyzer
 * sidecar's spans, both on original-text offsets. Custom spans carry their own
 * `entity_type`, which the anonymizer replaces with `<ENTITY_TYPE>` like any other.
 * An empty `entityTypes` means "all"; otherwise each side gets only the entities it
 * owns (custom names are never forwarded to the analyzer).
 */
async function collectSpans(
  text: string,
  entityTypes: string[],
  language: string
): Promise<AnalyzerSpan[]> {
  const all = entityTypes.length === 0
  const customSpans: AnalyzerSpan[] = CUSTOM_RECOGNIZERS.filter(
    (r) => all || entityTypes.includes(r.entityType)
  ).flatMap((r) =>
    r.detect(text).map((s) => ({ entity_type: r.entityType, start: s.start, end: s.end, score: 1 }))
  )
  const requestEntities = all ? undefined : entityTypes.filter((t) => !CUSTOM_ENTITY_TYPES.has(t))
  const presidioSpans = await analyze(text, requestEntities, language)
  return [...customSpans, ...presidioSpans]
}

/**
 * Validate text for PII using Presidio sidecars (+ the TS VIN recognizer).
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
    const spans = await collectSpans(text, entityTypes, language)

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

    // mask mode: the anonymizer replaces every span (incl. VIN) with `<ENTITY_TYPE>`.
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
 * Mask PII across many strings via the Presidio sidecars, preserving input order.
 * Each string runs a TS VIN pre-pass, then analyze → anonymize. Strings with no
 * detected PII are returned unchanged. Rejects on any sidecar failure so callers
 * can apply their own fail-safe (scrub rather than leak).
 */
export async function maskPIIBatch(
  texts: string[],
  entityTypes: string[],
  language = 'en'
): Promise<string[]> {
  if (texts.length === 0) return []

  const masked: string[] = []
  for (const text of texts) {
    if (!text) {
      masked.push(text)
      continue
    }
    const spans = await collectSpans(text, entityTypes, language)
    masked.push(await anonymize(text, spans))
  }
  return masked
}

export { type PIIEntityType, SUPPORTED_PII_ENTITIES } from '@/lib/guardrails/pii-entities'
