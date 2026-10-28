import { vi } from 'vitest'

/**
 * Mirrors `ForkError` from `@/ee/workspace-forking/lib/lineage/authz`: same `name` (`'ForkError'`),
 * constructor `(message, statusCode = 400)` and `statusCode` field. It does NOT extend the real
 * `HttpError` (the mock cannot import app code), so `withRouteHandler`'s `instanceof HttpError`
 * projection treats it as an unknown error; `instanceof ForkError` against the mocked module works.
 */
export class MockForkError extends Error {
  readonly statusCode: number

  constructor(message: string, statusCode = 400) {
    super(message)
    this.name = 'ForkError'
    this.statusCode = statusCode
  }
}

/**
 * Controllable mock functions for `@/ee/workspace-forking/lib/lineage/authz`.
 *
 * Every function is a bare `vi.fn()` (resolves `undefined` when awaited): `assertForkingEnabled`
 * therefore passes the gate by default, and `isForkingAvailableForWorkspace` must be set when a
 * test reads its verdict.
 *
 * @example
 * ```ts
 * import { MockForkError, workspaceForkingAuthzMockFns } from '@sim/testing/mocks/workspace-forking-authz.mock'
 *
 * workspaceForkingAuthzMockFns.mockAssertForkingEnabled.mockRejectedValue(new MockForkError('Not enabled', 404))
 * workspaceForkingAuthzMockFns.mockIsForkingAvailableForWorkspace.mockResolvedValue(true)
 * ```
 */
export const workspaceForkingAuthzMockFns = {
  mockAssertForkingEnabled: vi.fn(),
  mockIsForkingAvailableForWorkspace: vi.fn(),
  mockAssertWorkspaceAdminAccess: vi.fn(),
  mockAssertCanFork: vi.fn(),
  mockAssertCanPromote: vi.fn(),
  mockAssertCanRollback: vi.fn(),
  mockAssertCanUnlink: vi.fn(),
}

/**
 * Static mock module for `@/ee/workspace-forking/lib/lineage/authz`. Covers every runtime export;
 * `ForkError` is {@link MockForkError}.
 *
 * @example
 * ```ts
 * vi.mock('@/ee/workspace-forking/lib/lineage/authz', () => workspaceForkingAuthzMock)
 * ```
 */
export const workspaceForkingAuthzMock = {
  ForkError: MockForkError,
  assertForkingEnabled: workspaceForkingAuthzMockFns.mockAssertForkingEnabled,
  isForkingAvailableForWorkspace: workspaceForkingAuthzMockFns.mockIsForkingAvailableForWorkspace,
  assertWorkspaceAdminAccess: workspaceForkingAuthzMockFns.mockAssertWorkspaceAdminAccess,
  assertCanFork: workspaceForkingAuthzMockFns.mockAssertCanFork,
  assertCanPromote: workspaceForkingAuthzMockFns.mockAssertCanPromote,
  assertCanRollback: workspaceForkingAuthzMockFns.mockAssertCanRollback,
  assertCanUnlink: workspaceForkingAuthzMockFns.mockAssertCanUnlink,
}
