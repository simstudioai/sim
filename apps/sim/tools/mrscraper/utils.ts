import { toStringOrNull } from '@sim/utils/coerce'
import { isRecordLike } from '@sim/utils/object'

function requireMrScraperApiKey(apiKey: string): string {
  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    throw new Error('A MrScraper API key is required.')
  }
  return apiKey.trim()
}

export function getMrScraperHeaders(apiKey: string): Record<string, string> {
  const token = requireMrScraperApiKey(apiKey)
  return {
    Authorization: `Bearer ${token}`,
    'x-api-token': token,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
}

export function validateMrScraperInteger(
  value: number | undefined,
  name: string,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER
): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`)
  }
  return value
}

export function validateMrScraperBoolean(
  value: boolean | undefined,
  name: string
): boolean | undefined {
  if (value !== undefined && typeof value !== 'boolean') {
    throw new Error(`${name} must be a boolean.`)
  }
  return value
}

export function getMrScraperNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function requireMrScraperObject(value: unknown, label: string): Record<string, unknown> {
  if (!isRecordLike(value)) throw new Error(`MrScraper returned an invalid ${label}.`)
  return value
}

export function getMrScraperError(data: Record<string, unknown>): string | null {
  return (
    toStringOrNull(data.error) ||
    (data.success === false ? toStringOrNull(data.message) || 'MrScraper request failed.' : null)
  )
}
