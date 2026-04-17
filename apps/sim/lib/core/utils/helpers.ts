/**
 * Returns a promise that resolves after the specified duration.
 * Replaces the common `new Promise(resolve => setTimeout(resolve, ms))` pattern.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Parses a JSON string, returning a fallback value on failure instead of throwing.
 * Replaces the common `try { JSON.parse(str) } catch { return default }` pattern.
 */
export function safeJsonParse<T>(value: string): T | undefined
export function safeJsonParse<T>(value: string, fallback: T): T
export function safeJsonParse<T>(value: string, fallback?: T): T | undefined {
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

/**
 * Type-safe filter predicate that removes null and undefined values.
 * Fixes the common `.filter(Boolean)` pattern which doesn't narrow types in TypeScript.
 */
export function isNonNull<T>(value: T | null | undefined): value is T {
  return value != null
}

/**
 * Normalizes an unknown caught value into an Error instance.
 * Replaces the common `e instanceof Error ? e : new Error(String(e))` pattern in catch clauses.
 */
export function toError(value: unknown): Error {
  if (value instanceof Error) return value
  if (typeof value === 'string') return new Error(value)
  return new Error(String(value))
}
