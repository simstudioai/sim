/**
 * Returns a promise that resolves after the specified duration.
 * Replaces the common `new Promise(resolve => setTimeout(resolve, ms))` pattern.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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
