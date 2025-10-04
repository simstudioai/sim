import { db } from '@sim/db'
import { workflow } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { getUserEntityPermissions } from '@/lib/permissions/utils'
import { generateRequestId } from '@/lib/utils'
import { extractAndPersistCustomTools } from '@/lib/workflows/custom-tools-persistence'
import { saveWorkflowToNormalizedTables } from '@/lib/workflows/db-helpers'
import { sanitizeAgentToolsInBlocks } from '@/lib/workflows/validation'

const logger = createLogger('WorkflowStateAPI')

const PositionSchema = z.object({
  x: z.number(),
  y: z.number(),
})

const BlockDataSchema = z.object({
  parentId: z.string().optional(),
  extent: z.literal('parent').optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  collection: z.unknown().optional(),
  count: z.number().optional(),
  loopType: z.enum(['for', 'forEach']).optional(),
  parallelType: z.enum(['collection', 'count']).optional(),
  type: z.string().optional(),
})

const SubBlockStateSchema = z.object({
  id: z.string(),
  type: z.string(),
  value: z.any(),
})

const BlockOutputSchema = z.any()

const BlockStateSchema = z.object({
  id: z.string(),
  type: z.string(),
  name: z.string(),
  position: PositionSchema,
  subBlocks: z.record(SubBlockStateSchema),
  outputs: z.record(BlockOutputSchema),
  enabled: z.boolean(),
  horizontalHandles: z.boolean().optional(),
  isWide: z.boolean().optional(),
  height: z.number().optional(),
  advancedMode: z.boolean().optional(),
  triggerMode: z.boolean().optional(),
  data: BlockDataSchema.optional(),
})

const EdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  sourceHandle: z.string().optional(),
  targetHandle: z.string().optional(),
  type: z.string().optional(),
  animated: z.boolean().optional(),
  style: z.record(z.any()).optional(),
  data: z.record(z.any()).optional(),
  label: z.string().optional(),
  labelStyle: z.record(z.any()).optional(),
  labelShowBg: z.boolean().optional(),
  labelBgStyle: z.record(z.any()).optional(),
  labelBgPadding: z.array(z.number()).optional(),
  labelBgBorderRadius: z.number().optional(),
  markerStart: z.string().optional(),
  markerEnd: z.string().optional(),
})

const LoopSchema = z.object({
  id: z.string(),
  nodes: z.array(z.string()),
  iterations: z.number(),
  loopType: z.enum(['for', 'forEach']),
  forEachItems: z.union([z.array(z.any()), z.record(z.any()), z.string()]).optional(),
})

const ParallelSchema = z.object({
  id: z.string(),
  nodes: z.array(z.string()),
  distribution: z.union([z.array(z.any()), z.record(z.any()), z.string()]).optional(),
  count: z.number().optional(),
  parallelType: z.enum(['count', 'collection']).optional(),
})

const WorkflowStateSchema = z.object({
  blocks: z.record(BlockStateSchema),
  edges: z.array(EdgeSchema),
  loops: z.record(LoopSchema).optional(),
  parallels: z.record(ParallelSchema).optional(),
  lastSaved: z.number().optional(),
  isDeployed: z.boolean().optional(),
  deployedAt: z.coerce.date().optional(),
})

/**
 * PUT /api/workflows/[id]/state
 * Save complete workflow state to normalized database tables
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()
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

    // Sanitize custom tools in agent blocks before saving
    const { blocks: sanitizedBlocks, warnings } = sanitizeAgentToolsInBlocks(state.blocks as any)

    // Save to normalized tables
    // Ensure all required fields are present for WorkflowState type
    // Filter out blocks without type or name before saving
    const filteredBlocks = Object.entries(sanitizedBlocks).reduce(
      (acc, [blockId, block]: [string, any]) => {
        if (block.type && block.name) {
          // Ensure all required fields are present
          acc[blockId] = {
            ...block,
            enabled: block.enabled !== undefined ? block.enabled : true,
            horizontalHandles:
              block.horizontalHandles !== undefined ? block.horizontalHandles : true,
            isWide: block.isWide !== undefined ? block.isWide : false,
            height: block.height !== undefined ? block.height : 0,
            subBlocks: block.subBlocks || {},
            outputs: block.outputs || {},
          }
        }
        return acc
      },
      {} as typeof state.blocks
    )

    const workflowState = {
      blocks: filteredBlocks,
      edges: state.edges,
      loops: state.loops || {},
      parallels: state.parallels || {},
      lastSaved: state.lastSaved || Date.now(),
      isDeployed: state.isDeployed || false,
      deployedAt: state.deployedAt,
    }

    const saveResult = await saveWorkflowToNormalizedTables(workflowId, workflowState as any)

    if (!saveResult.success) {
      logger.error(`[${requestId}] Failed to save workflow ${workflowId} state:`, saveResult.error)
      return NextResponse.json(
        { error: 'Failed to save workflow state', details: saveResult.error },
        { status: 500 }
      )
    }

    // Extract and persist custom tools to database
    try {
      const { saved, errors } = await extractAndPersistCustomTools(workflowState, userId)

      if (saved > 0) {
        logger.info(`[${requestId}] Persisted ${saved} custom tool(s) to database`, { workflowId })
      }

      if (errors.length > 0) {
        logger.warn(`[${requestId}] Some custom tools failed to persist`, { errors, workflowId })
      }
    } catch (error) {
      logger.error(`[${requestId}] Failed to persist custom tools`, { error, workflowId })
    }

    // Update workflow's lastSynced timestamp
    await db
      .update(workflow)
      .set({
        lastSynced: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(workflow.id, workflowId))

    const elapsed = Date.now() - startTime
    logger.info(`[${requestId}] Successfully saved workflow ${workflowId} state in ${elapsed}ms`)

    return NextResponse.json({ success: true, warnings }, { status: 200 })
  } catch (error: any) {
    const elapsed = Date.now() - startTime
    logger.error(
      `[${requestId}] Error saving workflow ${workflowId} state after ${elapsed}ms`,
      error
    )

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request body', details: error.errors },
        { status: 400 }
      )
    }

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
