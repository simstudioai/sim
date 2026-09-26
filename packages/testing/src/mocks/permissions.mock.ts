import { vi } from 'vitest'

/**
 * Mirrors `WorkspaceAccessDeniedError` from `@/lib/workspaces/permissions/utils`: same `name`,
 * `statusCode` and `workspaceId`, so `instanceof` against the mocked export and the default
 * {@link permissionsMock.isWorkspaceAccessDeniedError} guard behave like production. It does NOT
 * extend the real `HttpError` (the mock cannot import app code), so `withRouteHandler`'s
 * `instanceof HttpError` projection treats it as an unknown error.
 */
export class MockWorkspaceAccessDeniedError extends Error {
  readonly statusCode = 403
  readonly workspaceId: string

  constructor(workspaceId: string) {
    super(`Workspace access denied: ${workspaceId}`)
    this.name = 'WorkspaceAccessDeniedError'
    this.workspaceId = workspaceId
  }
}

interface MockProvidedWorkspaceAccess {
  workspace?: { id?: string } | null
}

const mockCheckWorkspaceAccess = vi.fn()

/**
 * Controllable mock functions for `@/lib/workspaces/permissions/utils`.
 *
 * Every loader is a bare `vi.fn()` (resolves `undefined`) except:
 * - `mockResolveWorkspaceAccess` reuses `provided` when it was resolved for the same workspace,
 *   otherwise delegates to `mockCheckWorkspaceAccess` (the real reuse rule).
 * - `mockIsWorkspaceAccessDeniedError` matches any `Error` named `WorkspaceAccessDeniedError`
 *   (including {@link MockWorkspaceAccessDeniedError}).
 *
 * @example
 * ```ts
 * import { permissionsMockFns } from '@sim/testing/mocks/permissions.mock'
 *
 * permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValue({
 *   exists: true, hasAccess: true, canWrite: true, workspace: { id: 'ws-1', name: 'Test', ownerId: 'user-1' },
 * })
 * ```
 */
export const permissionsMockFns = {
  mockWorkspaceExists: vi.fn(),
  mockGetWorkspaceById: vi.fn(),
  mockGetWorkspaceWithOwner: vi.fn(),
  mockGetEffectiveWorkspacePermission: vi.fn(),
  mockCheckWorkspaceAccess,
  mockResolveWorkspaceAccess: vi.fn(
    async (workspaceId: string, userId: string, provided?: MockProvidedWorkspaceAccess) =>
      provided && provided.workspace?.id === workspaceId
        ? provided
        : mockCheckWorkspaceAccess(workspaceId, userId)
  ),
  mockAssertActiveWorkspaceAccess: vi.fn(),
  mockIsWorkspaceAccessDeniedError: vi.fn(
    (error: unknown): boolean =>
      error instanceof Error && error.name === 'WorkspaceAccessDeniedError'
  ),
  mockGetUserEntityPermissions: vi.fn(),
  mockGetUsersWithPermissions: vi.fn(),
  mockGetWorkspaceMemberProfiles: vi.fn(),
  mockGetWorkspacePermissionsForAuthorizedViewer: vi.fn(),
  mockGetWorkspacePermissionsForViewer: vi.fn(),
  mockHasWorkspaceAdminAccess: vi.fn(),
  mockIsOrganizationAdminOrOwner: vi.fn(),
  mockIsOrganizationMember: vi.fn(),
  mockGetManageableWorkspaces: vi.fn(),
}

/**
 * Static mock module for `@/lib/workspaces/permissions/utils`. Covers every runtime export.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
 * ```
 */
export const permissionsMock = {
  workspaceExists: permissionsMockFns.mockWorkspaceExists,
  getWorkspaceById: permissionsMockFns.mockGetWorkspaceById,
  getWorkspaceWithOwner: permissionsMockFns.mockGetWorkspaceWithOwner,
  getEffectiveWorkspacePermission: permissionsMockFns.mockGetEffectiveWorkspacePermission,
  checkWorkspaceAccess: permissionsMockFns.mockCheckWorkspaceAccess,
  resolveWorkspaceAccess: permissionsMockFns.mockResolveWorkspaceAccess,
  assertActiveWorkspaceAccess: permissionsMockFns.mockAssertActiveWorkspaceAccess,
  isWorkspaceAccessDeniedError: permissionsMockFns.mockIsWorkspaceAccessDeniedError,
  WorkspaceAccessDeniedError: MockWorkspaceAccessDeniedError,
  getUserEntityPermissions: permissionsMockFns.mockGetUserEntityPermissions,
  getUsersWithPermissions: permissionsMockFns.mockGetUsersWithPermissions,
  getWorkspaceMemberProfiles: permissionsMockFns.mockGetWorkspaceMemberProfiles,
  getWorkspacePermissionsForAuthorizedViewer:
    permissionsMockFns.mockGetWorkspacePermissionsForAuthorizedViewer,
  getWorkspacePermissionsForViewer: permissionsMockFns.mockGetWorkspacePermissionsForViewer,
  hasWorkspaceAdminAccess: permissionsMockFns.mockHasWorkspaceAdminAccess,
  isOrganizationAdminOrOwner: permissionsMockFns.mockIsOrganizationAdminOrOwner,
  isOrganizationMember: permissionsMockFns.mockIsOrganizationMember,
  getManageableWorkspaces: permissionsMockFns.mockGetManageableWorkspaces,
}
