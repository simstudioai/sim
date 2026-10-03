import { vi } from 'vitest'

/** Shape of `UserAccessControlContext` from `@/lib/permission-groups/resolve.server`. */
export interface MockUserAccessControlContext {
  organizationId: string | null
  entitled: boolean
  permissionGroup: {
    id: string
    name: string
    resolution: 'explicit-member' | 'all-members' | 'default'
  } | null
  config: Record<string, unknown> | null
}

/**
 * Controllable mock functions for `@/lib/permission-groups/resolve.server`.
 *
 * Defaults model "no permission group governs this user" (the unrestricted state):
 * every config/group lookup resolves `null`, `isOrganizationPermissionRegimeActive` resolves
 * `false`, `resolveVerifiedUserAccessControlContext` resolves an unentitled context with no group,
 * and `mergeEnvAllowlist` returns its input (the real behavior when no env allowlist is set).
 *
 * @example
 * ```ts
 * import { permissionGroupsResolveMockFns } from '@sim/testing/mocks/permission-groups-resolve.mock'
 *
 * permissionGroupsResolveMockFns.mockGetUserPermissionConfigForOrganization.mockResolvedValue({
 *   ...DEFAULT_PERMISSION_GROUP_CONFIG,
 *   disableMcpTools: true,
 * })
 * ```
 */
export const permissionGroupsResolveMockFns = {
  mockMergeEnvAllowlist: vi.fn(<T>(config: T): T => config),
  mockResolveDefaultGroup: vi.fn(
    async (_organizationId: string, _executor?: unknown): Promise<unknown> => null
  ),
  mockResolveWorkspaceGroup: vi.fn(async (..._args: unknown[]): Promise<unknown> => null),
  mockResolveVerifiedUserAccessControlContext: vi.fn(
    async (..._args: unknown[]): Promise<MockUserAccessControlContext> => ({
      organizationId: null,
      entitled: false,
      permissionGroup: null,
      config: null,
    })
  ),
  mockGetUserPermissionConfig: vi.fn(async (..._args: unknown[]): Promise<unknown> => null),
  mockGetUserPermissionConfigForOrganization: vi.fn(
    async (..._args: unknown[]): Promise<unknown> => null
  ),
  mockIsOrganizationPermissionRegimeActive: vi.fn(
    async (..._args: unknown[]): Promise<boolean> => false
  ),
  mockGetEntitledOrganizationPermissionConfig: vi.fn(
    async (..._args: unknown[]): Promise<unknown> => null
  ),
}

/**
 * Static mock module for `@/lib/permission-groups/resolve.server`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/permission-groups/resolve.server', () => permissionGroupsResolveMock)
 * ```
 */
export const permissionGroupsResolveMock = {
  mergeEnvAllowlist: permissionGroupsResolveMockFns.mockMergeEnvAllowlist,
  resolveDefaultGroup: permissionGroupsResolveMockFns.mockResolveDefaultGroup,
  resolveWorkspaceGroup: permissionGroupsResolveMockFns.mockResolveWorkspaceGroup,
  resolveVerifiedUserAccessControlContext:
    permissionGroupsResolveMockFns.mockResolveVerifiedUserAccessControlContext,
  getUserPermissionConfig: permissionGroupsResolveMockFns.mockGetUserPermissionConfig,
  getUserPermissionConfigForOrganization:
    permissionGroupsResolveMockFns.mockGetUserPermissionConfigForOrganization,
  isOrganizationPermissionRegimeActive:
    permissionGroupsResolveMockFns.mockIsOrganizationPermissionRegimeActive,
  getEntitledOrganizationPermissionConfig:
    permissionGroupsResolveMockFns.mockGetEntitledOrganizationPermissionConfig,
}
