/**
 * Admin Access Control (Permission Groups) API
 *
 * GET /api/v1/admin/access-control
 *   List all permission groups with optional filtering.
 *
 *   Query Parameters:
 *     - workspaceId?: string - Filter by workspace ID
 *     - organizationId?: string - Filter by organization ID (joins via workspace)
 *
 *   Response: { data: AdminPermissionGroup[], pagination: PaginationMeta }
 *
 * DELETE /api/v1/admin/access-control
 *   Delete permission groups scoped to a workspace or organization (via workspace join).
 *   Used when an enterprise plan churns to clean up access control data.
 *
 *   Query Parameters:
 *     - workspaceId?: string - Delete all permission groups for this workspace
 *     - organizationId?: string - Delete all permission groups for every workspace in this org
 *     - reason?: string - Reason recorded in audit log (default: "Enterprise plan churn cleanup")
 *
 *   Response: { success: true, deletedCount: number, membersRemoved: number }
 */

import { db } from '@sim/db'
import { permissionGroup, permissionGroupMember, user, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { count, eq, inArray, sql } from 'drizzle-orm'
import { AuditAction, AuditResourceType, recordAudit } from '@/lib/audit/log'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { withAdminAuth } from '@/app/api/v1/admin/middleware'
import {
  badRequestResponse,
  internalErrorResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'

const logger = createLogger('AdminAccessControlAPI')

export interface AdminPermissionGroup {
  id: string
  workspaceId: string
  workspaceName: string | null
  organizationId: string | null
  name: string
  description: string | null
  memberCount: number
  createdAt: string
  createdByUserId: string
  createdByEmail: string | null
}

export const GET = withRouteHandler(
  withAdminAuth(async (request) => {
    const url = new URL(request.url)
    const workspaceId = url.searchParams.get('workspaceId')
    const organizationId = url.searchParams.get('organizationId')

    try {
      const baseQuery = db
        .select({
          id: permissionGroup.id,
          workspaceId: permissionGroup.workspaceId,
          workspaceName: workspace.name,
          workspaceOrganizationId: workspace.organizationId,
          name: permissionGroup.name,
          description: permissionGroup.description,
          createdAt: permissionGroup.createdAt,
          createdByUserId: permissionGroup.createdBy,
          createdByEmail: user.email,
        })
        .from(permissionGroup)
        .leftJoin(workspace, eq(permissionGroup.workspaceId, workspace.id))
        .leftJoin(user, eq(permissionGroup.createdBy, user.id))

      let groups
      if (workspaceId) {
        groups = await baseQuery.where(eq(permissionGroup.workspaceId, workspaceId))
      } else if (organizationId) {
        groups = await baseQuery.where(eq(workspace.organizationId, organizationId))
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
            workspaceId: group.workspaceId,
            workspaceName: group.workspaceName,
            organizationId: group.workspaceOrganizationId,
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
        workspaceId,
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
      logger.error('Admin API: Failed to list permission groups', {
        error,
        workspaceId,
        organizationId,
      })
      return internalErrorResponse('Failed to list permission groups')
    }
  })
)

export const DELETE = withRouteHandler(
  withAdminAuth(async (request) => {
    const url = new URL(request.url)
    const workspaceId = url.searchParams.get('workspaceId')
    const organizationId = url.searchParams.get('organizationId')
    const reason = url.searchParams.get('reason') || 'Enterprise plan churn cleanup'

    if (!workspaceId && !organizationId) {
      return badRequestResponse('workspaceId or organizationId is required')
    }

    try {
      const selectBase = db
        .select({
          id: permissionGroup.id,
          workspaceId: permissionGroup.workspaceId,
          name: permissionGroup.name,
        })
        .from(permissionGroup)

      const existingGroups = workspaceId
        ? await selectBase.where(eq(permissionGroup.workspaceId, workspaceId))
        : await selectBase
            .innerJoin(workspace, eq(workspace.id, permissionGroup.workspaceId))
            .where(eq(workspace.organizationId, organizationId!))

      if (existingGroups.length === 0) {
        logger.info('Admin API: No permission groups to delete', { workspaceId, organizationId })
        return singleResponse({
          success: true,
          deletedCount: 0,
          membersRemoved: 0,
          message: 'No permission groups found for the given scope',
        })
      }

      const groupIds = existingGroups.map((g) => g.id)

      const [memberCountResult] = await db
        .select({ count: sql<number>`count(*)` })
        .from(permissionGroupMember)
        .where(inArray(permissionGroupMember.permissionGroupId, groupIds))

      const membersToRemove = Number(memberCountResult?.count ?? 0)

      await db.delete(permissionGroup).where(inArray(permissionGroup.id, groupIds))

      for (const group of existingGroups) {
        recordAudit({
          workspaceId: group.workspaceId,
          actorId: 'admin-api',
          action: AuditAction.PERMISSION_GROUP_DELETED,
          resourceType: AuditResourceType.PERMISSION_GROUP,
          resourceId: group.id,
          resourceName: group.name,
          description: `Admin API deleted permission group "${group.name}"`,
          metadata: { reason, workspaceId: group.workspaceId, organizationId },
          request,
        })
      }

      logger.info('Admin API: Deleted permission groups', {
        workspaceId,
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
      logger.error('Admin API: Failed to delete permission groups', {
        error,
        workspaceId,
        organizationId,
      })
      return internalErrorResponse('Failed to delete permission groups')
    }
  })
)
