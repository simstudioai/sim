import { vi } from 'vitest'

const PASSWORD_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_-+='

/** Web Crypto's per-call `getRandomValues` quota, in bytes. */
const MAX_RANDOM_BYTES_PER_CALL = 65_536

/**
 * Same alphabet and length contract as the real `generatePassword`, using Web Crypto. The random
 * values are filled in quota-sized chunks so lengths beyond 16,384 characters work too.
 */
function generatePassword(length = 24): string {
  const bytes = new Uint32Array(length)
  const chunkLength = MAX_RANDOM_BYTES_PER_CALL / Uint32Array.BYTES_PER_ELEMENT
  for (let offset = 0; offset < length; offset += chunkLength) {
    crypto.getRandomValues(bytes.subarray(offset, offset + chunkLength))
  }
  let result = ''
  for (const byte of bytes) result += PASSWORD_CHARS.charAt(byte % PASSWORD_CHARS.length)
  return result
}

/**
 * Controllable mock functions for `@/lib/core/security/encryption`.
 * Default: `decryptSecret` resolves to `{ decrypted: 'test-decrypted' }`,
 * `encryptSecret` resolves to `{ encrypted: 'test-encrypted', iv: 'test-iv' }` (`iv` is typed
 * optional so overrides may return `{ encrypted }` alone),
 * `generatePassword` returns a random password of the requested length (24 by default).
 *
 * @example
 * ```ts
 * import { encryptionMockFns } from '@sim/testing'
 *
 * encryptionMockFns.mockDecryptSecret.mockResolvedValueOnce({ decrypted: 'my-secret' })
 * encryptionMockFns.mockDecryptSecret.mockImplementation(async (value: string) => ({ decrypted: value }))
 * ```
 */
export const encryptionMockFns = {
  mockDecryptSecret: vi.fn(async (_encryptedValue: string) => ({ decrypted: 'test-decrypted' })),
  mockEncryptSecret: vi.fn(
    async (_secret: string): Promise<{ encrypted: string; iv?: string }> => ({
      encrypted: 'test-encrypted',
      iv: 'test-iv',
    })
  ),
  mockGeneratePassword: vi.fn(generatePassword),
}

/**
 * Static mock module for `@/lib/core/security/encryption`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/core/security/encryption', () => encryptionMock)
 * ```
 */
export const encryptionMock = {
  decryptSecret: encryptionMockFns.mockDecryptSecret,
  encryptSecret: encryptionMockFns.mockEncryptSecret,
  generatePassword: encryptionMockFns.mockGeneratePassword,
}
