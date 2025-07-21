import { and, eq, or } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { member, permissions, user, workspace } from '@/db/schema'

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
    const memberEntry = await db
      .select()
      .from(member)
      .where(and(eq(member.organizationId, organizationId), eq(member.userId, session.user.id)))
      .limit(1)

    if (memberEntry.length === 0) {
      return NextResponse.json(
        {
          error: 'Forbidden - Not a member of this organization',
        },
        { status: 403 }
      )
    }

    const userRole = memberEntry[0].role
    const hasAdminAccess = ['owner', 'admin'].includes(userRole)

    if (availableOnly) {
      // Get workspaces where user has admin permissions (can invite others)
      const availableWorkspaces = await db
        .select({
          id: workspace.id,
          name: workspace.name,
          ownerId: workspace.ownerId,
          createdAt: workspace.createdAt,
          isOwner: eq(workspace.ownerId, session.user.id),
          permissionType: permissions.permissionType,
        })
        .from(workspace)
        .leftJoin(
          permissions,
          and(
            eq(permissions.entityType, 'workspace'),
            eq(permissions.entityId, workspace.id),
            eq(permissions.userId, session.user.id)
          )
        )
        .where(
          or(
            // User owns the workspace
            eq(workspace.ownerId, session.user.id),
            // User has admin permission on the workspace
            and(
              eq(permissions.userId, session.user.id),
              eq(permissions.entityType, 'workspace'),
              eq(permissions.permissionType, 'admin')
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
          id: workspace.id,
          name: workspace.name,
          ownerId: workspace.ownerId,
          isOwner: eq(workspace.ownerId, memberId),
          permissionType: permissions.permissionType,
          createdAt: permissions.createdAt,
        })
        .from(workspace)
        .leftJoin(
          permissions,
          and(
            eq(permissions.entityType, 'workspace'),
            eq(permissions.entityId, workspace.id),
            eq(permissions.userId, memberId)
          )
        )
        .where(
          or(
            // Member owns the workspace
            eq(workspace.ownerId, memberId),
            // Member has permissions on the workspace
            and(eq(permissions.userId, memberId), eq(permissions.entityType, 'workspace'))
          )
        )

      const formattedWorkspaces = memberWorkspaces.map((workspace) => ({
        id: workspace.id,
        name: workspace.name,
        isOwner: workspace.isOwner,
        permission: workspace.permissionType,
        joinedAt: workspace.createdAt,
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
        id: workspace.id,
        name: workspace.name,
        ownerId: workspace.ownerId,
        createdAt: workspace.createdAt,
        ownerName: user.name,
      })
      .from(workspace)
      .leftJoin(user, eq(workspace.ownerId, user.id))

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
