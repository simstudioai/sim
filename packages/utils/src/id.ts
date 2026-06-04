/**
 * Generates a UUID v4 string safe for all contexts.
 *
 * `crypto.randomUUID()` requires a secure context (HTTPS or localhost) in
 * browsers. Self-hosted deployments served over plain HTTP will throw
 * `TypeError: crypto.randomUUID is not a function`. This utility falls back
 * to `crypto.getRandomValues()`, which does not require a secure context.
 */
export function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)

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

const URL_SAFE_ALPHABET = 'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict'

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
export function generateShortId(size = 21, alphabet: string = URL_SAFE_ALPHABET): string {
  const alphabetLength = alphabet.length
  if (alphabetLength < 2 || alphabetLength > 256) {
    throw new Error('generateShortId alphabet length must be between 2 and 256')
  }

  const mask = (2 << (31 - Math.clz32((alphabetLength - 1) | 1))) - 1
  const step = Math.ceil((1.6 * mask * size) / alphabetLength)

  let id = ''
  while (id.length < size) {
    const bytes = new Uint8Array(step)
    crypto.getRandomValues(bytes)
    for (let i = 0; i < step && id.length < size; i++) {
      const index = bytes[i] & mask
      if (index < alphabetLength) {
        id += alphabet[index]
      }
    }
  }
  return id
}
