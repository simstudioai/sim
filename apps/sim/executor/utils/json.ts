import { createLogger } from '@sim/logger'
import { EVALUATOR } from '@/executor/constants'

const logger = createLogger('JSONUtils')

export function parseJSON<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') {
    return fallback
  }

  try {
    return JSON.parse(value.trim())
  } catch (error) {
    return fallback
  }
}

export function parseJSONOrThrow(value: string): any {
  try {
    return JSON.parse(value.trim())
  } catch (error) {
    throw new Error(`Invalid JSON: ${error instanceof Error ? error.message : 'Parse error'}`)
  }
}

export function normalizeJSONString(value: string): string {
  return value.replace(/'/g, '"')
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
