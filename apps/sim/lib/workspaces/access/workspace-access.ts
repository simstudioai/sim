import { permissions } from '@sim/db/schema'
import type { PermissionType } from '@sim/platform-authz/workspace'
import { generateId } from '@sim/utils/id'
import { and, eq } from 'drizzle-orm'
import { revokeWorkspaceCredentialMembershipsTx } from '@/lib/credentials/access'
import type { DbOrTx } from '@/lib/db/types'
import { removeWorkspaceSkillMembershipsTx } from '@/lib/skills/access'
import {
  reassignWorkflowOwnershipForWorkspaceMemberRemovalTx,
  transferWorkspaceOwnershipToBilledAccountForMemberRemovalTx,
  WorkspaceBillingAccountRemovalError,
} from '@/lib/workspaces/utils'

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
  /**
   * Insert first and let the unique index on (user, entity) decide. A read
   * followed by an insert would let two concurrent grants both see "absent" and
   * one of them fail on the index; this way the loser falls through to the
   * comparison below against the row that won.
   */
  const inserted = await tx
    .insert(permissions)
    .values({
      id: generateId(),
      userId: params.userId,
      entityType: 'workspace',
      entityId: params.workspaceId,
      permissionType: params.permission,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoNothing()
    .returning({ id: permissions.id })
  if (inserted.length > 0) return 'granted'

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
  if (!existing) return 'unchanged'

  if (permissionRank(existing.permissionType) >= permissionRank(params.permission)) {
    return 'unchanged'
  }

  await tx
    .update(permissions)
    .set({ permissionType: params.permission, updatedAt: new Date() })
    .where(eq(permissions.id, existing.id))
  return 'raised'
}

/**
 * Lowers a grant, but only from the level a previous automated grant set.
 *
 * A directory mapping edited from admin down to write must take effect, yet a
 * person a workspace administrator deliberately promoted must not be demoted by
 * it. The caller passes the level it last set; if the row no longer matches,
 * someone else raised it and the lowering is skipped.
 */
export async function lowerWorkspaceAccessTx(
  tx: DbOrTx,
  params: { workspaceId: string; userId: string; from: PermissionType; to: PermissionType }
): Promise<'lowered' | 'unchanged'> {
  const updated = await tx
    .update(permissions)
    .set({ permissionType: params.to, updatedAt: new Date() })
    .where(
      and(
        eq(permissions.userId, params.userId),
        eq(permissions.entityType, 'workspace'),
        eq(permissions.entityId, params.workspaceId),
        eq(permissions.permissionType, params.from)
      )
    )
    .returning({ id: permissions.id })
  return updated.length > 0 ? 'lowered' : 'unchanged'
}

export type RevokeWorkspaceAccessResult =
  /** `ownershipTransferred` is true when the departing user owned the workspace and it moved to the billed account. */
  | { revoked: true; ownershipTransferred: boolean }
  /** Workflows whose owner could not be reassigned; the access row is left in place. */
  | { revoked: false; reason: 'unresolved-workflows'; unresolvedWorkflows: string[] }
  /** The user owns the workspace and it has no billed account to hand it to. */
  | { revoked: false; reason: 'workspace-owner-without-successor' }

/**
 * Removes a user's access to one workspace and everything that hangs off it.
 *
 * Ownership moves first, in the same order the members route uses: the workspace
 * itself to its billed account when the departing user owns it, then every
 * workflow they own to a remaining member. Either can fail, and a failure is a
 * refusal rather than a partial removal — deleting the access row would orphan
 * what could not be moved.
 */
export async function revokeWorkspaceAccessTx(
  tx: DbOrTx,
  params: { workspaceId: string; userId: string }
): Promise<RevokeWorkspaceAccessResult> {
  let ownershipTransferred: boolean
  try {
    ownershipTransferred = await transferWorkspaceOwnershipToBilledAccountForMemberRemovalTx({
      tx,
      workspaceId: params.workspaceId,
      departingUserId: params.userId,
    })
  } catch (error) {
    if (error instanceof WorkspaceBillingAccountRemovalError) {
      return { revoked: false, reason: 'workspace-owner-without-successor' }
    }
    throw error
  }

  const reassignment = await reassignWorkflowOwnershipForWorkspaceMemberRemovalTx({
    tx,
    workspaceIds: [params.workspaceId],
    departingUserId: params.userId,
  })
  if (reassignment.unresolved.length > 0) {
    return {
      revoked: false,
      reason: 'unresolved-workflows',
      unresolvedWorkflows: reassignment.unresolved,
    }
  }

  await tx
    .delete(permissions)
    .where(
      and(
        eq(permissions.userId, params.userId),
        eq(permissions.entityType, 'workspace'),
        eq(permissions.entityId, params.workspaceId)
      )
    )

  await revokeWorkspaceCredentialMembershipsTx(tx, params.workspaceId, params.userId)
  await removeWorkspaceSkillMembershipsTx(tx, params.workspaceId, params.userId)

  return { revoked: true, ownershipTransferred }
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
