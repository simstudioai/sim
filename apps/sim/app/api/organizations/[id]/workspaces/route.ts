import { and, eq, or } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import * as schema from '@/db/schema'

const logger = createLogger('OrganizationWorkspacesAPI')

/**
 * GET /api/organizations/[id]/workspaces
 * Get workspaces related to the organization with optional filtering
 * Query parameters:
 * - ?available=true - Only workspaces where user can invite others (admin permissions)
 * - ?member=userId - Workspaces where specific member has access
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: organizationId } = await params
    const url = new URL(request.url)
    const availableOnly = url.searchParams.get('available') === 'true'
    const memberId = url.searchParams.get('member')

    // Verify user is a member of this organization
    const member = await db
      .select()
      .from(schema.member)
      .where(
        and(
          eq(schema.member.organizationId, organizationId),
          eq(schema.member.userId, session.user.id)
        )
      )
      .limit(1)

    if (member.length === 0) {
      return NextResponse.json(
        {
          error: 'Forbidden - Not a member of this organization',
        },
        { status: 403 }
      )
    }

    const userRole = member[0].role
    const hasAdminAccess = ['owner', 'admin'].includes(userRole)

    if (availableOnly) {
      // Get workspaces where user has admin permissions (can invite others)
      const availableWorkspaces = await db
        .select({
          id: schema.workspace.id,
          name: schema.workspace.name,
          ownerId: schema.workspace.ownerId,
          createdAt: schema.workspace.createdAt,
          isOwner: eq(schema.workspace.ownerId, session.user.id),
          permissionType: schema.permissions.permissionType,
        })
        .from(schema.workspace)
        .leftJoin(
          schema.permissions,
          and(
            eq(schema.permissions.entityType, 'workspace'),
            eq(schema.permissions.entityId, schema.workspace.id),
            eq(schema.permissions.userId, session.user.id)
          )
        )
        .where(
          or(
            // User owns the workspace
            eq(schema.workspace.ownerId, session.user.id),
            // User has admin permission on the workspace
            and(
              eq(schema.permissions.userId, session.user.id),
              eq(schema.permissions.entityType, 'workspace'),
              eq(schema.permissions.permissionType, 'admin')
            )
          )
        )

      // Filter and format the results
      const workspacesWithInvitePermission = availableWorkspaces
        .filter((workspace) => {
          // Include if user owns the workspace OR has admin permission
          return workspace.isOwner || workspace.permissionType === 'admin'
        })
        .map((workspace) => ({
          id: workspace.id,
          name: workspace.name,
          isOwner: workspace.isOwner,
          canInvite: true, // All returned workspaces have invite permission
          createdAt: workspace.createdAt,
        }))

      logger.info('Retrieved available workspaces for organization member', {
        organizationId,
        userId: session.user.id,
        workspaceCount: workspacesWithInvitePermission.length,
      })

      return NextResponse.json({
        success: true,
        data: {
          workspaces: workspacesWithInvitePermission,
          totalCount: workspacesWithInvitePermission.length,
          filter: 'available',
        },
      })
    }

    if (memberId && hasAdminAccess) {
      // Get workspaces where specific member has access (admin only)
      const memberWorkspaces = await db
        .select({
          id: schema.workspace.id,
          name: schema.workspace.name,
          ownerId: schema.workspace.ownerId,
          createdAt: schema.workspace.createdAt,
          isOwner: eq(schema.workspace.ownerId, memberId),
          permissionType: schema.permissions.permissionType,
          joinedAt: schema.workspaceMember.joinedAt,
        })
        .from(schema.workspace)
        .leftJoin(
          schema.permissions,
          and(
            eq(schema.permissions.entityType, 'workspace'),
            eq(schema.permissions.entityId, schema.workspace.id),
            eq(schema.permissions.userId, memberId)
          )
        )
        .leftJoin(
          schema.workspaceMember,
          and(
            eq(schema.workspaceMember.workspaceId, schema.workspace.id),
            eq(schema.workspaceMember.userId, memberId)
          )
        )
        .where(
          or(
            // Member owns the workspace
            eq(schema.workspace.ownerId, memberId),
            // Member has permissions on the workspace
            and(
              eq(schema.permissions.userId, memberId),
              eq(schema.permissions.entityType, 'workspace')
            )
          )
        )

      const formattedWorkspaces = memberWorkspaces.map((workspace) => ({
        id: workspace.id,
        name: workspace.name,
        isOwner: workspace.isOwner,
        permission: workspace.permissionType,
        joinedAt: workspace.joinedAt,
        createdAt: workspace.createdAt,
      }))

      return NextResponse.json({
        success: true,
        data: {
          workspaces: formattedWorkspaces,
          totalCount: formattedWorkspaces.length,
          filter: 'member',
          memberId,
        },
      })
    }

    // Default: Get all workspaces (basic info only for regular members)
    if (!hasAdminAccess) {
      return NextResponse.json({
        success: true,
        data: {
          workspaces: [],
          totalCount: 0,
          message: 'Workspace access information is only available to organization admins',
        },
      })
    }

    // For admins: Get summary of all workspaces
    const allWorkspaces = await db
      .select({
        id: schema.workspace.id,
        name: schema.workspace.name,
        ownerId: schema.workspace.ownerId,
        createdAt: schema.workspace.createdAt,
        ownerName: schema.user.name,
      })
      .from(schema.workspace)
      .leftJoin(schema.user, eq(schema.workspace.ownerId, schema.user.id))

    return NextResponse.json({
      success: true,
      data: {
        workspaces: allWorkspaces,
        totalCount: allWorkspaces.length,
        filter: 'all',
      },
      userRole,
      hasAdminAccess,
    })
  } catch (error) {
    logger.error('Failed to get organization workspaces', { error })
    return NextResponse.json(
      {
        error: 'Internal server error',
      },
      { status: 500 }
    )
  }
}
