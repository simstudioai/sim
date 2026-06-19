import { db } from '@sim/db'
import { member, permissions } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { isOrgAdminRole, type PermissionType } from './predicates'

export * from './predicates'

/**
 * Resolves the effective workspace permission under the governance inheritance
 * model: the workspace owner and the owners/admins of the organization that owns
 * the workspace are workspace admins. Returns the higher of any explicit grant
 * and any derived admin.
 *
 * Single source of truth for workspace-permission resolution, shared by the Next
 * app (`getEffectiveWorkspacePermission`) and the realtime server (via the
 * `/workflow` entry). Lives in a package because `apps/realtime` needs it and
 * packages may not import app code.
 */
export async function resolveEffectiveWorkspacePermission(
  userId: string,
  workspaceId: string,
  workspaceOwnerId: string,
  workspaceOrganizationId: string | null
): Promise<PermissionType | null> {
  if (workspaceOwnerId === userId) {
    return 'admin'
  }

  const [permissionRow] = await db
    .select({ permissionType: permissions.permissionType })
    .from(permissions)
    .where(
      and(
        eq(permissions.userId, userId),
        eq(permissions.entityType, 'workspace'),
        eq(permissions.entityId, workspaceId)
      )
    )
    .limit(1)

  const explicit = (permissionRow?.permissionType as PermissionType | undefined) ?? null

  if (workspaceOrganizationId && explicit !== 'admin') {
    const [memberRow] = await db
      .select({ role: member.role })
      .from(member)
      .where(and(eq(member.userId, userId), eq(member.organizationId, workspaceOrganizationId)))
      .limit(1)
    if (isOrgAdminRole(memberRow?.role)) {
      return 'admin'
    }
  }

  return explicit
}
