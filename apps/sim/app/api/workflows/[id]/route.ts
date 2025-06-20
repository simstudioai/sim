import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/db-helpers'
import { db } from '@/db'
import {
  workflow,
  workflowBlocks,
  workflowEdges,
  workflowSubflows,
  workspaceMember,
} from '@/db/schema'

const logger = createLogger('WorkflowByIdAPI')

/**
 * GET /api/workflows/[id]
 * Fetch a single workflow by ID
 * Uses hybrid approach: try normalized tables first, fallback to JSON blob
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const startTime = Date.now()
  const { id: workflowId } = await params

  try {
    // Get the session
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized access attempt for workflow ${workflowId}`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    // Fetch the workflow
    const workflowData = await db
      .select()
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .then((rows) => rows[0])

    if (!workflowData) {
      logger.warn(`[${requestId}] Workflow ${workflowId} not found`)
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    // Check if user has access to this workflow
    let hasAccess = false

    // Case 1: User owns the workflow
    if (workflowData.userId === userId) {
      hasAccess = true
    }

    // Case 2: Workflow belongs to a workspace the user is a member of
    if (!hasAccess && workflowData.workspaceId) {
      const membership = await db
        .select({ id: workspaceMember.id })
        .from(workspaceMember)
        .where(
          and(
            eq(workspaceMember.workspaceId, workflowData.workspaceId),
            eq(workspaceMember.userId, userId)
          )
        )
        .then((rows) => rows[0])

      if (membership) {
        hasAccess = true
      }
    }

    if (!hasAccess) {
      logger.warn(`[${requestId}] User ${userId} denied access to workflow ${workflowId}`)
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Try to load from normalized tables first
    const normalizedData = await loadWorkflowFromNormalizedTables(workflowId)

    const finalWorkflowData = { ...workflowData }

    if (normalizedData) {
      // Use normalized table data - reconstruct complete state object
      // First get any existing state properties, then override with normalized data
      const existingState =
        workflowData.state && typeof workflowData.state === 'object' ? workflowData.state : {}

      finalWorkflowData.state = {
        // Default values for expected properties
        deploymentStatuses: {},
        hasActiveSchedule: false,
        hasActiveWebhook: false,
        // Preserve any existing state properties
        ...existingState,
        // Override with normalized data (this takes precedence)
        blocks: normalizedData.blocks,
        edges: normalizedData.edges,
        loops: normalizedData.loops,
        parallels: normalizedData.parallels,
        lastSaved: Date.now(),
        isDeployed: workflowData.isDeployed || false,
        deployedAt: workflowData.deployedAt,
      }
      logger.info(`[${requestId}] Loaded workflow ${workflowId} from normalized tables`)
    } else {
      // Fallback to JSON blob
      logger.info(`[${requestId}] Using JSON blob for workflow ${workflowId}`)
    }

    const elapsed = Date.now() - startTime
    logger.info(`[${requestId}] Successfully fetched workflow ${workflowId} in ${elapsed}ms`)

    return NextResponse.json({ data: finalWorkflowData }, { status: 200 })
  } catch (error: any) {
    const elapsed = Date.now() - startTime
    logger.error(`[${requestId}] Error fetching workflow ${workflowId} after ${elapsed}ms`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/workflows/[id]
 * Delete a workflow by ID
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const startTime = Date.now()
  const { id: workflowId } = await params

  try {
    // Get the session
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized deletion attempt for workflow ${workflowId}`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    // Fetch the workflow to check ownership/access
    const workflowData = await db
      .select()
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .then((rows) => rows[0])

    if (!workflowData) {
      logger.warn(`[${requestId}] Workflow ${workflowId} not found for deletion`)
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    // Check if user has permission to delete this workflow
    let canDelete = false

    // Case 1: User owns the workflow
    if (workflowData.userId === userId) {
      canDelete = true
    }

    // Case 2: Workflow belongs to a workspace and user has admin/owner role
    if (!canDelete && workflowData.workspaceId) {
      const membership = await db
        .select({ role: workspaceMember.role })
        .from(workspaceMember)
        .where(
          and(
            eq(workspaceMember.workspaceId, workflowData.workspaceId),
            eq(workspaceMember.userId, userId)
          )
        )
        .then((rows) => rows[0])

      if (membership && (membership.role === 'owner' || membership.role === 'admin')) {
        canDelete = true
      }
    }

    if (!canDelete) {
      logger.warn(
        `[${requestId}] User ${userId} denied permission to delete workflow ${workflowId}`
      )
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Delete workflow and all related data in a transaction
    await db.transaction(async (tx) => {
      // Delete from normalized tables first (foreign key constraints)
      await tx.delete(workflowSubflows).where(eq(workflowSubflows.workflowId, workflowId))
      await tx.delete(workflowEdges).where(eq(workflowEdges.workflowId, workflowId))
      await tx.delete(workflowBlocks).where(eq(workflowBlocks.workflowId, workflowId))

      // Delete the main workflow record
      await tx.delete(workflow).where(eq(workflow.id, workflowId))
    })

    const elapsed = Date.now() - startTime
    logger.info(`[${requestId}] Successfully deleted workflow ${workflowId} in ${elapsed}ms`)

    // Notify Socket.IO system to disconnect users from this workflow's room
    // This prevents "Block not found" errors when collaborative updates try to process
    // after the workflow has been deleted
    try {
      const socketResponse = await fetch('http://localhost:3002/api/workflow-deleted', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowId }),
      })

      if (socketResponse.ok) {
        logger.info(
          `[${requestId}] Notified Socket.IO server about workflow ${workflowId} deletion`
        )
      } else {
        logger.warn(
          `[${requestId}] Failed to notify Socket.IO server about workflow ${workflowId} deletion`
        )
      }
    } catch (error) {
      logger.warn(
        `[${requestId}] Error notifying Socket.IO server about workflow ${workflowId} deletion:`,
        error
      )
      // Don't fail the deletion if Socket.IO notification fails
    }

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error: any) {
    const elapsed = Date.now() - startTime
    logger.error(`[${requestId}] Error deleting workflow ${workflowId} after ${elapsed}ms`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
