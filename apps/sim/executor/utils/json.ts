import { createLogger } from '@sim/logger'
import { EVALUATOR } from '@/executor/constants'

const logger = createLogger('JSONUtils')

export function parseJSON<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') {
    return fallback
  }

  try {
    return JSON.parse(value.trim())
  } catch {
    return fallback
  }
}

export function stringifyJSON(value: any, indent?: number): string {
  try {
    return JSON.stringify(value, null, indent ?? EVALUATOR.JSON_INDENT)
  } catch (error) {
    logger.warn('Failed to stringify value, returning string representation', { error })
    return String(value)
  }
}

export function isJSONString(value: string): boolean {
  const trimmed = value.trim()
  return trimmed.startsWith('{') || trimmed.startsWith('[')
}

const JSON_SCALAR_TEXT = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)$/

/**
 * Whether trimmed text can be JSON at all — unlike {@link isJSONString}, this also admits
 * strings and scalars. Every valid JSON text passes, so it only skips parses that would fail.
 */
export function mayBeJsonText(text: string): boolean {
  const first = text[0]
  return first === '{' || first === '[' || first === '"' || JSON_SCALAR_TEXT.test(text)
}

/**
 * Recursively parses JSON strings within an object or array.
 * Useful for normalizing data that may contain stringified JSON at various levels.
 */
export function parseObjectStrings(data: unknown): unknown {
  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data)
      if (typeof parsed === 'object' && parsed !== null) {
        return parseObjectStrings(parsed)
      }
      return parsed
    } catch {
      return data
    }
  } else if (Array.isArray(data)) {
    return data.map((item) => parseObjectStrings(item))
  } else if (typeof data === 'object' && data !== null) {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(data)) {
      result[key] = parseObjectStrings(value)
    }
    return result
  }
  return data
}
