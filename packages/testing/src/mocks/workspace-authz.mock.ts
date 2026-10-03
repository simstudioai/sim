import { vi } from 'vitest'

type MockPermissionType = 'read' | 'write' | 'admin'

/**
 * Faithful copy of `PERMISSION_RANK` from `@sim/platform-authz/predicates`:
 * read < write < admin.
 */
const PERMISSION_RANK = { read: 1, write: 2, admin: 3 } as const satisfies Record<
  MockPermissionType,
  number
>

const ORG_ADMIN_ROLES = ['owner', 'admin'] as const

function isPermissionType(value: unknown): value is MockPermissionType {
  return typeof value === 'string' && Object.hasOwn(PERMISSION_RANK, value)
}

function permissionSatisfies(
  have: MockPermissionType | string | null | undefined,
  required: MockPermissionType | string
): boolean {
  if (have == null || !isPermissionType(have) || !isPermissionType(required)) return false
  return PERMISSION_RANK[have] >= PERMISSION_RANK[required]
}

function isOrgAdminRole(role: string | null | undefined): boolean {
  return role === 'owner' || role === 'admin'
}

/**
 * Controllable mock functions for `@sim/platform-authz/workspace`.
 *
 * `mockResolveEffectiveWorkspacePermission` resolves `null` (no access) by
 * default. The predicates default to the real read < write < admin semantics;
 * override one with `mockReturnValue` only when a test deliberately bypasses
 * the rank check.
 *
 * @example
 * ```ts
 * import { workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
 *
 * workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue('write')
 * ```
 */
export const workspaceAuthzMockFns = {
  mockResolveEffectiveWorkspacePermission: vi.fn(
    async (
      _userId: string,
      _workspaceId: string,
      _workspaceOrganizationId?: string | null,
      _executor?: unknown,
      _options?: { forUpdate?: boolean }
    ): Promise<MockPermissionType | null> => null
  ),
  mockPermissionSatisfies: vi.fn(permissionSatisfies),
  mockIsPermissionType: vi.fn(isPermissionType),
  mockIsOrgAdminRole: vi.fn(isOrgAdminRole),
}

/**
 * Static mock module for `@sim/platform-authz/workspace` (which also re-exports
 * `@sim/platform-authz/predicates`). Use it for either id.
 *
 * @example
 * ```ts
 * vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
 * ```
 */
export const workspaceAuthzMock = {
  resolveEffectiveWorkspacePermission:
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
  permissionSatisfies: workspaceAuthzMockFns.mockPermissionSatisfies,
  isPermissionType: workspaceAuthzMockFns.mockIsPermissionType,
  isOrgAdminRole: workspaceAuthzMockFns.mockIsOrgAdminRole,
  PERMISSION_RANK,
  ORG_ADMIN_ROLES,
}
