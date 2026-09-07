import { permissions } from '@sim/db/schema'
import type { PermissionType } from '@sim/platform-authz/workspace'
import { generateId } from '@sim/utils/id'
import { and, eq } from 'drizzle-orm'
import { revokeWorkspaceCredentialMembershipsTx } from '@/lib/credentials/access'
import type { DbOrTx } from '@/lib/db/types'
import { removeWorkspaceSkillMembershipsTx } from '@/lib/skills/access'
import { reassignWorkflowOwnershipForWorkspaceMemberRemovalTx } from '@/lib/workspaces/utils'

/**
 * Workspace access as a shared domain primitive.
 *
 * The permission row is only part of the story — removing someone also has to
 * reassign what they own and drop the credential and skill memberships that
 * dangle otherwise. That sequence lived inline in the members route; directory
 * deprovisioning needs the same one, and a second copy is where the two would
 * drift.
 */

/** Ordering used to decide whether an existing grant already suffices. */
const PERMISSION_RANK: Record<PermissionType, number> = { read: 1, write: 2, admin: 3 }

export function permissionRank(permission: PermissionType): number {
  return PERMISSION_RANK[permission]
}

export type GrantWorkspaceAccessOutcome = 'granted' | 'raised' | 'unchanged'

/**
 * Grants a user access to a workspace, never lowering an existing grant.
 *
 * A directory group says what access someone should have at minimum. Someone
 * who was deliberately promoted to workspace admin should not be demoted by the
 * next sync of a group that grants write.
 */
export async function grantWorkspaceAccessTx(
  tx: DbOrTx,
  params: { workspaceId: string; userId: string; permission: PermissionType }
): Promise<GrantWorkspaceAccessOutcome> {
  const [existing] = await tx
    .select({ id: permissions.id, permissionType: permissions.permissionType })
    .from(permissions)
    .where(
      and(
        eq(permissions.userId, params.userId),
        eq(permissions.entityType, 'workspace'),
        eq(permissions.entityId, params.workspaceId)
      )
    )
    .limit(1)
    .for('update')

  if (!existing) {
    await tx.insert(permissions).values({
      id: generateId(),
      userId: params.userId,
      entityType: 'workspace',
      entityId: params.workspaceId,
      permissionType: params.permission,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    return 'granted'
  }

  if (permissionRank(existing.permissionType) >= permissionRank(params.permission)) {
    return 'unchanged'
  }

  await tx
    .update(permissions)
    .set({ permissionType: params.permission, updatedAt: new Date() })
    .where(eq(permissions.id, existing.id))
  return 'raised'
}

export interface RevokeWorkspaceAccessResult {
  revoked: boolean
  /** Workflows whose owner could not be reassigned, which blocks the removal. */
  unresolvedWorkflows: string[]
}

/**
 * Removes a user's access to one workspace and everything that hangs off it.
 *
 * Ownership reassignment runs first and can fail: a workflow whose owner cannot
 * be moved would be orphaned by the delete, so the caller is expected to treat
 * an unresolved list as a refusal rather than proceeding.
 */
export async function revokeWorkspaceAccessTx(
  tx: DbOrTx,
  params: { workspaceId: string; userId: string }
): Promise<RevokeWorkspaceAccessResult> {
  const reassignment = await reassignWorkflowOwnershipForWorkspaceMemberRemovalTx({
    tx,
    workspaceIds: [params.workspaceId],
    departingUserId: params.userId,
  })
  if (reassignment.unresolved.length > 0) {
    return { revoked: false, unresolvedWorkflows: reassignment.unresolved }
  }

  const deleted = await tx
    .delete(permissions)
    .where(
      and(
        eq(permissions.userId, params.userId),
        eq(permissions.entityType, 'workspace'),
        eq(permissions.entityId, params.workspaceId)
      )
    )
    .returning({ id: permissions.id })

  await revokeWorkspaceCredentialMembershipsTx(tx, params.workspaceId, params.userId)
  await removeWorkspaceSkillMembershipsTx(tx, params.workspaceId, params.userId)

  return { revoked: deleted.length > 0, unresolvedWorkflows: [] }
}

/** The permission a user currently holds on a workspace, if any. */
export async function readWorkspacePermission(
  tx: DbOrTx,
  params: { workspaceId: string; userId: string }
): Promise<PermissionType | null> {
  const [row] = await tx
    .select({ permissionType: permissions.permissionType })
    .from(permissions)
    .where(
      and(
        eq(permissions.userId, params.userId),
        eq(permissions.entityType, 'workspace'),
        eq(permissions.entityId, params.workspaceId)
      )
    )
    .limit(1)
  return row?.permissionType ?? null
}
