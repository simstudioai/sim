export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

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

export function requiredRecord(
  record: Record<string, unknown>,
  key: string,
  context: string
): Record<string, unknown> {
  const value = record[key]
  if (!isRecord(value)) throw new Error(`${context}.${key} must be an object`)
  return value
}

export async function readGitHubErrorMessage(response: Response): Promise<string | undefined> {
  try {
    const value: unknown = await response.json()
    if (!isRecord(value)) return undefined
    const message = value.message
    return typeof message === 'string' && message.trim() ? message : undefined
  } catch {
    return undefined
  }
}
