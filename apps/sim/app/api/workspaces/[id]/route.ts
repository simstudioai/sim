import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { workflow } from '@/db/schema'

const logger = createLogger('WorkspaceByIdAPI')

import { getUserEntityPermissions } from '@/lib/permissions/utils'
import { db } from '@/db'
import { permissions, workspace } from '@/db/schema'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const workspaceId = id

  // Check if user has any access to this workspace
  const userPermission = await getUserEntityPermissions(session.user.id, 'workspace', workspaceId)
  if (!userPermission) {
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

  return NextResponse.json({
    workspace: {
      ...workspaceDetails,
      permissions: userPermission,
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
  const userPermission = await getUserEntityPermissions(session.user.id, 'workspace', workspaceId)
  if (userPermission !== 'admin') {
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

    return NextResponse.json({
      workspace: {
        ...updatedWorkspace,
        permissions: userPermission,
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
  const userPermission = await getUserEntityPermissions(session.user.id, 'workspace', workspaceId)
  if (userPermission !== 'admin') {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  try {
    logger.info(`Deleting workspace ${workspaceId} for user ${session.user.id}`)

    // Delete workspace and all related data in a transaction
    await db.transaction(async (tx) => {
      // Delete all workflows in the workspace - database cascade will handle all workflow-related data
      // The database cascade will handle deleting related workflow_blocks, workflow_edges, workflow_subflows,
      // workflow_logs, workflow_execution_snapshots, workflow_execution_logs, workflow_execution_trace_spans,
      // workflow_schedule, webhook, marketplace, chat, and memory records
      await tx.delete(workflow).where(eq(workflow.workspaceId, workspaceId))

      // Delete all permissions associated with this workspace
      await tx
        .delete(permissions)
        .where(and(eq(permissions.entityType, 'workspace'), eq(permissions.entityId, workspaceId)))

      // Delete the workspace itself
      await tx.delete(workspace).where(eq(workspace.id, workspaceId))

      logger.info(`Successfully deleted workspace ${workspaceId} and all related data`)
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error(`Error deleting workspace ${workspaceId}:`, error)
    return NextResponse.json({ error: 'Failed to delete workspace' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Reuse the PATCH handler implementation for PUT requests
  return PATCH(request, { params })
}
