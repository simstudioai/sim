import type { RdsStatementParameters } from '@/tools/rds/types'

/**
 * Accepts statement parameters as an object, an array, or the JSON text of either, and
 * returns the parsed value. Blank text means no parameters.
 */
export function parseStatementParameters(
  value: RdsStatementParameters | string
): RdsStatementParameters | undefined {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (!trimmed) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    throw new Error('Parameters must be a JSON object or an array of {name, value} entries')
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw new Error('Parameters must be a JSON object or an array of {name, value} entries')
  }
  return parsed as RdsStatementParameters
}
