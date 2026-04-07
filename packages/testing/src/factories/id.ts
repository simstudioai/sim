const URL_SAFE_ALPHABET = 'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict'

/**
 * Generates a short, URL-safe random ID for test fixtures.
 *
 * Uses `crypto.getRandomValues()` instead of `crypto.randomUUID()` for
 * consistency with the app-level `generateShortId` utility.
 */
export function shortId(size = 8): string {
  const bytes = new Uint8Array(size)
  crypto.getRandomValues(bytes)

  let id = ''
  for (let i = 0; i < size; i++) {
    id += URL_SAFE_ALPHABET[bytes[i] & 63]
  }
  return id
}
