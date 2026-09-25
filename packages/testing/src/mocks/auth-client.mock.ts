import { vi } from 'vitest'

const mockRefetchSession = vi.fn(async (): Promise<void> => {})

const mockSignOut = vi.fn()

/**
 * Stand-in for the Better Auth `client` from `@/lib/auth/auth-client`: every endpoint the app
 * calls is a bare `vi.fn()` (resolves `undefined` when awaited), grouped exactly like the real
 * client (`client.organization.setActive`, `client.oauth2.link`, …). `client.signOut` is the same
 * `vi.fn()` as the module-level `signOut` export, mirroring `const { signOut } = client`.
 */
const client = {
  getSession: vi.fn(),
  signOut: mockSignOut,
  signIn: { email: vi.fn(), social: vi.fn(), sso: vi.fn() },
  signUp: { email: vi.fn() },
  emailOtp: { verifyEmail: vi.fn(), sendVerificationOtp: vi.fn() },
  oauth2: { link: vi.fn(), consent: vi.fn(), publicClientPrelogin: vi.fn() },
  organization: {
    list: vi.fn(),
    setActive: vi.fn(),
    getFullOrganization: vi.fn(),
  },
  admin: {
    listUsers: vi.fn(),
    getUser: vi.fn(),
    createUser: vi.fn(),
    setRole: vi.fn(),
    banUser: vi.fn(),
    unbanUser: vi.fn(),
    impersonateUser: vi.fn(),
    stopImpersonating: vi.fn(),
  },
  subscription: { list: vi.fn(), upgrade: vi.fn(), cancel: vi.fn(), restore: vi.fn() },
  useActiveOrganization: vi.fn(() => ({ data: undefined, isPending: false, error: null })),
}

/**
 * Controllable mock functions for `@/lib/auth/auth-client`.
 *
 * Defaults:
 * - `mockUseSession` returns a signed-out session: `{ data: null, isPending: false, error: null,
 *   refetch: mockRefetchSession }` (`mockRefetchSession` resolves `undefined`).
 * - `mockUseActiveOrganization` returns `{ data: undefined, isPending: false, error: null }` (the
 *   real organizations-disabled result).
 * - `mockUseSubscription` returns the `client.subscription` `vi.fn()`s (`list`/`upgrade`/`cancel`/
 *   `restore`), like the real hook.
 * - `mockClient` is the whole client object (every endpoint a bare `vi.fn()`), and `mockSignOut`
 *   is both `signOut` and `client.signOut`.
 *
 * @example
 * ```ts
 * import { authClientMockFns } from '@sim/testing/mocks/auth-client.mock'
 *
 * authClientMockFns.mockUseSession.mockReturnValue({ data: { user: { id: 'user-1' } }, isPending: false })
 * authClientMockFns.mockClient.getSession.mockResolvedValue({ data: null })
 * ```
 */
export const authClientMockFns = {
  mockClient: client,
  mockSignOut,
  mockRefetchSession,
  mockUseSession: vi.fn((): unknown => ({
    data: null,
    isPending: false,
    error: null,
    refetch: mockRefetchSession,
  })),
  mockUseActiveOrganization: client.useActiveOrganization,
  mockUseSubscription: vi.fn(() => ({
    list: client.subscription.list,
    upgrade: client.subscription.upgrade,
    cancel: client.subscription.cancel,
    restore: client.subscription.restore,
  })),
}

/**
 * Static mock module for `@/lib/auth/auth-client`. Covers every runtime export (`client`,
 * `useSession`, `useActiveOrganization`, `useSubscription`, `signOut`).
 *
 * @example
 * ```ts
 * vi.mock('@/lib/auth/auth-client', () => authClientMock)
 * ```
 */
export const authClientMock = {
  client,
  signOut: mockSignOut,
  useSession: authClientMockFns.mockUseSession,
  useActiveOrganization: authClientMockFns.mockUseActiveOrganization,
  useSubscription: authClientMockFns.mockUseSubscription,
}
