import { vi } from 'vitest'
import { urlsMockFns } from './urls.mock'

/**
 * Mirrors `ShareValidationError` from `@/lib/public-shares/share-manager` (a plain `Error`
 * subclass in production too): same `name` and `(message)` constructor.
 */
export class MockShareValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ShareValidationError'
  }
}

/**
 * Controllable mock functions for `@/lib/public-shares/share-manager`.
 *
 * Bare `vi.fn()` except:
 * - `mockBuildShareUrl(token)` → `${getBaseUrl()}/f/${token}` (faithful port; reads the shared
 *   `urlsMockFns.mockGetBaseUrl`, so it records a call there).
 * - `mockGetShareForResource` resolves `null` (no share).
 * - `mockGetSharesForResources` / `mockGetWorkspaceSharesForResources` /
 *   `mockGetWorkspaceShares` resolve an empty `Map`.
 *
 * @example
 * ```ts
 * import { publicSharesMockFns } from '@sim/testing/mocks/public-shares.mock'
 *
 * publicSharesMockFns.mockResolveActiveShareByToken.mockResolvedValue(share)
 * ```
 */
export const publicSharesMockFns = {
  mockBuildShareUrl: vi.fn((token: string): string => `${urlsMockFns.mockGetBaseUrl()}/f/${token}`),
  mockGetShareForResource: vi.fn(async (..._args: unknown[]): Promise<unknown> => null),
  mockGetSharesForResources: vi.fn(
    async (..._args: unknown[]): Promise<Map<string, unknown>> => new Map()
  ),
  mockGetWorkspaceSharesForResources: vi.fn(
    async (..._args: unknown[]): Promise<Map<string, unknown>> => new Map()
  ),
  mockGetWorkspaceShares: vi.fn(
    async (..._args: unknown[]): Promise<Map<string, unknown>> => new Map()
  ),
  mockUpsertFileShare: vi.fn(),
  mockResolveActiveShareByToken: vi.fn(),
}

/**
 * Static mock module for `@/lib/public-shares/share-manager`. `ShareValidationError` is
 * {@link MockShareValidationError}.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/public-shares/share-manager', () => publicSharesMock)
 * ```
 */
export const publicSharesMock = {
  ShareValidationError: MockShareValidationError,
  buildShareUrl: publicSharesMockFns.mockBuildShareUrl,
  getShareForResource: publicSharesMockFns.mockGetShareForResource,
  getSharesForResources: publicSharesMockFns.mockGetSharesForResources,
  getWorkspaceSharesForResources: publicSharesMockFns.mockGetWorkspaceSharesForResources,
  getWorkspaceShares: publicSharesMockFns.mockGetWorkspaceShares,
  upsertFileShare: publicSharesMockFns.mockUpsertFileShare,
  resolveActiveShareByToken: publicSharesMockFns.mockResolveActiveShareByToken,
}
