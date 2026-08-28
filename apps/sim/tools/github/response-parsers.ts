import { isRecordLike } from '@sim/utils/object'
export function requiredString(
  record: Record<string, unknown>,
  key: string,
  context: string
): string {
  const value = record[key]
  if (typeof value !== 'string') throw new Error(`${context}.${key} must be a string`)
  return value
}

export function requiredNonEmptyString(
  record: Record<string, unknown>,
  key: string,
  context: string
): string {
  const value = record[key]
  if (typeof value !== 'string' || !value) {
    throw new Error(`${context}.${key} must be a non-empty string`)
  }
  return value
}

export function requiredTrimmedString(
  record: Record<string, unknown>,
  key: string,
  context: string
): string {
  const value = record[key]
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${context}.${key} must be a non-blank string`)
  }
  return value.trim()
}

export function optionalString(
  record: Record<string, unknown>,
  key: string,
  context: string
): string | undefined {
  const value = record[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Error(`${context}.${key} must be a string`)
  return value
}

export function optionalNonEmptyString(
  record: Record<string, unknown>,
  key: string,
  context: string
): string | undefined {
  const value = record[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !value) {
    throw new Error(`${context}.${key} must be a non-empty string when present`)
  }
  return value
}

export function nullableString(
  record: Record<string, unknown>,
  key: string,
  context: string
): string | null {
  const value = record[key]
  if (value === null) return null
  if (typeof value !== 'string') throw new Error(`${context}.${key} must be a string or null`)
  return value
}

export function nullableNonEmptyString(
  record: Record<string, unknown>,
  key: string,
  context: string
): string | null {
  const value = record[key]
  if (value === null) return null
  if (typeof value !== 'string' || !value) {
    throw new Error(`${context}.${key} must be a non-empty string or null`)
  }
  return value
}

export function requiredNumber(
  record: Record<string, unknown>,
  key: string,
  context: string
): number {
  const value = record[key]
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${context}.${key} must be a non-negative safe integer`)
  }
  return value
}

export function nullableNumber(
  record: Record<string, unknown>,
  key: string,
  context: string
): number | null {
  const value = record[key]
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error(`${context}.${key} must be a safe integer or null`)
  }
  return value
}

export function requiredBoolean(
  record: Record<string, unknown>,
  key: string,
  context: string
): boolean {
  const value = record[key]
  if (typeof value !== 'boolean') throw new Error(`${context}.${key} must be a boolean`)
  return value
}

export function nullableBoolean(
  record: Record<string, unknown>,
  key: string,
  context: string
): boolean | null {
  const value = record[key]
  if (value === null) return null
  if (typeof value !== 'boolean') throw new Error(`${context}.${key} must be a boolean or null`)
  return value
}

export function requiredRecord(
  record: Record<string, unknown>,
  key: string,
  context: string
): Record<string, unknown> {
  const value = record[key]
  if (!isRecordLike(value)) throw new Error(`${context}.${key} must be an object`)
  return value
}

/**
 * Renders one entry of GitHub's `errors[]` array. Entries are either a bare string or
 * an object carrying some combination of `field`, `code`, and `message`.
 */
function readGitHubErrorEntry(entry: unknown): string | undefined {
  if (typeof entry === 'string') return entry.trim() || undefined
  if (!isRecordLike(entry)) return undefined
  const field = typeof entry.field === 'string' ? entry.field.trim() : ''
  const message = typeof entry.message === 'string' ? entry.message.trim() : ''
  const code = typeof entry.code === 'string' ? entry.code.trim() : ''
  const detail = message || code
  if (!detail) return field || undefined
  return field ? `${field}: ${detail}` : detail
}

/**
 * A GitHub 422 names the offending field only in `errors[]` — the top-level `message`
 * is the useless `"Validation Failed"`. The field-level detail is appended so the user
 * can tell which input was rejected. Responses without an `errors[]` array, and
 * responses without a top-level `message` at all, are unchanged.
 */
export async function readGitHubErrorMessage(response: Response): Promise<string | undefined> {
  try {
    const value: unknown = await response.json()
    if (!isRecordLike(value)) return undefined
    const message = value.message
    if (typeof message !== 'string' || !message.trim()) return undefined
    if (!Array.isArray(value.errors)) return message
    const details = value.errors
      .map(readGitHubErrorEntry)
      .filter((detail): detail is string => Boolean(detail))
    return details.length ? `${message}: ${details.join('; ')}` : message
  } catch {
    return undefined
  }
}
