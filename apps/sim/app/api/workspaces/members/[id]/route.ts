import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { hasWorkspaceAdminAccess } from '@/lib/permissions/utils'
import { db } from '@/db'
import { permissions } from '@/db/schema'

// DELETE /api/workspaces/members/[id] - Remove a member from a workspace
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: userId } = await params
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Get the workspace ID from the request body or URL
    const body = await req.json()
    const workspaceId = body.workspaceId

    if (!workspaceId) {
      return NextResponse.json({ error: 'Workspace ID is required' }, { status: 400 })
    }

    // Check if the user to be removed actually has permissions for this workspace
    const userPermission = await db
      .select()
      .from(permissions)
      .where(
        and(
          eq(permissions.userId, userId),
          eq(permissions.entityType, 'workspace'),
          eq(permissions.entityId, workspaceId)
        )
      )
      .then((rows) => rows[0])

    if (!userPermission) {
      return NextResponse.json({ error: 'User not found in workspace' }, { status: 404 })
    }

    // Check if current user has admin access to this workspace
    const hasAdminAccess = await hasWorkspaceAdminAccess(session.user.id, workspaceId)
    const isSelf = userId === session.user.id

    if (!hasAdminAccess && !isSelf) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    // Prevent removing yourself if you're the last admin
    if (isSelf && userPermission.permissionType === 'admin') {
      const otherAdmins = await db
        .select()
        .from(permissions)
        .where(
          and(
            eq(permissions.entityType, 'workspace'),
            eq(permissions.entityId, workspaceId),
            eq(permissions.permissionType, 'admin')
          )
        )
        .then((rows) => rows.filter((row) => row.userId !== session.user.id))

      if (otherAdmins.length === 0) {
        return NextResponse.json(
          { error: 'Cannot remove the last admin from a workspace' },
          { status: 400 }
        )
      }
    }

    // Delete the user's permissions for this workspace
    await db
      .delete(permissions)
      .where(
        and(
          eq(permissions.userId, userId),
          eq(permissions.entityType, 'workspace'),
          eq(permissions.entityId, workspaceId)
        )
      )

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error removing workspace member:', error)
    return NextResponse.json({ error: 'Failed to remove workspace member' }, { status: 500 })
  }
}
