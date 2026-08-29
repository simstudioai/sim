import { createLogger } from '@sim/logger'
import { NonRetryableExecutionError } from '@/lib/execution/non-retryable-error'
import type { BlockOutput } from '@/blocks/types'
import { REFERENCE } from '@/executor/constants'

const logger = createLogger('SharedResponseFormat')

export const DEFAULT_STRUCTURED_OUTPUT_MAX_TOKENS = 4096

const TOKEN_LIMIT_FINISH_REASONS = new Set(['max_tokens', 'max_output_tokens', 'length'])

interface ProviderTimingLike {
  timeSegments?: Array<{
    type?: string
    finishReason?: string
  }>
}

export class StructuredOutputTokenLimitError extends NonRetryableExecutionError {
  readonly code = 'structured_output_token_limit' as const
  readonly diagnosticOutput?: Record<string, unknown>

  constructor(diagnosticOutput?: Record<string, unknown>) {
    super(
      'Structured output reached the maximum output-token limit before completion. Increase Max Output Tokens or reduce the requested response size.'
    )
    this.name = 'StructuredOutputTokenLimitError'
    this.diagnosticOutput = diagnosticOutput
    Object.defineProperty(this, 'diagnosticOutput', { enumerable: false })
  }
}

/**
 * Rejects explicitly token-limited structured generations before their partial
 * content can be parsed or exposed as a successful block output.
 */
export function assertStructuredOutputNotTokenLimited(
  timing?: ProviderTimingLike,
  diagnosticOutput?: Record<string, unknown>
): void {
  const segments = timing?.timeSegments
  if (!Array.isArray(segments)) return

  for (let index = segments.length - 1; index >= 0; index--) {
    const segment = segments[index]
    if (segment?.type !== 'model') continue

    const finishReason = segment.finishReason?.trim().toLowerCase()
    if (finishReason && TOKEN_LIMIT_FINISH_REASONS.has(finishReason)) {
      throw new StructuredOutputTokenLimitError(diagnosticOutput)
    }
    return
  }
}

/**
 * Parse a raw responseFormat value (string or object) into a usable schema.
 *
 * Handles:
 * - Empty / falsy → undefined
 * - Already an object → wraps bare schemas with `{ name, schema, strict }`
 * - JSON string → parsed, then same wrapping logic
 * - Unresolved block references (`<block.field>`) → undefined
 */
export function parseResponseFormat(responseFormat?: string | object): any {
  if (!responseFormat || responseFormat === '') return undefined

  if (typeof responseFormat === 'object' && responseFormat !== null) {
    const formatObj = responseFormat as any
    if (!formatObj.schema && !formatObj.name) {
      return { name: 'response_schema', schema: responseFormat, strict: true }
    }
    return responseFormat
  }

  if (typeof responseFormat === 'string') {
    const trimmed = responseFormat.trim()
    if (!trimmed) return undefined
    if (trimmed.startsWith(REFERENCE.START) && trimmed.includes(REFERENCE.END)) {
      return undefined
    }
    try {
      const parsed = JSON.parse(trimmed)
      if (parsed && typeof parsed === 'object' && !parsed.schema && !parsed.name) {
        return { name: 'response_schema', schema: parsed, strict: true }
      }
      return parsed
    } catch (error) {
      logger.warn('Failed to parse response format as JSON', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
        responseFormatType: 'string',
        responseFormatLength: trimmed.length,
      })
      return undefined
    }
  }

  return undefined
}

/**
 * Try to parse the LLM response content as structured JSON and spread
 * the fields into the block output. Falls back to returning raw content.
 */
export function processStructuredResponse(
  result: { content?: string; model?: string; tokens?: any },
  defaultModel: string
): BlockOutput {
  const content = result.content ?? ''
  try {
    const parsed = JSON.parse(content.trim())
    return {
      ...parsed,
      model: result.model || defaultModel,
      tokens: result.tokens || {},
    }
  } catch {
    logger.warn('Failed to parse structured response, returning raw content')
    return {
      content,
      model: result.model || defaultModel,
      tokens: result.tokens || {},
    }
  }
}
