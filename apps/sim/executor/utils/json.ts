import { createLogger } from '@/lib/logs/console/logger'
import { EVALUATOR } from '@/executor/consts'

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
