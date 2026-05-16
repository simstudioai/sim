/**
 * Cryptographically secure random utilities built on `crypto.getRandomValues()`.
 * Works in all contexts including non-secure (HTTP) browser environments.
 */

/** Lowercase alphanumeric characters used as the default alphabet for random strings. */
export const LOWERCASE_ALPHANUMERIC_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

/**
 * Generates cryptographically secure random bytes.
 * @param length - Number of bytes to generate
 * @returns Uint8Array of random bytes
 */
export function generateRandomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length))
}

/**
 * Generates a cryptographically secure random hex string.
 * @param length - Number of hex characters (default: 16)
 * @returns Lowercase hex string of the given length
 */
export function generateRandomHex(length = 16): string {
  const bytes = generateRandomBytes(Math.ceil(length / 2))
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, length)
}

/**
 * Generates a cryptographically secure random alphanumeric string.
 * @param length - Number of characters (default: 16)
 * @returns Random string composed of A-Z, a-z, 0-9
 */
export function generateRandomString(length = 16): string {
  const bytes = generateRandomBytes(length)
  return Array.from(bytes)
    .map((b) => CHARS[b % CHARS.length])
    .join('')
}

/**
 * Returns a cryptographically secure random float in [0, 1).
 * Drop-in replacement for `Math.random()`.
 */
export function randomFloat(): number {
  const [value] = crypto.getRandomValues(new Uint32Array(1))
  return value / 0x100000000
}

/**
 * Returns a cryptographically secure random integer in [min, max).
 * Uses rejection sampling for uniform distribution (no modulo bias).
 * @param min - Inclusive lower bound
 * @param max - Exclusive upper bound
 */
export function randomInt(min: number, max: number): number {
  const range = max - min
  if (range <= 0) throw new RangeError(`randomInt: max (${max}) must be greater than min (${min})`)
  const threshold = (0x100000000 - (0x100000000 % range)) >>> 0
  let value: number
  do {
    ;[value] = crypto.getRandomValues(new Uint32Array(1))
  } while (value >= threshold)
  return min + (value % range)
}

/**
 * Returns a uniformly random element from a non-empty array.
 * @param items - Array to sample from (must have at least one element)
 */
export function randomItem<T>(items: readonly T[]): T {
  if (items.length === 0) throw new RangeError('randomItem: array must not be empty')
  return items[randomInt(0, items.length)]
}
