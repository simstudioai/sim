import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { saveWorkflowToNormalizedTables } from '@/lib/workflows/db-helpers'
import { db } from '@/db'
import { workflow } from '@/db/schema'

const logger = createLogger('WorkflowStateAPI')

// Schema for workflow state updates
const WorkflowStateSchema = z.object({
  state: z.object({
    blocks: z.record(z.any()),
    edges: z.array(z.any()),
    loops: z.record(z.any()).optional().default({}),
    parallels: z.record(z.any()).optional().default({}),
    lastSaved: z.number().optional(),
    isDeployed: z.boolean().optional().default(false),
    deployedAt: z.date().optional(),
    deploymentStatuses: z.record(z.any()).optional().default({}),
    hasActiveSchedule: z.boolean().optional().default(false),
    hasActiveWebhook: z.boolean().optional().default(false),
  }),
  subblockValues: z.record(z.any()).optional().default({}),
})

/**
 * PUT /api/workflows/[id]/state
 * Save workflow state for non-collaborative mode
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const startTime = Date.now()
  const { id: workflowId } = await params

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized workflow state save attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { state, subblockValues } = WorkflowStateSchema.parse(body)

    logger.info(`[${requestId}] Saving workflow state for ${workflowId}`)

    // Verify workflow exists and user has access
    const existingWorkflow = await db
      .select()
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .limit(1)

    if (!existingWorkflow.length) {
      logger.warn(`[${requestId}] Workflow ${workflowId} not found`)
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    const workflowData = existingWorkflow[0]

    // Check if user has access to this workflow
    if (workflowData.userId !== session.user.id) {
      // TODO: Add workspace member check here if needed
      logger.warn(`[${requestId}] User ${session.user.id} denied access to workflow ${workflowId}`)
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Merge subblock values into blocks before saving
    const mergedState = { ...state }
    if (subblockValues && Object.keys(subblockValues).length > 0) {
      logger.info(`[${requestId}] Merging subblock values for ${Object.keys(subblockValues).length} blocks`)

      // Update each block's subBlocks with the current values
      Object.entries(subblockValues).forEach(([blockId, blockSubblocks]) => {
        if (mergedState.blocks[blockId]) {
          // Merge subblock values into the block's subBlocks
          const currentSubBlocks = mergedState.blocks[blockId].subBlocks || {}
          Object.entries(blockSubblocks as Record<string, any>).forEach(([subblockId, value]) => {
            if (!currentSubBlocks[subblockId]) {
              currentSubBlocks[subblockId] = { id: subblockId, type: 'text', value }
            } else {
              currentSubBlocks[subblockId].value = value
            }
          })
          mergedState.blocks[blockId].subBlocks = currentSubBlocks
        }
      })
    }

    // Save to normalized tables
    const saveResult = await saveWorkflowToNormalizedTables(workflowId, mergedState)

    if (!saveResult.success) {
      logger.error(`[${requestId}] Failed to save workflow to normalized tables:`, saveResult.error)
      return NextResponse.json({ error: 'Failed to save workflow state' }, { status: 500 })
    }

    // Update the workflow's JSON state for backward compatibility
    const updatedState = {
      ...mergedState,
      lastSaved: Date.now(),
    }

    await db
      .update(workflow)
      .set({
        state: updatedState,
        updatedAt: new Date(),
      })
      .where(eq(workflow.id, workflowId))

    const elapsed = Date.now() - startTime
    logger.info(`[${requestId}] Successfully saved workflow ${workflowId} in ${elapsed}ms`)

    return NextResponse.json({
      success: true,
      lastSaved: updatedState.lastSaved,
    })
  } catch (error) {
    const elapsed = Date.now() - startTime
    logger.error(`[${requestId}] Error saving workflow state after ${elapsed}ms:`, error)

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid workflow state data', details: error.errors },
        { status: 400 }
      )
    }

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
