/**
 * Mock UUID utilities for testing
 */
import { vi } from 'vitest'

/**
 * Mock UUID v4 generation for consistent test results.
 * Uses vi.doMock to mock the uuid module.
 *
 * @param mockValue - The UUID value to return (defaults to 'test-uuid')
 *
 * @example
 * ```ts
 * mockUuid('my-test-uuid')
 * // Now uuid.v4() will return 'my-test-uuid'
 * ```
 */
export function mockUuid(mockValue = 'test-uuid') {
  vi.doMock('uuid', () => ({
    v4: vi.fn().mockReturnValue(mockValue),
  }))
}

/**
 * Mock crypto.randomUUID for tests.
 * Uses vi.stubGlobal to replace the global crypto object.
 *
 * @param mockValue - The UUID value to return (defaults to 'mock-uuid-1234-5678')
 *
 * @example
 * ```ts
 * mockCryptoUuid('custom-uuid')
 * // Now crypto.randomUUID() will return 'custom-uuid'
 * ```
 */
export function mockCryptoUuid(mockValue = 'mock-uuid-1234-5678') {
  vi.stubGlobal('crypto', {
    randomUUID: vi.fn().mockReturnValue(mockValue),
  })
}
