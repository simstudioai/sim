import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/core/security/encryption`.
 * Default: `decryptSecret` resolves to `{ decrypted: 'test-decrypted' }`,
 * `encryptSecret` resolves to `{ encrypted: 'test-encrypted', iv: 'test-iv' }`.
 *
 * @example
 * ```ts
 * import { encryptionMockFns } from '@sim/testing'
 *
 * encryptionMockFns.mockDecryptSecret.mockResolvedValueOnce({ decrypted: 'my-secret' })
 * ```
 */
export const encryptionMockFns = {
  mockDecryptSecret: vi.fn().mockResolvedValue({ decrypted: 'test-decrypted' }),
  mockEncryptSecret: vi.fn().mockResolvedValue({ encrypted: 'test-encrypted', iv: 'test-iv' }),
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
}
