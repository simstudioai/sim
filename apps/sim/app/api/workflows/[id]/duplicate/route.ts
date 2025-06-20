import crypto from 'crypto'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { workflow, workflowBlocks, workflowEdges, workflowSubflows } from '@/db/schema'

const logger = createLogger('WorkflowDuplicateAPI')

const DuplicateRequestSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  color: z.string().optional(),
  workspaceId: z.string().optional(),
  folderId: z.string().nullable().optional(),
})

// POST /api/workflows/[id]/duplicate - Duplicate a workflow with all its blocks, edges, and subflows
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: sourceWorkflowId } = await params
  const requestId = crypto.randomUUID().slice(0, 8)
  const startTime = Date.now()

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(
        `[${requestId}] Unauthorized workflow duplication attempt for ${sourceWorkflowId}`
      )
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { name, description, color, workspaceId, folderId } = DuplicateRequestSchema.parse(body)

    logger.info(
      `[${requestId}] Duplicating workflow ${sourceWorkflowId} for user ${session.user.id}`
    )

    // Generate new workflow ID
    const newWorkflowId = crypto.randomUUID()
    const now = new Date()

    // Duplicate workflow and all related data in a transaction
    const result = await db.transaction(async (tx) => {
      // First verify the source workflow exists and user has access
      const sourceWorkflow = await tx
        .select()
        .from(workflow)
        .where(and(eq(workflow.id, sourceWorkflowId), eq(workflow.userId, session.user.id)))
        .limit(1)

      if (sourceWorkflow.length === 0) {
        throw new Error('Source workflow not found or access denied')
      }

      const source = sourceWorkflow[0]

      // Create the new workflow first (required for foreign key constraints)
      await tx.insert(workflow).values({
        id: newWorkflowId,
        userId: session.user.id,
        workspaceId: workspaceId || source.workspaceId,
        folderId: folderId || source.folderId,
        name,
        description: description || source.description,
        state: source.state, // We'll update this later with new block IDs
        color: color || source.color,
        lastSynced: now,
        createdAt: now,
        updatedAt: now,
        isDeployed: false,
        collaborators: [],
        runCount: 0,
        variables: source.variables || {},
        isPublished: false,
        marketplaceData: null,
      })

      // Copy all blocks from source workflow with new IDs
      const sourceBlocks = await tx
        .select()
        .from(workflowBlocks)
        .where(eq(workflowBlocks.workflowId, sourceWorkflowId))

      // Create a mapping from old block IDs to new block IDs
      const blockIdMapping = new Map<string, string>()

      // Initialize state for updating with new block IDs
      let updatedState = source.state

      if (sourceBlocks.length > 0) {
        const newBlocks = sourceBlocks.map((block) => {
          const newBlockId = crypto.randomUUID()
          blockIdMapping.set(block.id, newBlockId)

          return {
            ...block,
            id: newBlockId,
            workflowId: newWorkflowId,
            createdAt: now,
            updatedAt: now,
          }
        })

        await tx.insert(workflowBlocks).values(newBlocks)
        logger.info(`[${requestId}] Copied ${sourceBlocks.length} blocks with new IDs`)
      }

      // Copy all edges from source workflow with updated block references
      const sourceEdges = await tx
        .select()
        .from(workflowEdges)
        .where(eq(workflowEdges.workflowId, sourceWorkflowId))

      if (sourceEdges.length > 0) {
        const newEdges = sourceEdges.map((edge) => ({
          ...edge,
          id: crypto.randomUUID(), // Generate new edge ID
          workflowId: newWorkflowId,
          sourceBlockId: blockIdMapping.get(edge.sourceBlockId) || edge.sourceBlockId,
          targetBlockId: blockIdMapping.get(edge.targetBlockId) || edge.targetBlockId,
          createdAt: now,
          updatedAt: now,
        }))

        await tx.insert(workflowEdges).values(newEdges)
        logger.info(
          `[${requestId}] Copied ${sourceEdges.length} edges with updated block references`
        )
      }

      // Copy all subflows from source workflow with new IDs and updated block references
      const sourceSubflows = await tx
        .select()
        .from(workflowSubflows)
        .where(eq(workflowSubflows.workflowId, sourceWorkflowId))

      if (sourceSubflows.length > 0) {
        const newSubflows = sourceSubflows.map((subflow) => {
          // Update block references in subflow config
          let updatedConfig = subflow.config
          if (subflow.config && typeof subflow.config === 'object') {
            updatedConfig = JSON.parse(JSON.stringify(subflow.config))

            // Update node references in config if they exist
            if (updatedConfig.nodes && Array.isArray(updatedConfig.nodes)) {
              updatedConfig.nodes = updatedConfig.nodes.map(
                (nodeId: string) => blockIdMapping.get(nodeId) || nodeId
              )
            }
          }

          return {
            ...subflow,
            id: crypto.randomUUID(), // Generate new subflow ID
            workflowId: newWorkflowId,
            config: updatedConfig,
            createdAt: now,
            updatedAt: now,
          }
        })

        await tx.insert(workflowSubflows).values(newSubflows)
        logger.info(
          `[${requestId}] Copied ${sourceSubflows.length} subflows with updated block references`
        )
      }

      // Update the JSON state to use new block IDs
      if (updatedState && typeof updatedState === 'object') {
        updatedState = JSON.parse(JSON.stringify(updatedState))

        // Update blocks object keys
        if (updatedState.blocks && typeof updatedState.blocks === 'object') {
          const newBlocks: any = {}
          for (const [oldId, blockData] of Object.entries(updatedState.blocks)) {
            const newId = blockIdMapping.get(oldId) || oldId
            newBlocks[newId] = {
              ...blockData,
              id: newId,
            }
          }
          updatedState.blocks = newBlocks
        }

        // Update edges array
        if (updatedState.edges && Array.isArray(updatedState.edges)) {
          updatedState.edges = updatedState.edges.map((edge: any) => ({
            ...edge,
            id: crypto.randomUUID(),
            source: blockIdMapping.get(edge.source) || edge.source,
            target: blockIdMapping.get(edge.target) || edge.target,
          }))
        }

        // Update loops and parallels if they exist
        if (updatedState.loops && typeof updatedState.loops === 'object') {
          const newLoops: any = {}
          for (const [oldId, loopData] of Object.entries(updatedState.loops)) {
            const newId = blockIdMapping.get(oldId) || oldId
            newLoops[newId] = loopData
          }
          updatedState.loops = newLoops
        }

        if (updatedState.parallels && typeof updatedState.parallels === 'object') {
          const newParallels: any = {}
          for (const [oldId, parallelData] of Object.entries(updatedState.parallels)) {
            const newId = blockIdMapping.get(oldId) || oldId
            newParallels[newId] = parallelData
          }
          updatedState.parallels = newParallels
        }
      }

      // Update the workflow state with the new block IDs
      await tx
        .update(workflow)
        .set({
          state: updatedState,
          updatedAt: now,
        })
        .where(eq(workflow.id, newWorkflowId))

      return {
        id: newWorkflowId,
        name,
        description: description || source.description,
        color: color || source.color,
        workspaceId: workspaceId || source.workspaceId,
        folderId: folderId || source.folderId,
        blocksCount: sourceBlocks.length,
        edgesCount: sourceEdges.length,
        subflowsCount: sourceSubflows.length,
      }
    })

    const elapsed = Date.now() - startTime
    logger.info(
      `[${requestId}] Successfully duplicated workflow ${sourceWorkflowId} to ${newWorkflowId} in ${elapsed}ms`
    )

    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message === 'Source workflow not found or access denied') {
      logger.warn(
        `[${requestId}] Source workflow ${sourceWorkflowId} not found or access denied for user ${session.user.id}`
      )
      return NextResponse.json({ error: 'Source workflow not found' }, { status: 404 })
    }

    if (error instanceof z.ZodError) {
      logger.warn(`[${requestId}] Invalid duplication request data`, { errors: error.errors })
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    const elapsed = Date.now() - startTime
    logger.error(
      `[${requestId}] Error duplicating workflow ${sourceWorkflowId} after ${elapsed}ms:`,
      error
    )
    return NextResponse.json({ error: 'Failed to duplicate workflow' }, { status: 500 })
  }
}
