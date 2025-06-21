import { and, eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/db'
import { permissions, type permissionTypeEnum, user, workspaceMember } from '@/db/schema'

// Extract the enum type from Drizzle schema
type PermissionType = (typeof permissionTypeEnum.enumValues)[number]

/**
 * Helper function to check if a user has admin permission for a workspace
 */
async function hasAdminPermission(userId: string, workspaceId: string): Promise<boolean> {
  const result = await db
    .select()
    .from(permissions)
    .where(
      and(
        eq(permissions.userId, userId),
        eq(permissions.entityType, 'workspace'),
        eq(permissions.entityId, workspaceId),
        eq(permissions.permissionType, 'admin')
      )
    )
    .limit(1)

  return result.length > 0
}

/**
 * Helper function to create default permissions for a new member
 */
async function createMemberPermissions(
  userId: string,
  workspaceId: string,
  memberPermission: PermissionType = 'read'
): Promise<void> {
  await db.insert(permissions).values({
    id: crypto.randomUUID(),
    userId,
    entityType: 'workspace' as const,
    entityId: workspaceId,
    permissionType: memberPermission,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
}

// Add a member to a workspace
export async function POST(req: Request) {
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { workspaceId, userEmail, permission = 'read' } = await req.json()

    if (!workspaceId || !userEmail) {
      return NextResponse.json(
        { error: 'Workspace ID and user email are required' },
        { status: 400 }
      )
    }

    // Validate permission type
    const validPermissions: PermissionType[] = ['admin', 'write', 'read']
    if (!validPermissions.includes(permission)) {
      return NextResponse.json(
        { error: `Invalid permission: must be one of ${validPermissions.join(', ')}` },
        { status: 400 }
      )
    }

    // Check if current user has admin permission for the workspace
    const hasAdmin = await hasAdminPermission(session.user.id, workspaceId)

    if (!hasAdmin) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    // Find user by email
    const targetUser = await db
      .select()
      .from(user)
      .where(eq(user.email, userEmail))
      .then((rows) => rows[0])

    if (!targetUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Check if user already has permissions for this workspace
    const existingPermissions = await db
      .select()
      .from(permissions)
      .where(
        and(
          eq(permissions.userId, targetUser.id),
          eq(permissions.entityType, 'workspace'),
          eq(permissions.entityId, workspaceId)
        )
      )

    if (existingPermissions.length > 0) {
      return NextResponse.json(
        { error: 'User already has permissions for this workspace' },
        { status: 400 }
      )
    }

    // Use a transaction to ensure data consistency
    await db.transaction(async (tx) => {
      // Add user to workspace members table (keeping for compatibility)
      await tx.insert(workspaceMember).values({
        id: crypto.randomUUID(),
        workspaceId,
        userId: targetUser.id,
        role: 'member', // Default role for compatibility
        joinedAt: new Date(),
        updatedAt: new Date(),
      })

      // Create single permission for the new member
      await tx.insert(permissions).values({
        id: crypto.randomUUID(),
        userId: targetUser.id,
        entityType: 'workspace' as const,
        entityId: workspaceId,
        permissionType: permission,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    })

    return NextResponse.json({
      success: true,
      message: `User added to workspace with ${permission} permission`,
    })
  } catch (error) {
    console.error('Error adding workspace member:', error)
    return NextResponse.json({ error: 'Failed to add workspace member' }, { status: 500 })
  }
}
