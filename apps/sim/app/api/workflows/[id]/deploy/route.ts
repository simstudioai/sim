import { eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { createLogger } from '@/lib/logs/console-logger'
import { generateApiKey } from '@/lib/utils'
import { tagWorkflowAsDeployed } from '@/lib/workflows/db-helpers'
import { db } from '@/db'
import { apiKey, workflow } from '@/db/schema'
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
        state: workflow.state,
        deployedState: workflow.deployedState,
        deployedHash: workflow.deployedHash,
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
    if (workflowData.deployedHash) {
      // Note: We'll need to implement hash-based change detection later
      // For now, assume no redeployment needed if we have a hash
      needsRedeployment = false
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

    // Get the workflow to find the user and current state for legacy support
    const workflowData = await db
      .select({
        userId: workflow.userId,
        state: workflow.state, // Get current state for legacy deployedState field
      })
      .from(workflow)
      .where(eq(workflow.id, id))
      .limit(1)

    if (workflowData.length === 0) {
      logger.warn(`[${requestId}] Workflow not found: ${id}`)
      return createErrorResponse('Workflow not found', 404)
    }

    const userId = workflowData[0].userId
    const currentState = workflowData[0].state as any // Cast JSON field to any for flexibility
    const deployedAt = new Date()

    // CRITICAL: Force sync current workflow state to normalized tables BEFORE deployment
    // This ensures tagWorkflowAsDeployed finds current data to tag with deployment hash
    logger.info(`[${requestId}] Syncing workflow state to normalized tables before deployment...`)

    try {
      const { saveWorkflowToNormalizedTables } = await import('@/lib/workflows/db-helpers')
      const syncResult = await saveWorkflowToNormalizedTables(id, {
        blocks: currentState.blocks || {},
        edges: currentState.edges || [],
        loops: currentState.loops || {},
        parallels: currentState.parallels || {},
        lastSaved: currentState.lastSaved,
        deploymentStatuses: currentState.deploymentStatuses || {},
        hasActiveSchedule: currentState.hasActiveSchedule,
        hasActiveWebhook: currentState.hasActiveWebhook,
      })

      if (!syncResult.success) {
        logger.error(`[${requestId}] Failed to sync to normalized tables: ${syncResult.error}`)
        return createErrorResponse(
          `Failed to sync workflow data before deployment: ${syncResult.error}`,
          500
        )
      }

      logger.info(`[${requestId}] Successfully synced workflow state to normalized tables`)
    } catch (syncError) {
      logger.error(`[${requestId}] Error during pre-deployment sync:`, syncError)
      return createErrorResponse(
        `Failed to sync workflow data before deployment: ${syncError instanceof Error ? syncError.message : 'Unknown error'}`,
        500
      )
    }

    // Tag current workflow state with deployment hash
    const tagResult = await tagWorkflowAsDeployed(id)
    if (!tagResult.success) {
      logger.error(`[${requestId}] Failed to tag workflow as deployed: ${tagResult.error}`)
      return createErrorResponse('Failed to prepare workflow for deployment', 500)
    }

    const deployHash = tagResult.deployHash!

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

    // Update the workflow deployment status and save both hash and legacy state
    await db
      .update(workflow)
      .set({
        isDeployed: true,
        deployedAt,
        deployedHash: deployHash, // New hash-based system
        deployedState: currentState, // Legacy field for backward compatibility
      })
      .where(eq(workflow.id, id))

    logger.info(
      `[${requestId}] Workflow deployed successfully: ${id} with hash ${deployHash} (also stored legacy state)`
    )
    return createSuccessResponse({ apiKey: userKey, isDeployed: true, deployedAt })
  } catch (error: any) {
    logger.error(`[${requestId}] Error deploying workflow: ${id}`, error)
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

    // Update the workflow to remove deployment status and clear both deployed state fields
    await db
      .update(workflow)
      .set({
        isDeployed: false,
        deployedAt: null,
        deployedHash: null, // Clear new hash-based system
        deployedState: null, // Clear legacy field
      })
      .where(eq(workflow.id, id))

    logger.info(
      `[${requestId}] Workflow undeployed successfully: ${id} (cleared both hash and legacy state)`
    )
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
