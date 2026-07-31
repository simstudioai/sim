/**
 * Returns a promise that resolves after the specified duration.
 * Replaces the common `new Promise(resolve => setTimeout(resolve, ms))` pattern.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** No-operation function for use as default callback. */
export const noop = () => {}

/** Splits an array into deterministic, non-empty chunks of at most `size`. */
export function chunkArray<T>(values: T[], size: number): T[][] {
  if (!Number.isInteger(size) || size <= 0) {
    throw new Error('Chunk size must be a positive integer')
  }
  const chunks: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size))
  }
  return chunks
}
