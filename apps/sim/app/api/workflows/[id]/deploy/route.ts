import { eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { createLogger } from '@/lib/logs/console-logger'
import { generateApiKey } from '@/lib/utils'
import { db } from '@/db'
import { apiKey, workflow, workflowBlocks, workflowEdges, workflowSubflows } from '@/db/schema'
import { validateWorkflowAccess } from '../../middleware'
import { createErrorResponse, createSuccessResponse } from '../../utils'

const logger = createLogger('WorkflowDeployAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const { id } = await params

  try {
    logger.debug(`[${requestId}] Fetching deployment info for workflow: ${id}`)
    const validation = await validateWorkflowAccess(request, id, false)

    if (validation.error) {
      logger.warn(`[${requestId}] Failed to fetch deployment info: ${validation.error.message}`)
      return createErrorResponse(validation.error.message, validation.error.status)
    }

    // Fetch the workflow information including deployment details
    const result = await db
      .select({
        isDeployed: workflow.isDeployed,
        deployedAt: workflow.deployedAt,
        userId: workflow.userId,
        deployedState: workflow.deployedState,
      })
      .from(workflow)
      .where(eq(workflow.id, id))
      .limit(1)

    if (result.length === 0) {
      logger.warn(`[${requestId}] Workflow not found: ${id}`)
      return createErrorResponse('Workflow not found', 404)
    }

    const workflowData = result[0]

    // If the workflow is not deployed, return appropriate response
    if (!workflowData.isDeployed) {
      logger.info(`[${requestId}] Workflow is not deployed: ${id}`)
      return createSuccessResponse({
        isDeployed: false,
        deployedAt: null,
        apiKey: null,
        needsRedeployment: false,
      })
    }

    // Fetch the user's API key
    const userApiKey = await db
      .select({
        key: apiKey.key,
      })
      .from(apiKey)
      .where(eq(apiKey.userId, workflowData.userId))
      .limit(1)

    let userKey = null

    // If no API key exists, create one automatically
    if (userApiKey.length === 0) {
      try {
        const newApiKey = generateApiKey()
        await db.insert(apiKey).values({
          id: uuidv4(),
          userId: workflowData.userId,
          name: 'Default API Key',
          key: newApiKey,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        userKey = newApiKey
        logger.info(`[${requestId}] Generated new API key for user: ${workflowData.userId}`)
      } catch (keyError) {
        // If key generation fails, log the error but continue with the request
        logger.error(`[${requestId}] Failed to generate API key:`, keyError)
      }
    } else {
      userKey = userApiKey[0].key
    }

    // Check if the workflow has meaningful changes that would require redeployment
    let needsRedeployment = false
    if (workflowData.deployedState) {
      // Load current state from normalized tables for comparison
      const { loadWorkflowFromNormalizedTables } = await import('@/lib/workflows/db-helpers')
      const normalizedData = await loadWorkflowFromNormalizedTables(id)

      if (normalizedData) {
        // Convert normalized data to WorkflowState format for comparison
        const currentState = {
          blocks: normalizedData.blocks,
          edges: normalizedData.edges,
          loops: normalizedData.loops,
          parallels: normalizedData.parallels,
        }

        const { hasWorkflowChanged } = await import('@/lib/workflows/utils')
        needsRedeployment = hasWorkflowChanged(
          currentState as any,
          workflowData.deployedState as any
        )
      }
    }

    logger.info(`[${requestId}] Successfully retrieved deployment info: ${id}`)
    return createSuccessResponse({
      apiKey: userKey,
      isDeployed: workflowData.isDeployed,
      deployedAt: workflowData.deployedAt,
      needsRedeployment,
    })
  } catch (error: any) {
    logger.error(`[${requestId}] Error fetching deployment info: ${id}`, error)
    return createErrorResponse(error.message || 'Failed to fetch deployment information', 500)
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const { id } = await params

  try {
    logger.debug(`[${requestId}] Deploying workflow: ${id}`)
    const validation = await validateWorkflowAccess(request, id, false)

    if (validation.error) {
      logger.warn(`[${requestId}] Workflow deployment failed: ${validation.error.message}`)
      return createErrorResponse(validation.error.message, validation.error.status)
    }

    // Get the workflow to find the user (removed deprecated state column)
    const workflowData = await db
      .select({
        userId: workflow.userId,
      })
      .from(workflow)
      .where(eq(workflow.id, id))
      .limit(1)

    if (workflowData.length === 0) {
      logger.warn(`[${requestId}] Workflow not found: ${id}`)
      return createErrorResponse('Workflow not found', 404)
    }

    const userId = workflowData[0].userId

    // Get the current live state from normalized tables instead of stale JSON
    logger.debug(`[${requestId}] Getting current workflow state for deployment`)

    // Get blocks from normalized table
    const blocks = await db.select().from(workflowBlocks).where(eq(workflowBlocks.workflowId, id))

    // Get edges from normalized table
    const edges = await db.select().from(workflowEdges).where(eq(workflowEdges.workflowId, id))

    // Get subflows from normalized table
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

    logger.debug(`[${requestId}] Current state retrieved from normalized tables:`, {
      blocksCount: Object.keys(blocksMap).length,
      edgesCount: edgesArray.length,
      loopsCount: Object.keys(loops).length,
      parallelsCount: Object.keys(parallels).length,
    })

    if (!currentState || !currentState.blocks) {
      logger.error(`[${requestId}] Invalid workflow state retrieved`, { currentState })
      throw new Error('Invalid workflow state: missing blocks')
    }

    const deployedAt = new Date()
    logger.debug(`[${requestId}] Proceeding with deployment at ${deployedAt.toISOString()}`)

    // Check if the user already has an API key
    const userApiKey = await db
      .select({
        key: apiKey.key,
      })
      .from(apiKey)
      .where(eq(apiKey.userId, userId))
      .limit(1)

    let userKey = null

    // If no API key exists, create one
    if (userApiKey.length === 0) {
      try {
        const newApiKey = generateApiKey()
        await db.insert(apiKey).values({
          id: uuidv4(),
          userId,
          name: 'Default API Key',
          key: newApiKey,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        userKey = newApiKey
        logger.info(`[${requestId}] Generated new API key for user: ${userId}`)
      } catch (keyError) {
        // If key generation fails, log the error but continue with the request
        logger.error(`[${requestId}] Failed to generate API key:`, keyError)
      }
    } else {
      userKey = userApiKey[0].key
    }

    // Update the workflow deployment status and save current state as deployed state
    await db
      .update(workflow)
      .set({
        isDeployed: true,
        deployedAt,
        deployedState: currentState,
      })
      .where(eq(workflow.id, id))

    logger.info(`[${requestId}] Workflow deployed successfully: ${id}`)
    return createSuccessResponse({ apiKey: userKey, isDeployed: true, deployedAt })
  } catch (error: any) {
    logger.error(`[${requestId}] Error deploying workflow: ${id}`, {
      error: error.message,
      stack: error.stack,
      name: error.name,
      cause: error.cause,
      fullError: error,
    })
    return createErrorResponse(error.message || 'Failed to deploy workflow', 500)
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const { id } = await params

  try {
    logger.debug(`[${requestId}] Undeploying workflow: ${id}`)
    const validation = await validateWorkflowAccess(request, id, false)

    if (validation.error) {
      logger.warn(`[${requestId}] Workflow undeployment failed: ${validation.error.message}`)
      return createErrorResponse(validation.error.message, validation.error.status)
    }

    // Update the workflow to remove deployment status and deployed state
    await db
      .update(workflow)
      .set({
        isDeployed: false,
        deployedAt: null,
        deployedState: null,
      })
      .where(eq(workflow.id, id))

    logger.info(`[${requestId}] Workflow undeployed successfully: ${id}`)
    return createSuccessResponse({
      isDeployed: false,
      deployedAt: null,
      apiKey: null,
    })
  } catch (error: any) {
    logger.error(`[${requestId}] Error undeploying workflow: ${id}`, error)
    return createErrorResponse(error.message || 'Failed to undeploy workflow', 500)
  }
}
