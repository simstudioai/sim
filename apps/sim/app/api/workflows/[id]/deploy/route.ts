import { and, desc, eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { createLogger } from '@/lib/logs/console/logger'
import { generateApiKey } from '@/lib/utils'
import { validateWorkflowAccess } from '@/app/api/workflows/middleware'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'
import { db } from '@/db'
import { apiKey, workflow, workflowBlocks, workflowEdges, workflowSubflows } from '@/db/schema'

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
        pinnedApiKey: workflow.pinnedApiKey,
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

    let userKey: string | null = null

    if (workflowData.pinnedApiKey) {
      userKey = workflowData.pinnedApiKey
    } else {
      // Fetch the user's API key, preferring the most recently used
      const userApiKey = await db
        .select({
          key: apiKey.key,
        })
        .from(apiKey)
        .where(eq(apiKey.userId, workflowData.userId))
        .orderBy(desc(apiKey.lastUsed), desc(apiKey.createdAt))
        .limit(1)

      // If no API key exists, create one automatically
      if (userApiKey.length === 0) {
        try {
          const newApiKeyVal = generateApiKey()
          await db.insert(apiKey).values({
            id: uuidv4(),
            userId: workflowData.userId,
            name: 'Default API Key',
            key: newApiKeyVal,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          userKey = newApiKeyVal
          logger.info(`[${requestId}] Generated new API key for user: ${workflowData.userId}`)
        } catch (keyError) {
          // If key generation fails, log the error but continue with the request
          logger.error(`[${requestId}] Failed to generate API key:`, keyError)
        }
      } else {
        userKey = userApiKey[0].key
      }
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

    // Get the workflow to find the user and existing pin (removed deprecated state column)
    const workflowData = await db
      .select({
        userId: workflow.userId,
        pinnedApiKey: workflow.pinnedApiKey,
      })
      .from(workflow)
      .where(eq(workflow.id, id))
      .limit(1)

    if (workflowData.length === 0) {
      logger.warn(`[${requestId}] Workflow not found: ${id}`)
      return createErrorResponse('Workflow not found', 404)
    }

    const userId = workflowData[0].userId

    // Parse request body to capture selected API key (if provided)
    let providedApiKey: string | null = null
    try {
      const parsed = await request.json()
      if (parsed && typeof parsed.apiKey === 'string' && parsed.apiKey.trim().length > 0) {
        providedApiKey = parsed.apiKey.trim()
      }
    } catch (_err) {
      // Body may be empty; ignore
    }

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
      const parentId = block.parentId || null
      const extent = block.extent || null
      const blockData = {
        ...(block.data || {}),
        ...(parentId && { parentId }),
        ...(extent && { extent }),
      }

      blocksMap[block.id] = {
        id: block.id,
        type: block.type,
        name: block.name,
        position: { x: Number(block.positionX), y: Number(block.positionY) },
        data: blockData,
        enabled: block.enabled,
        subBlocks: block.subBlocks || {},
        // Preserve execution-relevant flags so serializer behavior matches manual runs
        isWide: block.isWide ?? false,
        advancedMode: block.advancedMode ?? false,
        triggerMode: block.triggerMode ?? false,
        outputs: block.outputs || {},
        horizontalHandles: block.horizontalHandles ?? true,
        height: Number(block.height || 0),
        parentId,
        extent,
      }
    })

    // Process subflows (loops and parallels)
    subflows.forEach((subflow) => {
      const config = (subflow.config as any) || {}
      if (subflow.type === 'loop') {
        loops[subflow.id] = {
          id: subflow.id,
          nodes: config.nodes || [],
          iterations: config.iterations || 1,
          loopType: config.loopType || 'for',
          forEachItems: config.forEachItems || '',
        }
      } else if (subflow.type === 'parallel') {
        parallels[subflow.id] = {
          id: subflow.id,
          nodes: config.nodes || [],
          count: config.count || 2,
          distribution: config.distribution || '',
          parallelType: config.parallelType || 'count',
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

    // Check if the user already has API keys
    const userApiKey = await db
      .select({
        key: apiKey.key,
      })
      .from(apiKey)
      .where(eq(apiKey.userId, userId))
      .orderBy(desc(apiKey.lastUsed), desc(apiKey.createdAt))
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

    // If client provided a specific API key and it belongs to the user, prefer it
    if (providedApiKey) {
      const [owned] = await db
        .select({ key: apiKey.key })
        .from(apiKey)
        .where(and(eq(apiKey.userId, userId), eq(apiKey.key, providedApiKey)))
        .limit(1)
      if (owned) {
        userKey = providedApiKey
      }
    }

    // Update the workflow deployment status and save current state as deployed state
    const updateData: any = {
      isDeployed: true,
      deployedAt,
      deployedState: currentState,
    }
    // Only pin when the client explicitly provided a key in this request
    if (providedApiKey) {
      updateData.pinnedApiKey = userKey
    }

    await db.update(workflow).set(updateData).where(eq(workflow.id, id))

    // Update lastUsed for the key we returned
    if (userKey) {
      try {
        await db
          .update(apiKey)
          .set({ lastUsed: new Date(), updatedAt: new Date() })
          .where(eq(apiKey.key, userKey))
      } catch (e) {
        logger.warn(`[${requestId}] Failed to update lastUsed for api key`)
      }
    }

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
