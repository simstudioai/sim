import { createLogger } from '@sim/logger'
import type { BlockOutput } from '@/blocks/types'
import { REFERENCE } from '@/executor/constants'

const logger = createLogger('SharedResponseFormat')

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
    } catch (error: any) {
      logger.warn('Failed to parse response format as JSON', {
        error: error.message,
        preview: trimmed.slice(0, 100),
      })
      return undefined
    }
  }

  return undefined
}

/**
 * Validate and extract messages from a raw input value.
 *
 * Accepts a JSON string or an array. Each entry must have
 * `role` (string) and `content` (string).
 */
export function resolveMessages(raw: unknown): Array<{ role: string; content: string }> {
  if (!raw) {
    throw new Error('Messages input is required')
  }

  let messages: unknown[]
  if (typeof raw === 'string') {
    try {
      messages = JSON.parse(raw)
    } catch {
      throw new Error('Messages must be a valid JSON array')
    }
  } else if (Array.isArray(raw)) {
    messages = raw
  } else {
    throw new Error('Messages must be an array of {role, content} objects')
  }

  return messages.map((msg: any, i: number) => {
    if (!msg.role || typeof msg.content !== 'string') {
      throw new Error(`Message at index ${i} must have "role" (string) and "content" (string)`)
    }
    return { role: String(msg.role), content: msg.content }
  })
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
