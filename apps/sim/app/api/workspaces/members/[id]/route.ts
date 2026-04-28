import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { permissionGroupMember, permissions, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { revokeWorkspaceCredentialMembershipsTx } from '@/lib/credentials/access'
import { captureServerEvent } from '@/lib/posthog/server'
import { hasWorkspaceAdminAccess } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('WorkspaceMemberAPI')
const deleteMemberSchema = z.object({
  workspaceId: z.string().uuid(),
})

// DELETE /api/workspaces/members/[id] - Remove a member from a workspace
export const DELETE = withRouteHandler(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id: userId } = await params
    const session = await getSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    try {
      // Get the workspace ID from the request body or URL
      const body = deleteMemberSchema.parse(await req.json())
      const { workspaceId } = body

      const workspaceRow = await db
        .select({
          ownerId: workspace.ownerId,
          billedAccountUserId: workspace.billedAccountUserId,
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

      if (
        isRemovingWorkspaceOwner &&
        !isSelf &&
        session.user.id !== workspaceRow[0].billedAccountUserId
      ) {
        return NextResponse.json(
          { error: 'Only the workspace owner or billing account can remove the workspace owner' },
          { status: 403 }
        )
      }

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

      const ownershipTransferred = await db.transaction(async (tx) => {
        let didTransferOwnership = false

        if (isRemovingWorkspaceOwner) {
          /**
           * Invariant: the billed account is the org owner for org workspaces,
           * the owner for personal workspaces, and a workspace admin for
           * grandfathered shared workspaces.
           */
          const newOwnerId = workspaceRow[0].billedAccountUserId

          await tx
            .update(workspace)
            .set({ ownerId: newOwnerId, updatedAt: new Date() })
            .where(eq(workspace.id, workspaceId))

          const [existingNewOwnerPermission] = await tx
            .select({ id: permissions.id })
            .from(permissions)
            .where(
              and(
                eq(permissions.userId, newOwnerId),
                eq(permissions.entityType, 'workspace'),
                eq(permissions.entityId, workspaceId)
              )
            )
            .limit(1)

          if (existingNewOwnerPermission) {
            await tx
              .update(permissions)
              .set({ permissionType: 'admin', updatedAt: new Date() })
              .where(eq(permissions.id, existingNewOwnerPermission.id))
          } else {
            const now = new Date()
            await tx.insert(permissions).values({
              id: generateId(),
              userId: newOwnerId,
              entityType: 'workspace',
              entityId: workspaceId,
              permissionType: 'admin',
              createdAt: now,
              updatedAt: now,
            })
          }

          didTransferOwnership = true
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

        await tx
          .delete(permissionGroupMember)
          .where(
            and(
              eq(permissionGroupMember.userId, userId),
              eq(permissionGroupMember.workspaceId, workspaceId)
            )
          )

        return didTransferOwnership
      })

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
        description: isSelf ? 'Left the workspace' : `Removed member ${userId} from the workspace`,
        metadata: {
          removedUserId: userId,
          removedUserRole: userPermission?.permissionType ?? 'owner',
          selfRemoval: isSelf,
          ownershipTransferred,
        },
        request: req,
      })

      return NextResponse.json({ success: true })
    } catch (error) {
      logger.error('Error removing workspace member:', error)
      return NextResponse.json({ error: 'Failed to remove workspace member' }, { status: 500 })
    }
  }
)
