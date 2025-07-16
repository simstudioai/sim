import { and, eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { hasAdminPermission } from '@/lib/permissions/utils'
import { db } from '@/db'
import { permissions, type permissionTypeEnum, user } from '@/db/schema'

type PermissionType = (typeof permissionTypeEnum.enumValues)[number]

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

    // Create single permission for the new member
    await db.insert(permissions).values({
      id: crypto.randomUUID(),
      userId: targetUser.id,
      entityType: 'workspace' as const,
      entityId: workspaceId,
      permissionType: permission,
      createdAt: new Date(),
      updatedAt: new Date(),
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
