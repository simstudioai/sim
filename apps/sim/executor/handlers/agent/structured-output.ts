import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { truncate } from '@sim/utils/string'
import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv'
import { LRUCache } from 'lru-cache'
import type { ProviderResponse } from '@/providers/types'

const logger = createLogger('AgentStructuredOutput')

/**
 * How many times the provider call is re-issued after a structured output
 * fails validation, before the block fails explicitly.
 */
export const STRUCTURED_OUTPUT_RETRIES = 1

/**
 * Finish reasons that mean the model hit its output token limit, across
 * provider vocabularies: Anthropic/Bedrock report `max_tokens`, the OpenAI
 * Chat Completions family reports `length`, Gemini reports `MAX_TOKENS`.
 * Compared case-insensitively.
 */
const TRUNCATION_FINISH_REASONS = new Set(['max_tokens', 'length'])

/**
 * User-authored schemas are per-block and editable, so validators are cached
 * by schema content rather than by a static name. `strict: false` tolerates
 * unknown keywords in user-authored schemas instead of refusing to compile.
 */
const ajv = new Ajv({ allErrors: true, strict: false })
const validatorCache = new LRUCache<string, ValidateFunction | false>({ max: 500 })

export type StructuredOutputVerdict =
  | { ok: true; output: Record<string, unknown> }
  | { ok: false; reason: string }

/**
 * Whether the agent block should enforce its structured response format after
 * generation. Enforcement follows the response format's own `strict` flag,
 * which the block schema has always documented as defaulting to true —
 * setting `"strict": false` in the response format keeps the legacy lenient
 * fallback behavior.
 */
export function shouldEnforceStructuredOutput(responseFormat: unknown): boolean {
  if (!responseFormat || typeof responseFormat !== 'object') return false
  return (responseFormat as { strict?: unknown }).strict !== false
}

/**
 * Validates a completed (non-streaming) provider response against the
 * authored response format. One verdict covers the three failure modes that
 * previously collapsed into silent success: truncation at the output token
 * limit, unparseable JSON, and parseable JSON that violates the authored
 * schema (including constraints like `enum` and `minLength` that native
 * structured output grammars weaken to advisory prose).
 */
export function validateStructuredOutput(
  response: ProviderResponse,
  responseFormat: unknown
): StructuredOutputVerdict {
  const finishReason = lastModelFinishReason(response)
  if (finishReason && TRUNCATION_FINISH_REASONS.has(finishReason.toLowerCase())) {
    return {
      ok: false,
      reason: `the model stopped at its output token limit (finish reason "${finishReason}") before completing the structured response`,
    }
  }

  const content = typeof response.content === 'string' ? response.content.trim() : ''
  if (!content) {
    return { ok: false, reason: 'the model returned empty content instead of structured JSON' }
  }

  const parsed = parseStructuredContent(content)
  if (!parsed.ok) return parsed

  const validator = getValidator(extractSchema(responseFormat))
  if (validator && !validator(parsed.output)) {
    return {
      ok: false,
      reason: `the response violates the configured schema: ${formatValidationErrors(validator.errors)}`,
    }
  }

  return parsed
}

/**
 * Folds a failed structured attempt's usage into the response that finally
 * validated, so the block's reported tokens, cost, and trace segments reflect
 * everything the run actually consumed. Mutates `response` in place, matching
 * how routing cost is applied to block results.
 */
