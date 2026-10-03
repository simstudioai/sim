import { vi } from 'vitest'

/**
 * Real `defaultUserSettings` value from `@/lib/users/queries`.
 */
const defaultUserSettings = {
  theme: 'system',
  autoConnect: true,
  telemetryEnabled: true,
  emailPreferences: {},
  billingUsageNotificationsEnabled: true,
  superUserModeEnabled: false,
  mothershipEnvironment: 'default',
  errorNotificationsEnabled: true,
  snapToGridSize: 0,
  showActionBar: true,
  autoFocusOnClick: true,
  copilotAutoAllowedTools: [] as string[],
  timezone: null,
  lastActiveWorkspaceId: null,
}

/**
 * Controllable mock functions for `@/lib/users/queries`.
 *
 * Every loader is a bare `vi.fn()` (returns `undefined`) except the pure helper
 * `mockRequireResolvedUserEmail(emails, userId)`, which ports the real logic: returns
 * `emails.get(userId)` and throws `Unable to resolve email for user ID: <id>` when missing.
 *
 * @example
 * ```ts
 * import { usersQueriesMockFns } from '@sim/testing/mocks/users-queries.mock'
 *
 * usersQueriesMockFns.mockGetUserEmailsByIds.mockResolvedValue(new Map([['user-1', 'ada@example.com']]))
 * ```
 */
export const usersQueriesMockFns = {
  mockGetUserSettings: vi.fn(),
  mockGetUserEmailById: vi.fn(),
  mockGetUserEmailsByIds: vi.fn(),
  mockFindUserEmailsByIds: vi.fn(),
  mockRequireResolvedUserEmail: vi.fn(
    (emailByUserId: ReadonlyMap<string, string>, userId: string): string => {
      const email = emailByUserId.get(userId)
      if (!email) throw new Error(`Unable to resolve email for user ID: ${userId}`)
      return email
    }
  ),
  mockGetRequiredUserEmail: vi.fn(),
  mockGetUserProfile: vi.fn(),
}

/**
 * Static mock module for `@/lib/users/queries`. `defaultUserSettings` carries the real value.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/users/queries', () => usersQueriesMock)
 * ```
 */
export const usersQueriesMock = {
  defaultUserSettings,
  getUserSettings: usersQueriesMockFns.mockGetUserSettings,
  getUserEmailById: usersQueriesMockFns.mockGetUserEmailById,
  getUserEmailsByIds: usersQueriesMockFns.mockGetUserEmailsByIds,
  findUserEmailsByIds: usersQueriesMockFns.mockFindUserEmailsByIds,
  requireResolvedUserEmail: usersQueriesMockFns.mockRequireResolvedUserEmail,
  getRequiredUserEmail: usersQueriesMockFns.mockGetRequiredUserEmail,
  getUserProfile: usersQueriesMockFns.mockGetUserProfile,
}
