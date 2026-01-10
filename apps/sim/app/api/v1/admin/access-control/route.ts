/**
 * Admin Access Control (Permission Groups) API
 *
 * GET /api/v1/admin/access-control
 *   List all permission groups with optional filtering.
 *
 *   Query Parameters:
 *     - organizationId?: string - Filter by organization ID
 *
 *   Response: { data: AdminPermissionGroup[], pagination: PaginationMeta }
 *
 * DELETE /api/v1/admin/access-control
 *   Delete permission groups for an organization.
 *   Used when an enterprise plan churns to clean up access control data.
 *
 *   Query Parameters:
 *     - organizationId: string - Delete all permission groups for this organization
 *
 *   Response: { success: true, deletedCount: number, membersRemoved: number }
 */

import { db } from '@sim/db'
import { organization, permissionGroup, permissionGroupMember, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { count, eq, inArray, sql } from 'drizzle-orm'
import { withAdminAuth } from '@/app/api/v1/admin/middleware'
import {
  badRequestResponse,
  internalErrorResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'

const logger = createLogger('AdminAccessControlAPI')

export interface AdminPermissionGroup {
  id: string
  organizationId: string
  organizationName: string | null
  name: string
  description: string | null
  memberCount: number
  createdAt: string
  createdByUserId: string
  createdByEmail: string | null
}

export const GET = withAdminAuth(async (request) => {
  const url = new URL(request.url)
  const organizationId = url.searchParams.get('organizationId')

  try {
    const baseQuery = db
      .select({
        id: permissionGroup.id,
        organizationId: permissionGroup.organizationId,
        organizationName: organization.name,
        name: permissionGroup.name,
        description: permissionGroup.description,
        createdAt: permissionGroup.createdAt,
        createdByUserId: permissionGroup.createdBy,
        createdByEmail: user.email,
      })
      .from(permissionGroup)
      .leftJoin(organization, eq(permissionGroup.organizationId, organization.id))
      .leftJoin(user, eq(permissionGroup.createdBy, user.id))

    let groups
    if (organizationId) {
      groups = await baseQuery.where(eq(permissionGroup.organizationId, organizationId))
    } else {
      groups = await baseQuery
    }

    const groupsWithCounts = await Promise.all(
      groups.map(async (group) => {
        const [memberCount] = await db
          .select({ count: count() })
          .from(permissionGroupMember)
          .where(eq(permissionGroupMember.permissionGroupId, group.id))

        return {
          id: group.id,
          organizationId: group.organizationId,
          organizationName: group.organizationName,
          name: group.name,
          description: group.description,
          memberCount: memberCount?.count ?? 0,
          createdAt: group.createdAt.toISOString(),
          createdByUserId: group.createdByUserId,
          createdByEmail: group.createdByEmail,
        } as AdminPermissionGroup
      })
    )

    logger.info('Admin API: Listed permission groups', {
      organizationId,
      count: groupsWithCounts.length,
    })

    return singleResponse({
      data: groupsWithCounts,
      pagination: {
        total: groupsWithCounts.length,
        limit: groupsWithCounts.length,
        offset: 0,
        hasMore: false,
      },
    })
  } catch (error) {
    logger.error('Admin API: Failed to list permission groups', { error, organizationId })
    return internalErrorResponse('Failed to list permission groups')
  }
})

export const DELETE = withAdminAuth(async (request) => {
  const url = new URL(request.url)
  const organizationId = url.searchParams.get('organizationId')
  const reason = url.searchParams.get('reason') || 'Enterprise plan churn cleanup'

  if (!organizationId) {
    return badRequestResponse('organizationId is required')
  }

  try {
    const existingGroups = await db
      .select({ id: permissionGroup.id })
      .from(permissionGroup)
      .where(eq(permissionGroup.organizationId, organizationId))

    if (existingGroups.length === 0) {
      logger.info('Admin API: No permission groups to delete', { organizationId })
      return singleResponse({
        success: true,
        deletedCount: 0,
        membersRemoved: 0,
        message: 'No permission groups found for the given organization',
      })
    }

    const groupIds = existingGroups.map((g) => g.id)

    const [memberCountResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(permissionGroupMember)
      .where(inArray(permissionGroupMember.permissionGroupId, groupIds))

    const membersToRemove = Number(memberCountResult?.count ?? 0)

    // Members are deleted via cascade when permission groups are deleted
    await db.delete(permissionGroup).where(eq(permissionGroup.organizationId, organizationId))

    logger.info('Admin API: Deleted permission groups', {
      organizationId,
      deletedCount: existingGroups.length,
      membersRemoved: membersToRemove,
      reason,
    })

    return singleResponse({
      success: true,
      deletedCount: existingGroups.length,
      membersRemoved: membersToRemove,
      reason,
    })
  } catch (error) {
    logger.error('Admin API: Failed to delete permission groups', { error, organizationId })
    return internalErrorResponse('Failed to delete permission groups')
  }
})