export function mergeFailedStructuredAttempt(
  response: ProviderResponse,
  failedAttempt: ProviderResponse
): void {
  if (failedAttempt.tokens) {
    const merged = { ...(response.tokens ?? {}) }
    for (const key of ['input', 'output', 'total', 'cacheRead', 'cacheWrite'] as const) {
      const failedValue = failedAttempt.tokens[key]
      if (failedValue === undefined) continue
      merged[key] = (merged[key] ?? 0) + failedValue
    }
    response.tokens = merged
  }

  if (failedAttempt.cost) {
    response.cost = response.cost
      ? {
          ...response.cost,
          input: response.cost.input + failedAttempt.cost.input,
          output: response.cost.output + failedAttempt.cost.output,
          total: response.cost.total + failedAttempt.cost.total,
        }
      : { ...failedAttempt.cost }
  }

  if (failedAttempt.timing && response.timing) {
    response.timing.startTime = failedAttempt.timing.startTime
    response.timing.duration += failedAttempt.timing.duration
    if (failedAttempt.timing.timeSegments?.length || response.timing.timeSegments?.length) {
      response.timing.timeSegments = [
        ...(failedAttempt.timing.timeSegments ?? []),
        ...(response.timing.timeSegments ?? []),
      ]
    }
  } else if (failedAttempt.timing && !response.timing) {
    response.timing = failedAttempt.timing
  }
}

/**
 * Every provider's trace enricher records the finish reason on the model time
 * segments it emits, so the final model segment carries the terminal finish
 * reason without any per-provider wiring here.
 */
function lastModelFinishReason(response: ProviderResponse): string | undefined {
  const segments = response.timing?.timeSegments
  if (!Array.isArray(segments)) return undefined
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i]
    if (segment?.type === 'model') return segment.finishReason
  }
  return undefined
}

/**
 * Parses model output as a JSON object, rescuing the common prompt-based
 * failure of valid JSON wrapped in a Markdown code fence. Non-object roots
 * are rejected because the block spreads the parsed fields into its output.
 */
function parseStructuredContent(content: string): StructuredOutputVerdict {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch (error) {
    const unfenced = stripCodeFence(content)
    if (unfenced === undefined) {
      return {
        ok: false,
        reason: `the response is not valid JSON (${getErrorMessage(error, 'parse error')}; content began "${truncate(content, 120)}")`,
      }
    }
    try {
      parsed = JSON.parse(unfenced)
    } catch (fencedError) {
      return {
        ok: false,
        reason: `the response is not valid JSON (${getErrorMessage(fencedError, 'parse error')}; content began "${truncate(content, 120)}")`,
      }
    }
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'the response parsed as JSON but is not a JSON object' }
  }
  return { ok: true, output: parsed as Record<string, unknown> }
}

function stripCodeFence(content: string): string | undefined {
  const match = /^```[a-zA-Z]*\s*([\s\S]*?)\s*```$/.exec(content)
  return match?.[1]
}

/**
 * The provider layer sends `responseFormat.schema` when the wrapper shape is
 * present and the whole value otherwise; validation mirrors that so the
 * schema validated here is the schema the model was asked to follow.
 */
function extractSchema(responseFormat: unknown): object | undefined {
  if (!responseFormat || typeof responseFormat !== 'object') return undefined
  const wrapper = responseFormat as { schema?: unknown }
  if (wrapper.schema && typeof wrapper.schema === 'object') return wrapper.schema
  return responseFormat as object
}

/**
 * Compiles (and caches) a validator for a user-authored schema. A schema ajv
 * cannot compile downgrades enforcement to the parse-only checks rather than
 * failing runs over an inexpressible schema.
 */
function getValidator(schema: object | undefined): ValidateFunction | undefined {
  if (!schema) return undefined

  let cacheKey: string
  try {
    cacheKey = JSON.stringify(schema)
  } catch {
    return undefined
  }

  const cached = validatorCache.get(cacheKey)
  if (cached !== undefined) return cached === false ? undefined : cached

  try {
    const validator = ajv.compile(schema)
    validatorCache.set(cacheKey, validator)
    return validator
  } catch (error) {
    logger.warn('Response format schema failed to compile; falling back to JSON parse checks', {
      error: getErrorMessage(error, 'compile error'),
    })
    validatorCache.set(cacheKey, false)
    return undefined
  }
}

function formatValidationErrors(errors: ErrorObject[] | null | undefined): string {
  if (!errors || errors.length === 0) return 'unknown validation error'
  return errors
    .slice(0, 5)
    .map((error) => `${error.instancePath || '/'} ${error.message || 'is invalid'}`.trim())
    .join('; ')
}
