import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/db'
import { workspace, workspaceMember, permissions, permissionTypeEnum } from '@/db/schema'
import { getUserEntityPermissions, type PermissionType } from '@/lib/permissions/utils'

/**
 * Helper function to check if a user has a specific permission for a workspace
 */
async function hasWorkspacePermission(
  userId: string, 
  workspaceId: string, 
  permission: PermissionType
): Promise<boolean> {
  const result = await db
    .select()
    .from(permissions)
    .where(and(
      eq(permissions.userId, userId),
      eq(permissions.entityType, 'workspace'),
      eq(permissions.entityId, workspaceId),
      eq(permissions.permissionType, permission)
    ))
    .limit(1)
    
  return result.length > 0
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const workspaceId = id

  // Check if user has read access to this workspace
  const hasReadAccess = await hasWorkspacePermission(session.user.id, workspaceId, 'read')
  
  if (!hasReadAccess) {
    return NextResponse.json({ error: 'Workspace not found or access denied' }, { status: 404 })
  }

  // Get workspace details
  const workspaceDetails = await db
    .select()
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .then((rows) => rows[0])

  if (!workspaceDetails) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
  }

  // Get user's permissions for this workspace
  const userPermissions = await getUserEntityPermissions(session.user.id, 'workspace', workspaceId)

  return NextResponse.json({
    workspace: {
      ...workspaceDetails,
      permissions: userPermissions,
    },
  })
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const workspaceId = id

  // Check if user has admin permissions to update workspace
  const hasAdminAccess = await hasWorkspacePermission(session.user.id, workspaceId, 'admin')
  
  if (!hasAdminAccess) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  try {
    const { name } = await request.json()

    if (!name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }

    // Update workspace
    await db
      .update(workspace)
      .set({
        name,
        updatedAt: new Date(),
      })
      .where(eq(workspace.id, workspaceId))

    // Get updated workspace
    const updatedWorkspace = await db
      .select()
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .then((rows) => rows[0])

    // Get user's permissions for this workspace
    const userPermissions = await getUserEntityPermissions(session.user.id, 'workspace', workspaceId)

    return NextResponse.json({
      workspace: {
        ...updatedWorkspace,
        permissions: userPermissions,
      },
    })
  } catch (error) {
    console.error('Error updating workspace:', error)
    return NextResponse.json({ error: 'Failed to update workspace' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const workspaceId = id

  // Check if user has admin permissions to delete workspace
  const hasAdminAccess = await hasWorkspacePermission(session.user.id, workspaceId, 'admin')
  
  if (!hasAdminAccess) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  try {
    // Use a transaction to ensure data consistency
    await db.transaction(async (tx) => {
      // 1. Delete all permissions associated with this workspace
      await tx
        .delete(permissions)
        .where(
          and(
            eq(permissions.entityType, 'workspace'),
            eq(permissions.entityId, workspaceId)
          )
        )

      // 2. Delete workspace (cascade will handle members, workflows, etc.)
      await tx.delete(workspace).where(eq(workspace.id, workspaceId))
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting workspace:', error)
    return NextResponse.json({ error: 'Failed to delete workspace' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Reuse the PATCH handler implementation for PUT requests
  return PATCH(request, { params })
}
