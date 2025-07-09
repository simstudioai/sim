import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { getUserEntityPermissions } from '@/lib/permissions/utils'
import { saveWorkflowToNormalizedTables } from '@/lib/workflows/db-helpers'
import { db } from '@/db'
import { workflow } from '@/db/schema'

const logger = createLogger('WorkflowStateAPI')

const WorkflowStateSchema = z.object({
  blocks: z.record(z.any()),
  edges: z.array(z.any()),
  loops: z.record(z.any()).optional(),
  parallels: z.record(z.any()).optional(),
  lastSaved: z.number().optional(),
  isDeployed: z.boolean().optional(),
  deployedAt: z.date().optional(),
  deploymentStatuses: z.record(z.any()).optional(),
  hasActiveSchedule: z.boolean().optional(),
  hasActiveWebhook: z.boolean().optional(),
})

/**
 * PUT /api/workflows/[id]/state
 * Save complete workflow state to normalized database tables
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const startTime = Date.now()
  const { id: workflowId } = await params

  try {
    // Get the session
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized state update attempt for workflow ${workflowId}`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    // Parse and validate request body
    const body = await request.json()
    const state = WorkflowStateSchema.parse(body)

    // Fetch the workflow to check ownership/access
    const workflowData = await db
      .select()
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .then((rows) => rows[0])

    if (!workflowData) {
      logger.warn(`[${requestId}] Workflow ${workflowId} not found for state update`)
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    // Check if user has permission to update this workflow
    let canUpdate = false

    // Case 1: User owns the workflow
    if (workflowData.userId === userId) {
      canUpdate = true
    }

    // Case 2: Workflow belongs to a workspace and user has write or admin permission
    if (!canUpdate && workflowData.workspaceId) {
      const userPermission = await getUserEntityPermissions(
        userId,
        'workspace',
        workflowData.workspaceId
      )
      if (userPermission === 'write' || userPermission === 'admin') {
        canUpdate = true
      }
    }

    if (!canUpdate) {
      logger.warn(
        `[${requestId}] User ${userId} denied permission to update workflow state ${workflowId}`
      )
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Save to normalized tables
    logger.info(`[${requestId}] Saving workflow ${workflowId} state to normalized tables`)
    
    // Ensure all required fields are present for WorkflowState type
    const workflowState = {
      blocks: state.blocks,
      edges: state.edges,
      loops: state.loops || {},
      parallels: state.parallels || {},
      lastSaved: state.lastSaved || Date.now(),
      isDeployed: state.isDeployed || false,
      deployedAt: state.deployedAt,
      deploymentStatuses: state.deploymentStatuses || {},
      hasActiveSchedule: state.hasActiveSchedule || false,
      hasActiveWebhook: state.hasActiveWebhook || false,
    }
    
    const saveResult = await saveWorkflowToNormalizedTables(workflowId, workflowState)

    if (!saveResult.success) {
      logger.error(`[${requestId}] Failed to save workflow ${workflowId} state:`, saveResult.error)
      return NextResponse.json(
        { error: 'Failed to save workflow state', details: saveResult.error },
        { status: 500 }
      )
    }

    // Update workflow's lastSynced timestamp
    await db
      .update(workflow)
      .set({ 
        lastSynced: new Date(),
        updatedAt: new Date(),
        state: saveResult.jsonBlob // Also update JSON blob for backward compatibility
      })
      .where(eq(workflow.id, workflowId))

    const elapsed = Date.now() - startTime
    logger.info(`[${requestId}] Successfully saved workflow ${workflowId} state in ${elapsed}ms`)

    return NextResponse.json({ 
      success: true, 
      blocksCount: Object.keys(state.blocks).length,
      edgesCount: state.edges.length 
    }, { status: 200 })

  } catch (error: any) {
    const elapsed = Date.now() - startTime
    if (error instanceof z.ZodError) {
      logger.warn(`[${requestId}] Invalid workflow state data for ${workflowId}`, {
        errors: error.errors,
      })
      return NextResponse.json(
        { error: 'Invalid state data', details: error.errors },
        { status: 400 }
      )
    }

    logger.error(`[${requestId}] Error saving workflow ${workflowId} state after ${elapsed}ms`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
} 