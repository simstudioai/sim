import { eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { createLogger } from '@/lib/logs/console-logger'
import { hasWorkflowChanged } from '@/lib/workflows/utils'
import { db } from '@/db'
import { workflowBlocks, workflowEdges, workflowSubflows } from '@/db/schema'
import { validateWorkflowAccess } from '../../middleware'
import { createErrorResponse, createSuccessResponse } from '../../utils'

const logger = createLogger('WorkflowStatusAPI')

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    const { id } = await params

    const validation = await validateWorkflowAccess(request, id, false)
    if (validation.error) {
      logger.warn(`[${requestId}] Workflow access validation failed: ${validation.error.message}`)
      return createErrorResponse(validation.error.message, validation.error.status)
    }

    // Check if the workflow has meaningful changes that would require redeployment
    let needsRedeployment = false
    if (validation.workflow.isDeployed && validation.workflow.deployedState) {
      // Get current state from normalized tables (same logic as deployment API)
      const blocks = await db.select().from(workflowBlocks).where(eq(workflowBlocks.workflowId, id))

      const edges = await db.select().from(workflowEdges).where(eq(workflowEdges.workflowId, id))

      const subflows = await db
        .select()
        .from(workflowSubflows)
        .where(eq(workflowSubflows.workflowId, id))

      // Build current state from normalized data
      const blocksMap: Record<string, any> = {}
      const loops: Record<string, any> = {}
      const parallels: Record<string, any> = {}

      // Process blocks
      blocks.forEach((block) => {
        blocksMap[block.id] = {
          id: block.id,
          type: block.type,
          name: block.name,
          position: { x: Number(block.positionX), y: Number(block.positionY) },
          data: block.data,
          enabled: block.enabled,
          subBlocks: block.subBlocks || {},
        }
      })

      // Process subflows (loops and parallels)
      subflows.forEach((subflow) => {
        const config = (subflow.config as any) || {}
        if (subflow.type === 'loop') {
          loops[subflow.id] = {
            nodes: config.nodes || [],
            iterationCount: config.iterationCount || 1,
            iterationType: config.iterationType || 'fixed',
            collection: config.collection || '',
          }
        } else if (subflow.type === 'parallel') {
          parallels[subflow.id] = {
            nodes: config.nodes || [],
            parallelCount: config.parallelCount || 2,
            collection: config.collection || '',
          }
        }
      })

      // Convert edges to the expected format
      const edgesArray = edges.map((edge) => ({
        id: edge.id,
        source: edge.sourceBlockId,
        target: edge.targetBlockId,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
        type: 'default',
        data: {},
      }))

      const currentState = {
        blocks: blocksMap,
        edges: edgesArray,
        loops,
        parallels,
        lastSaved: Date.now(),
      }

      needsRedeployment = hasWorkflowChanged(
        currentState as any,
        validation.workflow.deployedState as any
      )
    }

    return createSuccessResponse({
      isDeployed: validation.workflow.isDeployed,
      deployedAt: validation.workflow.deployedAt,
      isPublished: validation.workflow.isPublished,
      needsRedeployment,
    })
  } catch (error) {
    logger.error(`[${requestId}] Error getting status for workflow: ${(await params).id}`, error)
    return createErrorResponse('Failed to get status', 500)
  }
}
