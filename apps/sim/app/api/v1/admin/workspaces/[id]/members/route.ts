/**
 * GET /api/v1/admin/workspaces/[id]/members
 *
 * List all members of a workspace with their permission details.
 *
 * Query Parameters:
 *   - limit: number (default: 50, max: 250)
 *   - offset: number (default: 0)
 *
 * Response: AdminListResponse<AdminWorkspaceMember>
 *
 * POST /api/v1/admin/workspaces/[id]/members
 *
 * Add a user to a workspace with a specific permission level.
 * If the user already has permissions, updates their permission level.
 *
 * Body:
 *   - userId: string - User ID to add
 *   - permissions: 'admin' | 'write' | 'read' - Permission level
 *
 * Response: AdminSingleResponse<AdminWorkspaceMember & { action: 'created' | 'updated' }>
 *
 * DELETE /api/v1/admin/workspaces/[id]/members
 *
 * Remove a user from a workspace.
 *
 * Query Parameters:
 *   - userId: string - User ID to remove
 *
 * Response: AdminSingleResponse<{ removed: true }>
 */

import crypto from 'crypto'
import { db } from '@sim/db'
import { permissions, user, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, count, eq } from 'drizzle-orm'
import { withAdminAuthParams } from '@/app/api/v1/admin/middleware'
import {
  badRequestResponse,
  internalErrorResponse,
  listResponse,
  notFoundResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'
import {
  type AdminWorkspaceMember,
  createPaginationMeta,
  parsePaginationParams,
} from '@/app/api/v1/admin/types'

const logger = createLogger('AdminWorkspaceMembersAPI')

interface RouteParams {
  id: string
}

export const GET = withAdminAuthParams<RouteParams>(async (request, context) => {
  const { id: workspaceId } = await context.params
  const url = new URL(request.url)
  const { limit, offset } = parsePaginationParams(url)

  try {
    const [workspaceData] = await db
      .select({ id: workspace.id })
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .limit(1)

    if (!workspaceData) {
      return notFoundResponse('Workspace')
    }

    const [countResult, membersData] = await Promise.all([
      db
        .select({ count: count() })
        .from(permissions)
        .where(and(eq(permissions.entityType, 'workspace'), eq(permissions.entityId, workspaceId))),
      db
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
        .where(and(eq(permissions.entityType, 'workspace'), eq(permissions.entityId, workspaceId)))
        .orderBy(permissions.createdAt)
        .limit(limit)
        .offset(offset),
    ])

    const total = countResult[0].count
    const data: AdminWorkspaceMember[] = membersData.map((m) => ({
      id: m.id,
      workspaceId,
      userId: m.userId,
      permissions: m.permissionType,
      createdAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt.toISOString(),
      userName: m.userName,
      userEmail: m.userEmail,
      userImage: m.userImage,
    }))

    const pagination = createPaginationMeta(total, limit, offset)

    logger.info(`Admin API: Listed ${data.length} members for workspace ${workspaceId}`)

    return listResponse(data, pagination)
  } catch (error) {
    logger.error('Admin API: Failed to list workspace members', { error, workspaceId })
    return internalErrorResponse('Failed to list workspace members')
  }
})

export const POST = withAdminAuthParams<RouteParams>(async (request, context) => {
  const { id: workspaceId } = await context.params

  try {
    const body = await request.json()

    if (!body.userId || typeof body.userId !== 'string') {
      return badRequestResponse('userId is required')
    }

    if (!body.permissions || !['admin', 'write', 'read'].includes(body.permissions)) {
      return badRequestResponse('permissions must be "admin", "write", or "read"')
    }

    const [workspaceData] = await db
      .select({ id: workspace.id, name: workspace.name })
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .limit(1)

    if (!workspaceData) {
      return notFoundResponse('Workspace')
    }

    const [userData] = await db
      .select({ id: user.id, name: user.name, email: user.email, image: user.image })
      .from(user)
      .where(eq(user.id, body.userId))
      .limit(1)

    if (!userData) {
      return notFoundResponse('User')
    }

    const [existingPermission] = await db
      .select({
        id: permissions.id,
        permissionType: permissions.permissionType,
        createdAt: permissions.createdAt,
        updatedAt: permissions.updatedAt,
      })
      .from(permissions)
      .where(
        and(
          eq(permissions.userId, body.userId),
          eq(permissions.entityType, 'workspace'),
          eq(permissions.entityId, workspaceId)
        )
      )
      .limit(1)

    if (existingPermission) {
      if (existingPermission.permissionType !== body.permissions) {
        const now = new Date()
        await db
          .update(permissions)
          .set({ permissionType: body.permissions, updatedAt: now })
          .where(eq(permissions.id, existingPermission.id))

        logger.info(
          `Admin API: Updated user ${body.userId} permissions in workspace ${workspaceId}`,
          {
            previousPermissions: existingPermission.permissionType,
            newPermissions: body.permissions,
          }
        )

        return singleResponse({
          id: existingPermission.id,
          workspaceId,
          userId: body.userId,
          permissions: body.permissions as 'admin' | 'write' | 'read',
          createdAt: existingPermission.createdAt.toISOString(),
          updatedAt: now.toISOString(),
          userName: userData.name,
          userEmail: userData.email,
          userImage: userData.image,
          action: 'updated' as const,
        })
      }

      return singleResponse({
        id: existingPermission.id,
        workspaceId,
        userId: body.userId,
        permissions: existingPermission.permissionType,
        createdAt: existingPermission.createdAt.toISOString(),
        updatedAt: existingPermission.updatedAt.toISOString(),
        userName: userData.name,
        userEmail: userData.email,
        userImage: userData.image,
        action: 'already_member' as const,
      })
    }

    const now = new Date()
    const permissionId = crypto.randomUUID()

    await db.insert(permissions).values({
      id: permissionId,
      userId: body.userId,
      entityType: 'workspace',
      entityId: workspaceId,
      permissionType: body.permissions,
      createdAt: now,
      updatedAt: now,
    })

    logger.info(`Admin API: Added user ${body.userId} to workspace ${workspaceId}`, {
      permissions: body.permissions,
      permissionId,
    })

    return singleResponse({
      id: permissionId,
      workspaceId,
      userId: body.userId,
      permissions: body.permissions as 'admin' | 'write' | 'read',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      userName: userData.name,
      userEmail: userData.email,
      userImage: userData.image,
      action: 'created' as const,
    })
  } catch (error) {
    logger.error('Admin API: Failed to add workspace member', { error, workspaceId })
    return internalErrorResponse('Failed to add workspace member')
  }
})

export const DELETE = withAdminAuthParams<RouteParams>(async (request, context) => {
  const { id: workspaceId } = await context.params
  const url = new URL(request.url)
  const userId = url.searchParams.get('userId')

  try {
    if (!userId) {
      return badRequestResponse('userId query parameter is required')
    }

    const [workspaceData] = await db
      .select({ id: workspace.id })
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .limit(1)

    if (!workspaceData) {
      return notFoundResponse('Workspace')
    }

    const [existingPermission] = await db
      .select({ id: permissions.id })
      .from(permissions)
      .where(
        and(
          eq(permissions.userId, userId),
          eq(permissions.entityType, 'workspace'),
          eq(permissions.entityId, workspaceId)
        )
      )
      .limit(1)

    if (!existingPermission) {
      return notFoundResponse('Workspace member')
    }

    await db.delete(permissions).where(eq(permissions.id, existingPermission.id))

    logger.info(`Admin API: Removed user ${userId} from workspace ${workspaceId}`)

    return singleResponse({ removed: true, userId, workspaceId })
  } catch (error) {
    logger.error('Admin API: Failed to remove workspace member', { error, workspaceId, userId })
    return internalErrorResponse('Failed to remove workspace member')
  }
})
