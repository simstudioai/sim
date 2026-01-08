/**
 * Admin BYOK Keys API
 *
 * GET /api/v1/admin/byok
 *   List all BYOK keys with optional filtering.
 *
 *   Query Parameters:
 *     - organizationId?: string - Filter by organization ID (finds all workspaces billed to this org)
 *     - workspaceId?: string - Filter by specific workspace ID
 *
 *   Response: { data: AdminBYOKKey[], pagination: PaginationMeta }
 *
 * DELETE /api/v1/admin/byok
 *   Delete BYOK keys for an organization or workspace.
 *   Used when an enterprise plan churns to clean up BYOK keys.
 *
 *   Query Parameters:
 *     - organizationId: string - Delete all BYOK keys for workspaces billed to this org
 *     - workspaceId?: string - Delete keys for a specific workspace only (optional)
 *
 *   Response: { success: true, deletedCount: number, workspacesAffected: string[] }
 */

import { db } from '@sim/db'
import { user, workspace, workspaceBYOKKeys } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq, inArray, sql } from 'drizzle-orm'
import { withAdminAuth } from '@/app/api/v1/admin/middleware'
import {
  badRequestResponse,
  internalErrorResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'

const logger = createLogger('AdminBYOKAPI')

export interface AdminBYOKKey {
  id: string
  workspaceId: string
  workspaceName: string
  organizationId: string
  providerId: string
  createdAt: string
  createdByUserId: string | null
  createdByEmail: string | null
}

export const GET = withAdminAuth(async (request) => {
  const url = new URL(request.url)
  const organizationId = url.searchParams.get('organizationId')
  const workspaceId = url.searchParams.get('workspaceId')

  try {
    let workspaceIds: string[] = []

    if (workspaceId) {
      workspaceIds = [workspaceId]
    } else if (organizationId) {
      const workspaces = await db
        .select({ id: workspace.id })
        .from(workspace)
        .where(eq(workspace.billedAccountUserId, organizationId))

      workspaceIds = workspaces.map((w) => w.id)
    }

    const query = db
      .select({
        id: workspaceBYOKKeys.id,
        workspaceId: workspaceBYOKKeys.workspaceId,
        workspaceName: workspace.name,
        organizationId: workspace.billedAccountUserId,
        providerId: workspaceBYOKKeys.providerId,
        createdAt: workspaceBYOKKeys.createdAt,
        createdByUserId: workspaceBYOKKeys.createdBy,
        createdByEmail: user.email,
      })
      .from(workspaceBYOKKeys)
      .innerJoin(workspace, eq(workspaceBYOKKeys.workspaceId, workspace.id))
      .leftJoin(user, eq(workspaceBYOKKeys.createdBy, user.id))

    let keys
    if (workspaceIds.length > 0) {
      keys = await query.where(inArray(workspaceBYOKKeys.workspaceId, workspaceIds))
    } else {
      keys = await query
    }

    const formattedKeys: AdminBYOKKey[] = keys.map((k) => ({
      id: k.id,
      workspaceId: k.workspaceId,
      workspaceName: k.workspaceName,
      organizationId: k.organizationId,
      providerId: k.providerId,
      createdAt: k.createdAt.toISOString(),
      createdByUserId: k.createdByUserId,
      createdByEmail: k.createdByEmail,
    }))

    logger.info('Admin API: Listed BYOK keys', {
      organizationId,
      workspaceId,
      count: formattedKeys.length,
    })

    return singleResponse({
      data: formattedKeys,
      pagination: {
        total: formattedKeys.length,
        limit: formattedKeys.length,
        offset: 0,
        hasMore: false,
      },
    })
  } catch (error) {
    logger.error('Admin API: Failed to list BYOK keys', { error, organizationId, workspaceId })
    return internalErrorResponse('Failed to list BYOK keys')
  }
})

export const DELETE = withAdminAuth(async (request) => {
  const url = new URL(request.url)
  const organizationId = url.searchParams.get('organizationId')
  const workspaceId = url.searchParams.get('workspaceId')
  const reason = url.searchParams.get('reason') || 'Enterprise plan churn cleanup'

  if (!organizationId && !workspaceId) {
    return badRequestResponse('Either organizationId or workspaceId is required')
  }

  try {
    let workspaceIds: string[] = []

    if (workspaceId) {
      workspaceIds = [workspaceId]
    } else if (organizationId) {
      const workspaces = await db
        .select({ id: workspace.id })
        .from(workspace)
        .where(eq(workspace.billedAccountUserId, organizationId))

      workspaceIds = workspaces.map((w) => w.id)
    }

    if (workspaceIds.length === 0) {
      logger.info('Admin API: No workspaces found for BYOK cleanup', {
        organizationId,
        workspaceId,
      })
      return singleResponse({
        success: true,
        deletedCount: 0,
        workspacesAffected: [],
        message: 'No workspaces found for the given organization/workspace ID',
      })
    }

    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(workspaceBYOKKeys)
      .where(inArray(workspaceBYOKKeys.workspaceId, workspaceIds))

    const totalToDelete = Number(countResult[0]?.count ?? 0)

    if (totalToDelete === 0) {
      logger.info('Admin API: No BYOK keys to delete', {
        organizationId,
        workspaceId,
        workspaceIds,
      })
      return singleResponse({
        success: true,
        deletedCount: 0,
        workspacesAffected: [],
        message: 'No BYOK keys found for the specified workspaces',
      })
    }

    await db.delete(workspaceBYOKKeys).where(inArray(workspaceBYOKKeys.workspaceId, workspaceIds))

    logger.info('Admin API: Deleted BYOK keys', {
      organizationId,
      workspaceId,
      workspaceIds,
      deletedCount: totalToDelete,
      reason,
    })

    return singleResponse({
      success: true,
      deletedCount: totalToDelete,
      workspacesAffected: workspaceIds,
      reason,
    })
  } catch (error) {
    logger.error('Admin API: Failed to delete BYOK keys', { error, organizationId, workspaceId })
    return internalErrorResponse('Failed to delete BYOK keys')
  }
})
