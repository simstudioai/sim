import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { member, permissions, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { removeWorkspaceMemberContract } from '@/lib/api/contracts/invitations'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { removeUserFromOrganization } from '@/lib/billing/organizations/membership'
import { reconcileOrganizationSeats } from '@/lib/billing/organizations/seats'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { revokeWorkspaceCredentialMembershipsTx } from '@/lib/credentials/access'
import { captureServerEvent } from '@/lib/posthog/server'
import { removeWorkspaceSkillMembershipsTx } from '@/lib/skills/access'
import { hasWorkspaceAdminAccess } from '@/lib/workspaces/permissions/utils'
import {
  reassignWorkflowOwnershipForWorkspaceMemberRemovalTx,
  transferWorkspaceOwnershipToBilledAccountForMemberRemovalTx,
  WorkspaceBillingAccountRemovalError,
} from '@/lib/workspaces/utils'

const logger = createLogger('WorkspaceMemberAPI')

// DELETE /api/workspaces/members/[id] - Remove a member from a workspace
export const DELETE = withRouteHandler(
  async (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const session = await getSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    try {
      const parsed = await parseRequest(removeWorkspaceMemberContract, req, context)
      if (!parsed.success) return parsed.response
      const { id: userId } = parsed.data.params
      const { workspaceId } = parsed.data.body

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
        return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
      }

      if (workspaceRow[0].billedAccountUserId === userId) {
        return NextResponse.json(
          { error: 'Cannot remove the workspace billing account. Please reassign billing first.' },
          { status: 400 }
        )
      }

      // Check if the user to be removed actually has permissions for this workspace
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
        return NextResponse.json({ error: 'User not found in workspace' }, { status: 404 })
      }

      // Check if current user has admin access to this workspace
      const hasAdminAccess = await hasWorkspaceAdminAccess(session.user.id, workspaceId)
      const isSelf = userId === session.user.id

      if (!hasAdminAccess && !isSelf) {
        return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
      }

      // Removing the workspace owner is allowed for any admin: ownership transfers
      // to the billing account in the transaction below. The billing account itself
      // stays protected by the guard above (and personal workspaces, where owner ==
      // billing account, are blocked there).

      // Prevent removing yourself if you're the last admin
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
          .then((rows) => rows.filter((row) => row.userId !== session.user.id))

        if (otherAdmins.length === 0) {
          return NextResponse.json(
            { error: 'Cannot remove the last admin from a workspace' },
            { status: 400 }
          )
        }
      }

      const organizationId = workspaceRow[0].organizationId

      const { ownershipTransferred, workflowOwnershipReassignment } = await db.transaction(
        async (tx) => {
          const didTransferOwnership =
            await transferWorkspaceOwnershipToBilledAccountForMemberRemovalTx({
              tx,
              workspaceId,
              departingUserId: userId,
            })

          const workflowOwnershipReassignment =
            await reassignWorkflowOwnershipForWorkspaceMemberRemovalTx({
              tx,
              workspaceIds: [workspaceId],
              departingUserId: userId,
            })
          if (workflowOwnershipReassignment.unresolved.length > 0) {
            throw new WorkspaceBillingAccountRemovalError()
          }

          await tx
            .delete(permissions)
            .where(
              and(
                eq(permissions.userId, userId),
                eq(permissions.entityType, 'workspace'),
                eq(permissions.entityId, workspaceId)
              )
            )

          await revokeWorkspaceCredentialMembershipsTx(tx, workspaceId, userId)
          await removeWorkspaceSkillMembershipsTx(tx, workspaceId, userId)

          return { ownershipTransferred: didTransferOwnership, workflowOwnershipReassignment }
        }
      )

      /**
       * Seats are tied to organization membership (one per member), so a
       * single-workspace removal only drops a seat when it leaves the member
       * with no access to any of the org's workspaces — at which point their
       * org membership is removed too. Members still in other org workspaces
       * keep their membership and seat.
       */
      let organizationRemoval = false
      let seatReduction: Awaited<ReturnType<typeof reconcileOrganizationSeats>> | null = null

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
          })

          if (removal.success && removal.removed) {
            organizationRemoval = true
            try {
              seatReduction = await reconcileOrganizationSeats({
                organizationId,
                reason: 'member-removed',
                actorId: session.user.id,
              })
            } catch (seatError) {
              logger.error('Failed to reduce seats after workspace member removal', {
                organizationId,
                workspaceId,
                removedUserId: userId,
                error: seatError,
              })
            }
          } else if (!removal.success) {
            logger.error('Failed to remove org membership after last workspace removal', {
              organizationId,
              workspaceId,
              removedUserId: userId,
              error: removal.error,
            })
          }
        }
      }

      captureServerEvent(
        session.user.id,
        'workspace_member_removed',
        { workspace_id: workspaceId, is_self_removal: isSelf },
        { groups: { workspace: workspaceId } }
      )

      recordAudit({
        workspaceId,
        actorId: session.user.id,
        actorName: session.user.name,
        actorEmail: session.user.email,
        action: AuditAction.MEMBER_REMOVED,
        resourceType: AuditResourceType.WORKSPACE,
        resourceId: workspaceId,
        description: isSelf
          ? organizationRemoval
            ? 'Left the organization'
            : 'Left the workspace'
          : organizationRemoval
            ? `Removed member ${userId} from the organization`
            : `Removed member ${userId} from the workspace`,
        metadata: {
          removedUserId: userId,
          removedUserRole: userPermission?.permissionType ?? 'owner',
          selfRemoval: isSelf,
          ownershipTransferred,
          workflowOwnershipReassignment,
          organizationRemoval,
          seatReduction,
        },
        request: req,
      })

      return NextResponse.json({ success: true })
    } catch (error) {
      if (error instanceof WorkspaceBillingAccountRemovalError) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      logger.error('Error removing workspace member:', error)
      return NextResponse.json({ error: 'Failed to remove workspace member' }, { status: 500 })
    }
  }
)
