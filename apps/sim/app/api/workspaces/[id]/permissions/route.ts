import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/db'
import { permissions, user, workspaceMember, permissionTypeEnum } from '@/db/schema'

// Extract the enum type from Drizzle schema
type PermissionType = typeof permissionTypeEnum.enumValues[number]

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

    // Group permissions by user
    const userPermissionsMap = new Map<string, {
      userId: string
      email: string
      name: string | null
      image: string | null
      permissions: PermissionType[]
    }>()

    for (const row of usersWithPermissions) {
      const key = row.userId
      
      if (!userPermissionsMap.has(key)) {
        userPermissionsMap.set(key, {
          userId: row.userId,
          email: row.email,
          name: row.name,
          image: row.image,
          permissions: []
        })
      }
      
      userPermissionsMap.get(key)!.permissions.push(row.permissionType)
    }

    // Convert map to array and sort permissions consistently
    const result = Array.from(userPermissionsMap.values()).map(user => ({
      ...user,
      permissions: user.permissions.sort((a, b) => {
        // Sort permissions in logical order: admin, deploy, edit, read
        const order: Record<PermissionType, number> = { admin: 0, deploy: 1, edit: 2, read: 3 }
        return order[a] - order[b]
      })
    }))

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