import { generateRandomBytes, generateRandomString } from './random.js'

type RandomUuidSource = {
  randomUUID?: () => string
}

/**
 * Generates a UUID v4 string safe for all contexts.
 *
 * `crypto.randomUUID()` requires a secure context (HTTPS or localhost) in
 * browsers. Self-hosted deployments served over plain HTTP will throw
 * `TypeError: crypto.randomUUID is not a function`. This utility falls back
 * to `crypto.getRandomValues()`, which does not require a secure context.
 */
export function generateId(): string {
  const cryptoProvider = (globalThis as typeof globalThis & { crypto?: RandomUuidSource }).crypto
  if (typeof cryptoProvider?.randomUUID === 'function') {
    return cryptoProvider.randomUUID()
  }

  const bytes = generateRandomBytes(16)

  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Validates whether a string is a well-formed UUID (any version).
 */
export function isValidUuid(value: string): boolean {
  return UUID_RE.test(value)
}

/**
 * Generates a short, URL-safe random ID.
 *
 * Replaces `nanoid` — uses `crypto.getRandomValues()` which works in all
 * contexts including non-secure (HTTP) browsers.
 *
 * @param size - Length of the generated ID (default: 21)
 * @param alphabet - Optional custom alphabet (replaces nanoid's `customAlphabet`).
 *                   Length must be in [2, 256].
 * @returns A random string drawn from the alphabet
 */
export function generateShortId(size = 21, alphabet?: string): string {
  return generateRandomString(size, alphabet)
}
