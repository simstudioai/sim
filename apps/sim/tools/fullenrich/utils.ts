import { isRecordLike } from '@sim/utils/object'
import type { z } from 'zod'

export function parseFullEnrichInput<T>(value: unknown, schema: z.ZodType<T>, label: string): T {
  let parsed = value
  if (typeof value === 'string') {
    if (value.trim().length === 0) {
      throw new Error(`${label} cannot be empty`)
    }
    try {
      parsed = JSON.parse(value)
    } catch {
      throw new Error(`${label} must be valid JSON`)
    }
  }

  const result = schema.safeParse(parsed)
  if (!result.success) {
    throw new Error(
      `${label} is invalid: ${result.error.issues.map((issue) => issue.message).join('; ')}`
    )
  }
  return result.data
}

export function requireFullEnrichCredits(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite non-negative number`)
  }
  return value
}

export async function extractFullEnrichError(response: Response): Promise<string> {
  const text = await response.text()
  if (text.length === 0) return `FullEnrich API error (${response.status})`

  try {
    const parsed: unknown = JSON.parse(text)
    if (isRecordLike(parsed)) {
      for (const key of ['message', 'error', 'detail']) {
        const value = parsed[key]
        if (typeof value === 'string' && value.length > 0) return value
      }
    }
  } catch {}

  return `FullEnrich API error (${response.status}): ${text}`
}

export function requireFullEnrichString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value
}
