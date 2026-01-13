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

import { db } from '@sim/db'
import { permissions, user, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
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

export const GET = withAdminAuthParams<RouteParams>(async (_, context) => {
  const { id: workspaceId, memberId } = await context.params

  try {
    const [workspaceData] = await db
      .select({ id: workspace.id })
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .limit(1)

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

export const PATCH = withAdminAuthParams<RouteParams>(async (request, context) => {
  const { id: workspaceId, memberId } = await context.params

  try {
    const body = await request.json()

    if (!body.permissions || !['admin', 'write', 'read'].includes(body.permissions)) {
      return badRequestResponse('permissions must be "admin", "write", or "read"')
    }

    const [workspaceData] = await db
      .select({ id: workspace.id })
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .limit(1)

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

    const now = new Date()

    await db
      .update(permissions)
      .set({ permissionType: body.permissions, updatedAt: now })
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
      permissions: body.permissions,
      createdAt: existingMember.createdAt.toISOString(),
      updatedAt: now.toISOString(),
      userName: userData?.name ?? '',
      userEmail: userData?.email ?? '',
      userImage: userData?.image ?? null,
    }

    logger.info(`Admin API: Updated member ${memberId} permissions to ${body.permissions}`, {
      workspaceId,
      previousPermissions: existingMember.permissionType,
    })

    return singleResponse(data)
  } catch (error) {
    logger.error('Admin API: Failed to update workspace member', { error, workspaceId, memberId })
    return internalErrorResponse('Failed to update workspace member')
  }
})

export const DELETE = withAdminAuthParams<RouteParams>(async (_, context) => {
  const { id: workspaceId, memberId } = await context.params

  try {
    const [workspaceData] = await db
      .select({ id: workspace.id })
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .limit(1)

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

    await db.delete(permissions).where(eq(permissions.id, memberId))

    logger.info(`Admin API: Removed member ${memberId} from workspace ${workspaceId}`, {
      userId: existingMember.userId,
    })

    return singleResponse({
      removed: true,
      memberId,
      userId: existingMember.userId,
      workspaceId,
    })
  } catch (error) {
    logger.error('Admin API: Failed to remove workspace member', { error, workspaceId, memberId })
    return internalErrorResponse('Failed to remove workspace member')
  }
})
