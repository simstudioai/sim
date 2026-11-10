import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/core/security/encryption`.
 * Default: `decryptSecret` resolves to `{ decrypted: 'test-decrypted' }`,
 * `encryptSecret` resolves to `{ encrypted: 'test-encrypted', iv: 'test-iv' }` (`iv` is typed
 * optional so overrides may return `{ encrypted }` alone).
 *
 * @example
 * ```ts
 * import { encryptionMockFns } from '@sim/testing/mocks/encryption.mock'
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
