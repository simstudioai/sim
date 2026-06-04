import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/core/utils/urls`.
 *
 * @example
 * ```ts
 * import { urlsMockFns } from '@sim/testing'
 *
 * urlsMockFns.mockGetBaseUrl.mockReturnValue('https://custom.example.com')
 * ```
 */
export const urlsMockFns = {
  mockGetBaseUrl: vi.fn(),
  mockGetInternalApiBaseUrl: vi.fn(),
  mockEnsureAbsoluteUrl: vi.fn(),
  mockGetBaseDomain: vi.fn(),
  mockGetEmailDomain: vi.fn(),
  mockGetSocketServerUrl: vi.fn(),
  mockGetSocketUrl: vi.fn(),
  mockGetOllamaUrl: vi.fn(),
}

/**
 * Static mock module for `@/lib/core/utils/urls`.
 * Functions return sensible localhost defaults.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/core/utils/urls', () => urlsMock)
 * ```
 */
export const urlsMock = {
  SITE_URL: 'https://www.sim.ai',
  getBaseUrl: urlsMockFns.mockGetBaseUrl,
  getInternalApiBaseUrl: urlsMockFns.mockGetInternalApiBaseUrl,
  ensureAbsoluteUrl: urlsMockFns.mockEnsureAbsoluteUrl,
  getBaseDomain: urlsMockFns.mockGetBaseDomain,
  getEmailDomain: urlsMockFns.mockGetEmailDomain,
  getSocketServerUrl: urlsMockFns.mockGetSocketServerUrl,
  getSocketUrl: urlsMockFns.mockGetSocketUrl,
  getOllamaUrl: urlsMockFns.mockGetOllamaUrl,
}
