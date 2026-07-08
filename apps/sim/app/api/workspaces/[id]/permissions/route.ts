import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { member, permissions, user, workspace, workspaceEnvironment } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { ORG_ADMIN_ROLES } from '@sim/platform-authz/workspace'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { updateWorkspacePermissionsContract } from '@/lib/api/contracts/workspaces'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { syncWorkspaceEnvCredentials } from '@/lib/credentials/environment'
import { captureServerEvent } from '@/lib/posthog/server'
import {
  getUsersWithPermissions,
  getWorkspacePermissionsForViewer,
  hasWorkspaceAdminAccess,
} from '@/lib/workspaces/permissions/utils'

const logger = createLogger('WorkspacesPermissionsAPI')

/**
 * GET /api/workspaces/[id]/permissions
 *
 * Retrieves all users who have permissions for the specified workspace.
 * Returns user details along with their specific permissions.
 *
 * @param workspaceId - The workspace ID from the URL parameters
 * @returns Array of users with their permissions for the workspace
 */
export const GET = withRouteHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const { id: workspaceId } = await params
      const session = await getSession()

      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
      }

      const result = await getWorkspacePermissionsForViewer(workspaceId, session.user.id)

      if (!result) {
        return NextResponse.json({ error: 'Workspace not found or access denied' }, { status: 404 })
      }

      return NextResponse.json(result)
    } catch (error) {
      logger.error('Error fetching workspace permissions:', error)
      return NextResponse.json({ error: 'Failed to fetch workspace permissions' }, { status: 500 })
    }
  }
)

/**
 * PATCH /api/workspaces/[id]/permissions
 *
 * Updates permissions for existing workspace members.
 * Only admin users can update permissions.
 *
 * @param workspaceId - The workspace ID from the URL parameters
 * @param updates - Array of permission updates for users
 * @returns Success message or error
 */
export const PATCH = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    try {
      const { id: workspaceId } = await context.params
      const session = await getSession()

      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
      }

      const hasAdminAccess = await hasWorkspaceAdminAccess(session.user.id, workspaceId)

      if (!hasAdminAccess) {
        return NextResponse.json(
          { error: 'Admin access required to update permissions' },
          { status: 403 }
        )
      }

      const parsed = await parseRequest(updateWorkspacePermissionsContract, request, context)
      if (!parsed.success) return parsed.response
      const body = parsed.data.body

      const workspaceRow = await db
        .select({
          billedAccountUserId: workspace.billedAccountUserId,
          organizationId: workspace.organizationId,
        })
        .from(workspace)
        .where(eq(workspace.id, workspaceId))
        .limit(1)

      if (!workspaceRow.length) {
        return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
      }

      const billedAccountUserId = workspaceRow[0].billedAccountUserId
      const organizationId = workspaceRow[0].organizationId

      if (organizationId) {
        const targetUserIds = body.updates.map((update) => update.userId)
        const orgAdminTargets = await db
          .select({ userId: member.userId })
          .from(member)
          .where(
            and(
              eq(member.organizationId, organizationId),
              inArray(member.userId, targetUserIds),
              inArray(member.role, [...ORG_ADMIN_ROLES])
            )
          )
        if (orgAdminTargets.length > 0) {
          return NextResponse.json(
            { error: 'Organization admins are workspace admins and their role cannot be changed' },
            { status: 400 }
          )
        }
      }

      const selfUpdate = body.updates.find((update) => update.userId === session.user.id)
      if (selfUpdate && selfUpdate.permissions !== 'admin') {
        return NextResponse.json(
          { error: 'Cannot remove your own admin permissions' },
          { status: 400 }
        )
      }

      if (
        billedAccountUserId &&
        body.updates.some(
          (update) => update.userId === billedAccountUserId && update.permissions !== 'admin'
        )
      ) {
        return NextResponse.json(
          { error: 'Workspace billing account must retain admin permissions' },
          { status: 400 }
        )
      }

      // Capture existing permissions and user info for audit metadata
      const existingPerms = await db
        .select({
          userId: permissions.userId,
          permissionType: permissions.permissionType,
          email: user.email,
        })
        .from(permissions)
        .innerJoin(user, eq(permissions.userId, user.id))
        .where(and(eq(permissions.entityType, 'workspace'), eq(permissions.entityId, workspaceId)))

      const permLookup = new Map(
        existingPerms.map((p) => [p.userId, { permission: p.permissionType, email: p.email }])
      )

      await db.transaction(async (tx) => {
        for (const update of body.updates) {
          await tx
            .delete(permissions)
            .where(
              and(
                eq(permissions.userId, update.userId),
                eq(permissions.entityType, 'workspace'),
                eq(permissions.entityId, workspaceId)
              )
            )

          await tx.insert(permissions).values({
            id: generateId(),
            userId: update.userId,
            entityType: 'workspace' as const,
            entityId: workspaceId,
            permissionType: update.permissions,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
        }
      })

      const [wsEnvRow] = await db
        .select({ variables: workspaceEnvironment.variables })
        .from(workspaceEnvironment)
        .where(eq(workspaceEnvironment.workspaceId, workspaceId))
        .limit(1)
      const wsEnvKeys = Object.keys((wsEnvRow?.variables as Record<string, string>) || {})
      if (wsEnvKeys.length > 0) {
        await syncWorkspaceEnvCredentials({
          workspaceId,
          envKeys: wsEnvKeys,
          actingUserId: session.user.id,
        })
      }

      const updatedUsers = await getUsersWithPermissions(workspaceId)

      for (const update of body.updates) {
        captureServerEvent(
          session.user.id,
          'workspace_member_role_changed',
          { workspace_id: workspaceId, new_role: update.permissions },
          { groups: { workspace: workspaceId } }
        )

        recordAudit({
          workspaceId,
          actorId: session.user.id,
          action: AuditAction.MEMBER_ROLE_CHANGED,
          resourceType: AuditResourceType.WORKSPACE,
          resourceId: workspaceId,
          resourceName: permLookup.get(update.userId)?.email ?? update.userId,
          actorName: session.user.name ?? undefined,
          actorEmail: session.user.email ?? undefined,
          description: `Changed permissions for ${permLookup.get(update.userId)?.email ?? update.userId} from ${permLookup.get(update.userId)?.permission ?? 'none'} to ${update.permissions}`,
          metadata: {
            targetUserId: update.userId,
            targetEmail: permLookup.get(update.userId)?.email ?? undefined,
            previousRole: permLookup.get(update.userId)?.permission ?? null,
            newRole: update.permissions,
          },
          request,
        })
      }

      return NextResponse.json({
        message: 'Permissions updated successfully',
        users: updatedUsers,
        total: updatedUsers.length,
      })
    } catch (error) {
      logger.error('Error updating workspace permissions:', error)
      return NextResponse.json({ error: 'Failed to update workspace permissions' }, { status: 500 })
    }
  }
)
