import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/core/security/input-validation.server`.
 *
 * @example
 * ```ts
 * import { inputValidationMockFns } from '@sim/testing'
 *
 * inputValidationMockFns.mockValidateUrlWithDNS.mockResolvedValue({ valid: true })
 * inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValue({ response: new Response() })
 * ```
 */
export const inputValidationMockFns = {
  mockValidateUrlWithDNS: vi.fn(),
  mockValidateDatabaseHost: vi.fn(),
  mockSecureFetchWithPinnedIP: vi.fn(),
  mockSecureFetchWithValidation: vi.fn(),
  mockIsPrivateOrReservedIP: vi.fn().mockReturnValue(false),
  mockCreatePinnedLookup: vi.fn(),
}

/**
 * Static mock module for `@/lib/core/security/input-validation.server`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)
 * ```
 */
export const inputValidationMock = {
  validateUrlWithDNS: inputValidationMockFns.mockValidateUrlWithDNS,
  validateDatabaseHost: inputValidationMockFns.mockValidateDatabaseHost,
  secureFetchWithPinnedIP: inputValidationMockFns.mockSecureFetchWithPinnedIP,
  secureFetchWithValidation: inputValidationMockFns.mockSecureFetchWithValidation,
  isPrivateOrReservedIP: inputValidationMockFns.mockIsPrivateOrReservedIP,
  createPinnedLookup: inputValidationMockFns.mockCreatePinnedLookup,
  SecureFetchHeaders: class {
    headers: Record<string, string> = {}
    set(k: string, v: string) {
      this.headers[k] = v
    }
    get(k: string) {
      return this.headers[k]
    }
  },
}
