/**
 * Asserts that a condition is truthy, throwing an Error if it is not.
 * Use for invariants that should never be violated at runtime.
 */
export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

/**
 * Asserts that a value is `never`, useful for exhaustive switch/if-else checks.
 * TypeScript will error at compile time if a case is unhandled.
 */
export function assertNever(value: never, message?: string): never {
  throw new Error(message ?? `Unexpected value: ${JSON.stringify(value)}`)
}
