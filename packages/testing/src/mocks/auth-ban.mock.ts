import { vi } from 'vitest'

interface MockBanRow {
  banned: boolean | null
  banExpires: Date | null
  suspendedAt?: Date | null
}

function isBanActive(row: MockBanRow): boolean {
  if (!row.banned) return false
  if (row.banExpires && row.banExpires.getTime() <= Date.now()) return false
  return true
}

/**
 * Controllable mock functions for `@/lib/auth/ban`.
 *
 * Defaults:
 * - `mockIsBanActive` / `mockIsAccountBlocked` are faithful ports of the real pure predicates
 *   (an expired ban is lifted; a suspension blocks).
 * - `mockIsEmailBlocked` resolves `false`.
 * - `mockGetActivelyBannedUserIds` resolves `[]` (nobody is banned).
 *
 * @example
 * ```ts
 * import { authBanMockFns } from '@sim/testing/mocks/auth-ban.mock'
 *
 * authBanMockFns.mockGetActivelyBannedUserIds.mockResolvedValue(['user-1'])
 * ```
 */
export const authBanMockFns = {
  mockIsBanActive: vi.fn(isBanActive),
  mockIsAccountBlocked: vi.fn(
    (row: MockBanRow): boolean => isBanActive(row) || Boolean(row.suspendedAt)
  ),
  mockIsEmailBlocked: vi.fn(async (_email: string | null | undefined): Promise<boolean> => false),
  mockGetActivelyBannedUserIds: vi.fn(async (_userIds: string[]): Promise<string[]> => []),
}

/**
 * Static mock module for `@/lib/auth/ban`. Covers every runtime export.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/auth/ban', () => authBanMock)
 * ```
 */
export const authBanMock = {
  isBanActive: authBanMockFns.mockIsBanActive,
  isAccountBlocked: authBanMockFns.mockIsAccountBlocked,
  isEmailBlocked: authBanMockFns.mockIsEmailBlocked,
  getActivelyBannedUserIds: authBanMockFns.mockGetActivelyBannedUserIds,
}
