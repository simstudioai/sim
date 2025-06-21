import { and, eq, inArray } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/db'
import { permissions, user, workspaceMember, permissionTypeEnum } from '@/db/schema'

// Extract the enum type from Drizzle schema
type PermissionType = typeof permissionTypeEnum.enumValues[number]

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
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: workspaceId } = await params
    const session = await getSession()

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      )
    }

    // Verify the current user has access to this workspace
    const userMembership = await db
      .select()
      .from(workspaceMember)
      .where(
        and(
          eq(workspaceMember.workspaceId, workspaceId),
          eq(workspaceMember.userId, session.user.id)
        )
      )
      .limit(1)

    if (userMembership.length === 0) {
      return NextResponse.json(
        { error: 'Workspace not found or access denied' },
        { status: 404 }
      )
    }

    // Query all users with permissions for this workspace
    const usersWithPermissions = await db
      .select({
        userId: user.id,
        email: user.email,
        name: user.name,
        image: user.image,
        permissionType: permissions.permissionType,
      })
      .from(permissions)
      .innerJoin(user, eq(permissions.userId, user.id))
      .where(
        and(
          eq(permissions.entityType, 'workspace'),
          eq(permissions.entityId, workspaceId)
        )
      )
      .orderBy(user.email)

    // Since we now ensure only one permission per user, we can directly use the results
    // But we'll still handle potential legacy data with multiple permissions per user
    const userPermissionsMap = new Map<string, {
      userId: string
      email: string
      name: string | null
      image: string | null
      permissionType: PermissionType
    }>()

    for (const row of usersWithPermissions) {
      const key = row.userId
      
      if (!userPermissionsMap.has(key)) {
        userPermissionsMap.set(key, {
          userId: row.userId,
          email: row.email,
          name: row.name,
          image: row.image,
          permissionType: row.permissionType
        })
      } else {
        // Handle legacy data with multiple permissions - keep the highest permission level
        const existing = userPermissionsMap.get(key)!
        const currentPermission = existing.permissionType
        const newPermission = row.permissionType
        
        // Permission hierarchy: admin > write > read
        const permissionOrder: Record<PermissionType, number> = { admin: 3, write: 2, read: 1 }
        
        if (permissionOrder[newPermission] > permissionOrder[currentPermission]) {
          existing.permissionType = newPermission
        }
      }
    }

    // Convert map to array
    const result = Array.from(userPermissionsMap.values())

    return NextResponse.json({
      users: result,
      total: result.length
    })

  } catch (error) {
    console.error('Error fetching workspace permissions:', error)
    return NextResponse.json(
      { error: 'Failed to fetch workspace permissions' },
      { status: 500 }
    )
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
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: workspaceId } = await params
    const session = await getSession()

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      )
    }

    // Verify the current user has admin access to this workspace
    const userPermissions = await db
      .select()
      .from(permissions)
      .where(
        and(
          eq(permissions.userId, session.user.id),
          eq(permissions.entityType, 'workspace'),
          eq(permissions.entityId, workspaceId),
          eq(permissions.permissionType, 'admin')
        )
      )
      .limit(1)

    if (userPermissions.length === 0) {
      return NextResponse.json(
        { error: 'Admin access required to update permissions' },
        { status: 403 }
      )
    }

    // Parse and validate request body
    const body: UpdatePermissionsRequest = await request.json()

    if (!body.updates || !Array.isArray(body.updates) || body.updates.length === 0) {
      return NextResponse.json(
        { error: 'Invalid request: updates array is required' },
        { status: 400 }
      )
    }

    // Validate each update
    for (const update of body.updates) {
      if (!update.userId || typeof update.userId !== 'string') {
        return NextResponse.json(
          { error: 'Invalid request: userId is required for each update' },
          { status: 400 }
        )
      }

      if (!update.permissions || typeof update.permissions !== 'string') {
        return NextResponse.json(
          { error: 'Invalid request: permissions must be a valid PermissionType' },
          { status: 400 }
        )
      }

      // Validate permission type
      const validPermissions: PermissionType[] = ['admin', 'write', 'read']
      if (!validPermissions.includes(update.permissions)) {
        return NextResponse.json(
          { error: 'Invalid request: permission must be one of: admin, write, read' },
          { status: 400 }
        )
      }
    }

    // Prevent users from modifying their own admin permissions
    const selfUpdate = body.updates.find(update => update.userId === session.user.id)
    if (selfUpdate && selfUpdate.permissions !== 'admin') {
      return NextResponse.json(
        { error: 'Cannot remove your own admin permissions' },
        { status: 400 }
      )
    }

    // Process updates in a transaction
    await db.transaction(async (tx) => {
      for (const update of body.updates) {
        const userId = update.userId
        
        // Delete existing permissions for this user and workspace
        await tx
          .delete(permissions)
          .where(
            and(
              eq(permissions.userId, userId),
              eq(permissions.entityType, 'workspace'),
              eq(permissions.entityId, workspaceId)
            )
          )

        // Insert the single new permission
        await tx.insert(permissions).values({
          id: crypto.randomUUID(),
          userId,
          entityType: 'workspace' as const,
          entityId: workspaceId,
          permissionType: update.permissions,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
      }
    })

    // Fetch and return the updated permissions
    const updatedUsersWithPermissions = await db
      .select({
        userId: user.id,
        email: user.email,
        name: user.name,
        image: user.image,
        permissionType: permissions.permissionType,
      })
      .from(permissions)
      .innerJoin(user, eq(permissions.userId, user.id))
      .where(
        and(
          eq(permissions.entityType, 'workspace'),
          eq(permissions.entityId, workspaceId)
        )
      )
      .orderBy(user.email)

    // Group permissions by user and determine highest permission level
    const userPermissionsMap = new Map<string, {
      userId: string
      email: string
      name: string | null
      image: string | null
      permissionType: PermissionType
    }>()

    for (const row of updatedUsersWithPermissions) {
      const key = row.userId
      
      if (!userPermissionsMap.has(key)) {
        userPermissionsMap.set(key, {
          userId: row.userId,
          email: row.email,
          name: row.name,
          image: row.image,
          permissionType: row.permissionType
        })
      } else {
        // If user already exists, keep the highest permission level
        const existing = userPermissionsMap.get(key)!
        const currentPermission = existing.permissionType
        const newPermission = row.permissionType
        
        // Permission hierarchy: admin > write > read
        const permissionOrder: Record<PermissionType, number> = { admin: 3, write: 2, read: 1 }
        
        if (permissionOrder[newPermission] > permissionOrder[currentPermission]) {
          existing.permissionType = newPermission
        }
      }
    }

    // Convert map to array
    const updatedUsers = Array.from(userPermissionsMap.values())

    return NextResponse.json({
      message: 'Permissions updated successfully',
      updatedUsers: body.updates.length,
      permissions: {
        users: updatedUsers,
        total: updatedUsers.length
      }
    })

  } catch (error) {
    console.error('Error updating workspace permissions:', error)
    return NextResponse.json(
      { error: 'Failed to update workspace permissions' },
      { status: 500 }
    )
  }
} 