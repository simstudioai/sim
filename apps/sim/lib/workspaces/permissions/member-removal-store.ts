import { db } from '@sim/db'
import { member, permissions, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { removeUserFromOrganization } from '@/lib/billing/organizations/membership'
import { reconcileOrganizationSeats } from '@/lib/billing/organizations/seats'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { revokeWorkspaceAccessTx } from '@/lib/workspaces/access/workspace-access'
import { isOrganizationAdminOrOwner } from '@/lib/workspaces/permissions/utils'
import { WorkspaceBillingAccountRemovalError } from '@/lib/workspaces/utils'

const logger = createLogger('WorkspaceMemberRemoval')

/** Removes workspace access and best-effort reconciles the remaining organization membership. */
export async function removeWorkspaceMemberRecord(
  workspaceId: string,
  userId: string,
  actorId: string,
  spareSessionId?: string
) {
  const workspaceRow = await db
    .select({
      ownerId: workspace.ownerId,
      billedAccountUserId: workspace.billedAccountUserId,
      organizationId: workspace.organizationId,
    })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1)

  if (!workspaceRow.length) {
    throw new OrchestrationError('not_found', 'Workspace not found')
  }

  const organizationId = workspaceRow[0].organizationId

  const isSelf = userId === actorId

  if (workspaceRow[0].billedAccountUserId === userId) {
    throw new OrchestrationError(
      'validation',
      'Cannot remove the workspace billing account. Please reassign billing first.'
    )
  }

  /**
   * Organization admins hold workspace admin across the whole organization
   * through `member.role`, not through a `permissions` row, so removal has
   * nothing to revoke. Left to fall through, the two shapes failed in two
   * different ways: with no row it answered "user not found in workspace"
   * about someone listed as an Admin on the very screen the caller clicked
   * from, and with a row it deleted a grant the derived one immediately
   * replaced — while the seat reconciliation below counts rows only, so
   * that no-op could still drop the admin's organization membership.
   *
   * Mirrored by `workspaceMemberRemovalLockReason` on the client, and by the
   * same guard on `PATCH /api/workspaces/[id]/permissions`, which refuses to
   * re-role an organization admin for the same reason.
   */
  if (organizationId && (await isOrganizationAdminOrOwner(userId, organizationId))) {
    throw new OrchestrationError(
      'validation',
      isSelf
        ? 'Organization admins are automatically workspace admins. Change your organization role to leave this workspace.'
        : 'Organization admins are automatically workspace admins. Change their organization role to remove them from this workspace.'
    )
  }

  /** Only an existing collaborator or the workspace owner can be removed. */
  const userPermission = await db
    .select()
    .from(permissions)
    .where(
      and(
        eq(permissions.userId, userId),
        eq(permissions.entityType, 'workspace'),
        eq(permissions.entityId, workspaceId)
      )
    )
    .then((rows) => rows[0])

  const isRemovingWorkspaceOwner = workspaceRow[0].ownerId === userId
  const isOwnerOnlyRemoval = isRemovingWorkspaceOwner && !userPermission

  if (!userPermission && !isOwnerOnlyRemoval) {
    throw new OrchestrationError('not_found', 'User not found in workspace')
  }

  /** An owner removal transfers ownership to the protected billing account in the transaction. */

  /** A non-owner admin cannot leave the workspace without another admin. */
  if (isSelf && userPermission?.permissionType === 'admin' && !isRemovingWorkspaceOwner) {
    const otherAdmins = await db
      .select()
      .from(permissions)
      .where(
        and(
          eq(permissions.entityType, 'workspace'),
          eq(permissions.entityId, workspaceId),
          eq(permissions.permissionType, 'admin')
        )
      )
      .then((rows) => rows.filter((row) => row.userId !== actorId))

    if (otherAdmins.length === 0) {
      throw new OrchestrationError('validation', 'Cannot remove the last admin from a workspace')
    }
  }

  const revocation = await db.transaction(async (tx) => {
    const result = await revokeWorkspaceAccessTx(tx, { workspaceId, userId })
    if (!result.revoked) throw new WorkspaceBillingAccountRemovalError()
    return result
  })
  const { ownershipTransferred } = revocation

  /**
   * Seats are tied to organization membership (one per member), so a
   * single-workspace removal only drops a seat when it leaves the member
   * with no access to any of the org's workspaces — at which point their
   * org membership is removed too. Members still in other org workspaces
   * keep their membership and seat.
   */
  let organizationRemoval = false
  let seatReduction: Awaited<ReturnType<typeof reconcileOrganizationSeats>> | null = null

  let reconciliationPending = false
  try {
    if (organizationId && userId !== workspaceRow[0].billedAccountUserId) {
      const [orgMembership] = await db
        .select({ id: member.id })
        .from(member)
        .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
        .limit(1)

      if (orgMembership) {
        /**
         * Remove the org membership + seat only when this is the member's last
         * access to any org workspace. The remaining-access check and the
         * deletion happen atomically under a `(user, org)` advisory lock inside
         * `removeUserFromOrganization` (`requireNoOrgWorkspaceAccess`), so a
         * concurrent invite acceptance can't be raced into a "workspace access
         * but no org membership" state.
         */
        const removal = await removeUserFromOrganization({
          userId,
          organizationId,
          memberId: orgMembership.id,
          requireNoOrgWorkspaceAccess: true,
          /** Leaving a workspace must not sign the leaver out of Sim. */
          ...(spareSessionId ? { spareSessionId } : {}),
        })

        if (removal.success && removal.removed) {
          organizationRemoval = true
          try {
            seatReduction = await reconcileOrganizationSeats({
              organizationId,
              reason: 'member-removed',
              actorId: actorId,
            })
          } catch (seatError) {
            reconciliationPending = true
            logger.error('Failed to reduce seats after workspace member removal', {
              organizationId,
              workspaceId,
              removedUserId: userId,
              error: seatError,
            })
          }
        } else if (!removal.success) {
          reconciliationPending = true
          logger.error('Failed to remove org membership after last workspace removal', {
            organizationId,
            workspaceId,
            removedUserId: userId,
            error: removal.error,
          })
        }
      }
    }
  } catch (error) {
    reconciliationPending = true
    logger.error('Organization membership needs reconciliation after workspace removal', {
      workspaceId,
      organizationId,
      userId,
      error,
    })
  }
  return {
    success: true as const,
    removedUserId: userId,
    removedUserRole: userPermission?.permissionType ?? 'owner',
    selfRemoval: isSelf,
    ownershipTransferred,
    organizationRemoval,
    seatReduction,
    reconciliationPending,
  }
}
