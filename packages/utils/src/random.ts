export const LOWERCASE_ALPHANUMERIC_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

const DEFAULT_ALPHABET = 'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict'
const MAX_RANDOM_VALUES_BYTES = 65_536
const UINT32_MAX_PLUS_ONE = 0x1_0000_0000

type RandomValuesArray = Uint8Array | Uint32Array
type RandomSource = {
  getRandomValues<T extends RandomValuesArray>(array: T): T
}
type MaybeRandomSource = {
  getRandomValues?: RandomSource['getRandomValues']
}

function getCrypto(): RandomSource {
  const cryptoProvider = (globalThis as typeof globalThis & { crypto?: MaybeRandomSource }).crypto
  if (typeof cryptoProvider?.getRandomValues === 'function') {
    return cryptoProvider as RandomSource
  }

  throw new Error('crypto.getRandomValues is unavailable in this runtime')
}

/**
 * Returns cryptographically secure random bytes using Web Crypto.
 *
 * `crypto.getRandomValues()` works in browsers even outside secure contexts,
 * unlike `crypto.randomUUID()`, and is also available in supported Node runtimes.
 */
export function generateRandomBytes(size: number): Uint8Array {
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new Error('generateRandomBytes size must be a non-negative safe integer')
  }

  const cryptoProvider = getCrypto()
  const bytes = new Uint8Array(size)
  for (let offset = 0; offset < size; offset += MAX_RANDOM_VALUES_BYTES) {
    cryptoProvider.getRandomValues(bytes.subarray(offset, offset + MAX_RANDOM_VALUES_BYTES))
  }
  return bytes
}

/**
 * Returns cryptographically secure random bytes encoded as lowercase hex.
 */
export function generateRandomHex(byteLength: number): string {
  return Array.from(generateRandomBytes(byteLength), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('')
}

/**
 * Generates a URL-safe random string from the provided alphabet.
 */
export function generateRandomString(size = 21, alphabet = DEFAULT_ALPHABET): string {
  const alphabetLength = alphabet.length
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new Error('generateRandomString size must be a non-negative safe integer')
  }
  if (alphabetLength < 2 || alphabetLength > 256) {
    throw new Error('generateRandomString alphabet length must be between 2 and 256')
  }

  const mask = (2 << (31 - Math.clz32((alphabetLength - 1) | 1))) - 1
  const step = Math.ceil((1.6 * mask * size) / alphabetLength)

  let id = ''
  while (id.length < size) {
    const bytes = generateRandomBytes(step)
    for (let i = 0; i < step && id.length < size; i++) {
      const index = bytes[i] & mask
      if (index < alphabetLength) {
        id += alphabet[index]
      }
    }
  }

  return id
}

/**
 * Returns a cryptographically secure floating point value in [0, 1).
 */
export function randomFloat(): number {
  const value = new Uint32Array(1)
  getCrypto().getRandomValues(value)
  return value[0] / UINT32_MAX_PLUS_ONE
}

/**
 * Returns a cryptographically secure integer in [0, maxExclusive).
 */
export function randomInt(maxExclusive: number): number {
  if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0) {
    throw new Error('randomInt maxExclusive must be a positive safe integer')
  }
  if (maxExclusive > UINT32_MAX_PLUS_ONE) {
    throw new Error('randomInt maxExclusive must be at most 2^32')
  }

  const maxUnbiased = Math.floor(UINT32_MAX_PLUS_ONE / maxExclusive) * maxExclusive
  const value = new Uint32Array(1)

  do {
    getCrypto().getRandomValues(value)
  } while (value[0] >= maxUnbiased)

  return value[0] % maxExclusive
}

/**
 * Selects a random item from a non-empty array.
 */
export function randomItem<T>(items: readonly T[]): T {
  if (items.length === 0) {
    throw new Error('randomItem requires a non-empty array')
  }
  return items[randomInt(items.length)]
}
