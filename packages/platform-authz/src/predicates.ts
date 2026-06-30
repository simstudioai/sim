import type { permissionTypeEnum } from '@sim/db/schema'

/** Workspace permission level: read < write < admin. */
export type PermissionType = (typeof permissionTypeEnum.enumValues)[number]

/** Total ordering of workspace permission levels: read < write < admin. */
export const PERMISSION_RANK = { read: 1, write: 2, admin: 3 } as const satisfies Record<
  PermissionType,
  number
>

/**
 * Whether an effective permission satisfies a required level under the
 * read < write < admin ordering. `null`/`undefined` (no access) never satisfies.
 * Single source of truth for permission-level comparisons across the app and the
 * realtime server — replaces the hand-written `=== 'admin' || === 'write'` ladders.
 */
export function permissionSatisfies(
  have: PermissionType | null | undefined,
  required: PermissionType
): boolean {
  return have != null && PERMISSION_RANK[have] >= PERMISSION_RANK[required]
}

/** Organization membership roles (Better Auth) that confer admin authority. */
export const ORG_ADMIN_ROLES = ['owner', 'admin'] as const

/**
 * Whether an organization membership role is owner/admin. Owner/admin org roles
 * are derived workspace admins on the org's workspaces — single source of truth
 * for the `role === 'owner' || role === 'admin'` predicate, shared by server
 * resolvers and client UIs. Dependency-free (the only import is a type, which is
 * erased) so client bundles can import it without pulling in the DB client.
 */
export function isOrgAdminRole(role: string | null | undefined): boolean {
  return role === 'owner' || role === 'admin'
}
