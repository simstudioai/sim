import crypto from 'crypto'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getUsersWithPermissions, hasWorkspaceAdminAccess } from '@/lib/permissions/utils'
import { db } from '@/db'
import { permissions, type permissionTypeEnum } from '@/db/schema'

type PermissionType = (typeof permissionTypeEnum.enumValues)[number]

interface UpdatePermissionsRequest {
  updates: Array<{
    userId: string
    permissions: PermissionType // Single permission type instead of object with booleans
  }>
}

/**
 * GET /api/workspaces/[id]/permissions
 *
 * Retrieves all users who have permissions for the specified workspace.
 * Returns user details along with their specific permissions.
 *
 * @param workspaceId - The workspace ID from the URL parameters
 * @returns Array of users with their permissions for the workspace
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: workspaceId } = await params
    const session = await getSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    // Verify the current user has access to this workspace
    const userPermission = await db
      .select()
      .from(permissions)
      .where(
        and(
          eq(permissions.entityId, workspaceId),
          eq(permissions.entityType, 'workspace'),
          eq(permissions.userId, session.user.id)
        )
      )
      .limit(1)

    if (userPermission.length === 0) {
      return NextResponse.json({ error: 'Workspace not found or access denied' }, { status: 404 })
    }

    const result = await getUsersWithPermissions(workspaceId)

    return NextResponse.json({
      users: result,
      total: result.length,
    })
  } catch (error) {
    console.error('Error fetching workspace permissions:', error)
    return NextResponse.json({ error: 'Failed to fetch workspace permissions' }, { status: 500 })
  }
}

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
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: workspaceId } = await params
    const session = await getSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    // Verify the current user has admin access to this workspace (either direct or through organization)
    const hasAdminAccess = await hasWorkspaceAdminAccess(session.user.id, workspaceId)

    if (!hasAdminAccess) {
      return NextResponse.json(
        { error: 'Admin access required to update permissions' },
        { status: 403 }
      )
    }

    // Parse and validate request body
    const body: UpdatePermissionsRequest = await request.json()

    // Prevent users from modifying their own admin permissions
    const selfUpdate = body.updates.find((update) => update.userId === session.user.id)
    if (selfUpdate && selfUpdate.permissions !== 'admin') {
      return NextResponse.json(
        { error: 'Cannot remove your own admin permissions' },
        { status: 400 }
      )
    }

    // Process updates in a transaction
    await db.transaction(async (tx) => {
      for (const update of body.updates) {
        // Delete existing permissions for this user and workspace
        await tx
          .delete(permissions)
          .where(
            and(
              eq(permissions.userId, update.userId),
              eq(permissions.entityType, 'workspace'),
              eq(permissions.entityId, workspaceId)
            )
          )

        // Insert the single new permission
        await tx.insert(permissions).values({
          id: crypto.randomUUID(),
          userId: update.userId,
          entityType: 'workspace' as const,
          entityId: workspaceId,
          permissionType: update.permissions,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
      }
    })

    const updatedUsers = await getUsersWithPermissions(workspaceId)

    return NextResponse.json({
      message: 'Permissions updated successfully',
      users: updatedUsers,
      total: updatedUsers.length,
    })
  } catch (error) {
    console.error('Error updating workspace permissions:', error)
    return NextResponse.json({ error: 'Failed to update workspace permissions' }, { status: 500 })
  }
}
