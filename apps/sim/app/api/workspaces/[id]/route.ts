import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { workspace, workspaceMember, workflow, workflowBlocks, workflowEdges, workflowSubflows } from '@/db/schema'

const logger = createLogger('WorkspaceByIdAPI')

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const workspaceId = id

  // Check if user is a member of this workspace
  const membership = await db
    .select()
    .from(workspaceMember)
    .where(
      and(eq(workspaceMember.workspaceId, workspaceId), eq(workspaceMember.userId, session.user.id))
    )
    .then((rows) => rows[0])

  if (!membership) {
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
      role: membership.role,
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

  // Check if user is a member with appropriate permissions
  const membership = await db
    .select()
    .from(workspaceMember)
    .where(
      and(eq(workspaceMember.workspaceId, workspaceId), eq(workspaceMember.userId, session.user.id))
    )
    .then((rows) => rows[0])

  if (!membership) {
    return NextResponse.json({ error: 'Workspace not found or access denied' }, { status: 404 })
  }

  // For now, only allow owners to update workspace
  if (membership.role !== 'owner') {
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
        role: membership.role,
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

  // Check if user is the owner
  const membership = await db
    .select()
    .from(workspaceMember)
    .where(
      and(eq(workspaceMember.workspaceId, workspaceId), eq(workspaceMember.userId, session.user.id))
    )
    .then((rows) => rows[0])

  if (!membership || membership.role !== 'owner') {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  try {
    logger.info(`Deleting workspace ${workspaceId} for user ${session.user.id}`)

    // Delete workspace and all related data in a transaction
    await db.transaction(async (tx) => {
      // Get all workflows in this workspace
      const workspaceWorkflows = await tx
        .select({ id: workflow.id })
        .from(workflow)
        .where(eq(workflow.workspaceId, workspaceId))

      // Delete all workflow-related data for each workflow
      for (const wf of workspaceWorkflows) {
        await tx.delete(workflowSubflows).where(eq(workflowSubflows.workflowId, wf.id))
        await tx.delete(workflowEdges).where(eq(workflowEdges.workflowId, wf.id))
        await tx.delete(workflowBlocks).where(eq(workflowBlocks.workflowId, wf.id))
      }

      // Delete all workflows in the workspace
      await tx.delete(workflow).where(eq(workflow.workspaceId, workspaceId))

      // Delete workspace members
      await tx.delete(workspaceMember).where(eq(workspaceMember.workspaceId, workspaceId))

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
