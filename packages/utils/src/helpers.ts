/**
 * Returns a promise that resolves after the specified duration.
 * Replaces the common `new Promise(resolve => setTimeout(resolve, ms))` pattern.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** No-operation function for use as default callback. */
export const noop = () => {}
