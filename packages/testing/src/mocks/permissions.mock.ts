import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/workspaces/permissions/utils`.
 *
 * @example
 * ```ts
 * import { permissionsMockFns } from '@sim/testing'
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
  mockCheckWorkspaceAccess: vi.fn(),
  mockAssertActiveWorkspaceAccess: vi.fn(),
  mockGetUserEntityPermissions: vi.fn(),
  mockHasAdminPermission: vi.fn(),
  mockGetUsersWithPermissions: vi.fn(),
  mockGetWorkspaceMemberProfiles: vi.fn(),
  mockHasWorkspaceAdminAccess: vi.fn(),
  mockGetManageableWorkspaces: vi.fn(),
}

/**
 * Static mock module for `@/lib/workspaces/permissions/utils`.
 * Defaults resolve to "allowed" state for safe test defaults.
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
  checkWorkspaceAccess: permissionsMockFns.mockCheckWorkspaceAccess,
  assertActiveWorkspaceAccess: permissionsMockFns.mockAssertActiveWorkspaceAccess,
  getUserEntityPermissions: permissionsMockFns.mockGetUserEntityPermissions,
  hasAdminPermission: permissionsMockFns.mockHasAdminPermission,
  getUsersWithPermissions: permissionsMockFns.mockGetUsersWithPermissions,
  getWorkspaceMemberProfiles: permissionsMockFns.mockGetWorkspaceMemberProfiles,
  hasWorkspaceAdminAccess: permissionsMockFns.mockHasWorkspaceAdminAccess,
  getManageableWorkspaces: permissionsMockFns.mockGetManageableWorkspaces,
}
