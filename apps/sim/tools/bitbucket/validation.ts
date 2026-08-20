const BITBUCKET_SHA1_PATTERN = /^[0-9a-f]{40}$/i

export function optionalBitbucketString(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`)
  }
  return value.trim()
}

export function optionalBitbucketBoolean(value: unknown, name: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') throw new Error(`${name} must be a boolean`)
  return value
}

export function optionalBitbucketEnum<T extends string>(
  value: unknown,
  name: string,
  allowed: readonly T[]
): T | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new Error(`${name} must be one of: ${allowed.join(', ')}`)
  }
  return value as T
}

export function requireBitbucketEnum<T extends string>(
  value: unknown,
  name: string,
  allowed: readonly T[]
): T {
  const validated = optionalBitbucketEnum(value, name, allowed)
  if (validated === undefined) throw new Error(`${name} is required`)
  return validated
}

export function optionalBitbucketStringArray(
  value: unknown,
  name: string,
  itemName: string
): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error(`${name} must be an array of strings`)
  return value.map((item) => {
    if (typeof item !== 'string' || item.trim().length === 0) {
      throw new Error(`${itemName} must be a non-empty string`)
    }
    return item.trim()
  })
}

export function requireBitbucketPositiveInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`)
  }
  return value
}

export function requireBitbucketSha1(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new Error(`${name} must be a full 40-character SHA-1`)
  const normalized = value.trim()
  if (!BITBUCKET_SHA1_PATTERN.test(normalized)) {
    throw new Error(`${name} must be a full 40-character SHA-1`)
  }
  return normalized.toLowerCase()
}

export function optionalBitbucketSha1(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined
  return requireBitbucketSha1(value, name)
}

export function optionalBitbucketUtf8String(
  value: unknown,
  name: string,
  maxBytes: number
): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Error(`${name} must be a string`)
  if (new TextEncoder().encode(value).byteLength > maxBytes) {
    throw new Error(`${name} must not exceed ${maxBytes} UTF-8 bytes`)
  }
  return value
}
