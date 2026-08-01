/**
 * GET /api/v1/admin/workspaces/[id]/members/[memberId]
 *
 * Get workspace member details.
 *
 * Response: AdminSingleResponse<AdminWorkspaceMember>
 *
 * PATCH /api/v1/admin/workspaces/[id]/members/[memberId]
 *
 * Update member permissions.
 *
 * Body:
 *   - permissions: 'admin' | 'write' | 'read' - New permission level
 *
 * Response: AdminSingleResponse<AdminWorkspaceMember>
 *
 * DELETE /api/v1/admin/workspaces/[id]/members/[memberId]
 *
 * Remove member from workspace.
 *
 * Response: AdminSingleResponse<{ removed: true, memberId: string, userId: string }>
 */

import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { permissions, user, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import {
  adminV1GetWorkspaceMemberContract,
  adminV1RemoveWorkspaceMemberContract,
  adminV1UpdateWorkspaceMemberContract,
} from '@/lib/api/contracts/v1/admin'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { revokeWorkspaceCredentialMembershipsTx } from '@/lib/credentials/access'
import { removeWorkspaceSkillMembershipsTx } from '@/lib/skills/access'
import { getWorkspaceById } from '@/lib/workspaces/permissions/utils'
import {
  reassignWorkflowOwnershipForWorkspaceMemberRemovalTx,
  transferWorkspaceOwnershipToBilledAccountForMemberRemovalTx,
  WorkspaceBillingAccountRemovalError,
} from '@/lib/workspaces/utils'
import { withAdminAuthParams } from '@/app/api/v1/admin/middleware'
import {
  badRequestResponse,
  internalErrorResponse,
  notFoundResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'
import type { AdminWorkspaceMember } from '@/app/api/v1/admin/types'

const logger = createLogger('AdminWorkspaceMemberDetailAPI')

interface RouteParams {
  id: string
  memberId: string
}

export const GET = withRouteHandler(
  withAdminAuthParams<RouteParams>(async (request, context) => {
    const parsed = await parseRequest(adminV1GetWorkspaceMemberContract, request, context)
    if (!parsed.success) return parsed.response

    const { id: workspaceId, memberId } = parsed.data.params

    try {
      const workspaceData = await getWorkspaceById(workspaceId)

      if (!workspaceData) {
        return notFoundResponse('Workspace')
      }

      const [memberData] = await db
        .select({
          id: permissions.id,
          userId: permissions.userId,
          permissionType: permissions.permissionType,
          createdAt: permissions.createdAt,
          updatedAt: permissions.updatedAt,
          userName: user.name,
          userEmail: user.email,
          userImage: user.image,
        })
        .from(permissions)
        .innerJoin(user, eq(permissions.userId, user.id))
        .where(
          and(
            eq(permissions.id, memberId),
            eq(permissions.entityType, 'workspace'),
            eq(permissions.entityId, workspaceId)
          )
        )
        .limit(1)

      if (!memberData) {
        return notFoundResponse('Workspace member')
      }

      const data: AdminWorkspaceMember = {
        id: memberData.id,
        workspaceId,
        userId: memberData.userId,
        permissions: memberData.permissionType,
        createdAt: memberData.createdAt.toISOString(),
        updatedAt: memberData.updatedAt.toISOString(),
        userName: memberData.userName,
        userEmail: memberData.userEmail,
        userImage: memberData.userImage,
      }

      logger.info(`Admin API: Retrieved member ${memberId} from workspace ${workspaceId}`)

      return singleResponse(data)
    } catch (error) {
      logger.error('Admin API: Failed to get workspace member', { error, workspaceId, memberId })
      return internalErrorResponse('Failed to get workspace member')
    }
  })
)

export const PATCH = withRouteHandler(
  withAdminAuthParams<RouteParams>(async (request, context) => {
    const parsed = await parseRequest(adminV1UpdateWorkspaceMemberContract, request, context)
    if (!parsed.success) return parsed.response

    const { id: workspaceId, memberId } = parsed.data.params
    const { permissions: permissionLevel } = parsed.data.body

    try {
      const workspaceData = await getWorkspaceById(workspaceId)

      if (!workspaceData) {
        return notFoundResponse('Workspace')
      }

      const [existingMember] = await db
        .select({
          id: permissions.id,
          userId: permissions.userId,
          permissionType: permissions.permissionType,
          createdAt: permissions.createdAt,
        })
        .from(permissions)
        .where(
          and(
            eq(permissions.id, memberId),
            eq(permissions.entityType, 'workspace'),
            eq(permissions.entityId, workspaceId)
          )
        )
        .limit(1)

      if (!existingMember) {
        return notFoundResponse('Workspace member')
      }

      const [workspaceBilling] = await db
        .select({ billedAccountUserId: workspace.billedAccountUserId })
        .from(workspace)
        .where(eq(workspace.id, workspaceId))
        .limit(1)

      if (
        workspaceBilling?.billedAccountUserId === existingMember.userId &&
        permissionLevel !== 'admin'
      ) {
        return badRequestResponse('Workspace billing account must retain admin permissions')
      }

      const now = new Date()

      await db
        .update(permissions)
        .set({ permissionType: permissionLevel, updatedAt: now })
        .where(eq(permissions.id, memberId))

      const [userData] = await db
        .select({ name: user.name, email: user.email, image: user.image })
        .from(user)
        .where(eq(user.id, existingMember.userId))
        .limit(1)

      const data: AdminWorkspaceMember = {
        id: existingMember.id,
        workspaceId,
        userId: existingMember.userId,
        permissions: permissionLevel,
        createdAt: existingMember.createdAt.toISOString(),
        updatedAt: now.toISOString(),
        userName: userData?.name ?? '',
        userEmail: userData?.email ?? '',
        userImage: userData?.image ?? null,
      }

      logger.info(`Admin API: Updated member ${memberId} permissions to ${permissionLevel}`, {
        workspaceId,
        previousPermissions: existingMember.permissionType,
      })

      recordAudit({
        workspaceId,
        actorId: 'admin-api',
        action: AuditAction.MEMBER_ROLE_CHANGED,
        resourceType: AuditResourceType.WORKSPACE,
        resourceId: workspaceId,
        description: `Admin API changed workspace member permissions to ${permissionLevel}`,
        metadata: {
          memberId,
          targetUserId: existingMember.userId,
          previousPermissions: existingMember.permissionType,
          permissions: permissionLevel,
        },
        request,
      })

      return singleResponse(data)
    } catch (error) {
      logger.error('Admin API: Failed to update workspace member', { error, workspaceId, memberId })
      return internalErrorResponse('Failed to update workspace member')
    }
  })
)

export const DELETE = withRouteHandler(
  withAdminAuthParams<RouteParams>(async (request, context) => {
    const parsed = await parseRequest(adminV1RemoveWorkspaceMemberContract, request, context)
    if (!parsed.success) return parsed.response

    const { id: workspaceId, memberId } = parsed.data.params

    try {
      const workspaceData = await getWorkspaceById(workspaceId)

      if (!workspaceData) {
        return notFoundResponse('Workspace')
      }

      const [existingMember] = await db
        .select({
          id: permissions.id,
          userId: permissions.userId,
        })
        .from(permissions)
        .where(
          and(
            eq(permissions.id, memberId),
            eq(permissions.entityType, 'workspace'),
            eq(permissions.entityId, workspaceId)
          )
        )
        .limit(1)

      if (!existingMember) {
        return notFoundResponse('Workspace member')
      }

      const [workspaceBilling] = await db
        .select({ billedAccountUserId: workspace.billedAccountUserId })
        .from(workspace)
        .where(eq(workspace.id, workspaceId))
        .limit(1)

      if (workspaceBilling?.billedAccountUserId === existingMember.userId) {
        return badRequestResponse(
          'Cannot remove the workspace billing account. Please reassign billing first.'
        )
      }

      await db.transaction(async (tx) => {
        await transferWorkspaceOwnershipToBilledAccountForMemberRemovalTx({
          tx,
          workspaceId,
          departingUserId: existingMember.userId,
        })

        const workflowOwnershipReassignment =
          await reassignWorkflowOwnershipForWorkspaceMemberRemovalTx({
            tx,
            workspaceIds: [workspaceId],
            departingUserId: existingMember.userId,
          })
        if (workflowOwnershipReassignment.unresolved.length > 0) {
          throw new WorkspaceBillingAccountRemovalError()
        }

        await tx.delete(permissions).where(eq(permissions.id, memberId))

        await revokeWorkspaceCredentialMembershipsTx(tx, workspaceId, existingMember.userId)
        await removeWorkspaceSkillMembershipsTx(tx, workspaceId, existingMember.userId)
      })

      logger.info(`Admin API: Removed member ${memberId} from workspace ${workspaceId}`, {
        userId: existingMember.userId,
      })

      recordAudit({
        workspaceId,
        actorId: 'admin-api',
        action: AuditAction.MEMBER_REMOVED,
        resourceType: AuditResourceType.WORKSPACE,
        resourceId: workspaceId,
        description: 'Admin API removed member from workspace',
        metadata: { memberId, targetUserId: existingMember.userId },
        request,
      })

      return singleResponse({
        removed: true,
        memberId,
        userId: existingMember.userId,
        workspaceId,
      })
    } catch (error) {
      if (error instanceof WorkspaceBillingAccountRemovalError) {
        return badRequestResponse(error.message)
      }
      logger.error('Admin API: Failed to remove workspace member', { error, workspaceId, memberId })
      return internalErrorResponse('Failed to remove workspace member')
    }
  })
)
