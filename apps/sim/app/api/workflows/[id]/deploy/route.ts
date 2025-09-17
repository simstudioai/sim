import { apiKey, db, workflow, workflowDeploymentVersion } from '@sim/db'
import { and, desc, eq, sql } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { generateApiKey } from '@/lib/api-key/service'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/db-helpers'
import { validateWorkflowAccess } from '@/app/api/workflows/middleware'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('WorkflowDeployAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()
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
        pinnedApiKeyId: workflow.pinnedApiKeyId,
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

    let keyInfo: { name: string; type: 'personal' | 'workspace' } | null = null

    if (workflowData.pinnedApiKeyId) {
      const pinnedKey = await db
        .select({ key: apiKey.key, name: apiKey.name, type: apiKey.type })
        .from(apiKey)
        .where(eq(apiKey.id, workflowData.pinnedApiKeyId))
        .limit(1)

      if (pinnedKey.length > 0) {
        keyInfo = { name: pinnedKey[0].name, type: pinnedKey[0].type as 'personal' | 'workspace' }
      }
    } else {
      // Fetch the user's API key, preferring the most recently used
      const userApiKey = await db
        .select({
          key: apiKey.key,
          name: apiKey.name,
          type: apiKey.type,
        })
        .from(apiKey)
        .where(and(eq(apiKey.userId, workflowData.userId), eq(apiKey.type, 'personal')))
        .orderBy(desc(apiKey.lastUsed), desc(apiKey.createdAt))
        .limit(1)

      // If no API key exists, create one automatically
      if (userApiKey.length === 0) {
        try {
          const newApiKeyVal = generateApiKey()
          const keyName = 'Default API Key'
          await db.insert(apiKey).values({
            id: uuidv4(),
            userId: workflowData.userId,
            workspaceId: null,
            name: keyName,
            key: newApiKeyVal,
            type: 'personal',
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          keyInfo = { name: keyName, type: 'personal' }
          logger.info(`[${requestId}] Generated new API key for user: ${workflowData.userId}`)
        } catch (keyError) {
          logger.error(`[${requestId}] Failed to generate API key:`, keyError)
        }
      } else {
        keyInfo = { name: userApiKey[0].name, type: userApiKey[0].type as 'personal' | 'workspace' }
      }
    }

    // Check if the workflow has meaningful changes that would require redeployment
    let needsRedeployment = false
    const [active] = await db
      .select({ state: workflowDeploymentVersion.state })
      .from(workflowDeploymentVersion)
      .where(
        and(
          eq(workflowDeploymentVersion.workflowId, id),
          eq(workflowDeploymentVersion.isActive, true)
        )
      )
      .orderBy(desc(workflowDeploymentVersion.createdAt))
      .limit(1)

    if (active?.state) {
      const { loadWorkflowFromNormalizedTables } = await import('@/lib/workflows/db-helpers')
      const normalizedData = await loadWorkflowFromNormalizedTables(id)
      if (normalizedData) {
        const currentState = {
          blocks: normalizedData.blocks,
          edges: normalizedData.edges,
          loops: normalizedData.loops,
          parallels: normalizedData.parallels,
        }
        const { hasWorkflowChanged } = await import('@/lib/workflows/utils')
        needsRedeployment = hasWorkflowChanged(currentState as any, active.state as any)
      }
    }

    logger.info(`[${requestId}] Successfully retrieved deployment info: ${id}`)

    const responseApiKeyInfo = keyInfo ? `${keyInfo.name} (${keyInfo.type})` : 'No API key found'

    return createSuccessResponse({
      apiKey: responseApiKeyInfo,
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
  const requestId = generateRequestId()
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
        pinnedApiKeyId: workflow.pinnedApiKeyId,
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

    // Get the current live state from normalized tables using centralized helper
    logger.debug(`[${requestId}] Getting current workflow state for deployment`)

    const normalizedData = await loadWorkflowFromNormalizedTables(id)

    if (!normalizedData) {
      logger.error(`[${requestId}] Failed to load workflow from normalized tables`)
      return createErrorResponse('Failed to load workflow state', 500)
    }

    const currentState = {
      blocks: normalizedData.blocks,
      edges: normalizedData.edges,
      loops: normalizedData.loops,
      parallels: normalizedData.parallels,
      lastSaved: Date.now(),
    }

    logger.debug(`[${requestId}] Current state retrieved from normalized tables:`, {
      blocksCount: Object.keys(currentState.blocks).length,
      edgesCount: currentState.edges.length,
      loopsCount: Object.keys(currentState.loops).length,
      parallelsCount: Object.keys(currentState.parallels).length,
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
      .where(and(eq(apiKey.userId, userId), eq(apiKey.type, 'personal')))
      .orderBy(desc(apiKey.lastUsed), desc(apiKey.createdAt))
      .limit(1)

    // If no API key exists, create one
    if (userApiKey.length === 0) {
      try {
        const newApiKey = generateApiKey()
        await db.insert(apiKey).values({
          id: uuidv4(),
          userId,
          workspaceId: null, // Personal keys must have NULL workspaceId
          name: 'Default API Key',
          key: newApiKey,
          type: 'personal', // Explicitly set type
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        logger.info(`[${requestId}] Generated new API key for user: ${userId}`)
      } catch (keyError) {
        // If key generation fails, log the error but continue with the request
        logger.error(`[${requestId}] Failed to generate API key:`, keyError)
      }
    }

    let keyInfo: { name: string; type: 'personal' | 'workspace' } | null = null
    let matchedKey: {
      id: string
      key: string
      name: string
      type: 'personal' | 'workspace'
    } | null = null

    if (providedApiKey) {
      let isValidKey = false

      const [personalKey] = await db
        .select({ id: apiKey.id, key: apiKey.key, name: apiKey.name, expiresAt: apiKey.expiresAt })
        .from(apiKey)
        .where(
          and(eq(apiKey.id, providedApiKey), eq(apiKey.userId, userId), eq(apiKey.type, 'personal'))
        )
        .limit(1)

      if (personalKey) {
        if (!personalKey.expiresAt || personalKey.expiresAt >= new Date()) {
          matchedKey = { ...personalKey, type: 'personal' }
          isValidKey = true
          keyInfo = { name: personalKey.name, type: 'personal' }
        }
      }

      if (!isValidKey) {
        const [workflowData] = await db
          .select({ workspaceId: workflow.workspaceId })
          .from(workflow)
          .where(eq(workflow.id, id))
          .limit(1)

        if (workflowData?.workspaceId) {
          const [workspaceKey] = await db
            .select({
              id: apiKey.id,
              key: apiKey.key,
              name: apiKey.name,
              expiresAt: apiKey.expiresAt,
            })
            .from(apiKey)
            .where(
              and(
                eq(apiKey.id, providedApiKey),
                eq(apiKey.workspaceId, workflowData.workspaceId),
                eq(apiKey.type, 'workspace')
              )
            )
            .limit(1)

          if (workspaceKey) {
            if (!workspaceKey.expiresAt || workspaceKey.expiresAt >= new Date()) {
              matchedKey = { ...workspaceKey, type: 'workspace' }
              isValidKey = true
              keyInfo = { name: workspaceKey.name, type: 'workspace' }
            }
          }
        }
      }

      if (!isValidKey) {
        logger.warn(`[${requestId}] Invalid API key ID provided for workflow deployment: ${id}`)
        return createErrorResponse('Invalid API key provided', 400)
      }
    }

    // In a transaction: create deployment version, update workflow flags and deployed state
    await db.transaction(async (tx) => {
      const [{ maxVersion }] = await tx
        .select({ maxVersion: sql`COALESCE(MAX("version"), 0)` })
        .from(workflowDeploymentVersion)
        .where(eq(workflowDeploymentVersion.workflowId, id))

      const nextVersion = Number(maxVersion) + 1

      await tx
        .update(workflowDeploymentVersion)
        .set({ isActive: false })
        .where(
          and(
            eq(workflowDeploymentVersion.workflowId, id),
            eq(workflowDeploymentVersion.isActive, true)
          )
        )

      await tx.insert(workflowDeploymentVersion).values({
        id: uuidv4(),
        workflowId: id,
        version: nextVersion,
        state: currentState,
        isActive: true,
        createdAt: deployedAt,
        createdBy: userId,
      })

      const updateData: Record<string, unknown> = {
        isDeployed: true,
        deployedAt,
        deployedState: currentState,
      }
      if (providedApiKey && matchedKey) {
        updateData.pinnedApiKeyId = matchedKey.id
      }

      await tx.update(workflow).set(updateData).where(eq(workflow.id, id))
    })

    // Update lastUsed for the key we returned
    if (matchedKey) {
      try {
        await db
          .update(apiKey)
          .set({ lastUsed: new Date(), updatedAt: new Date() })
          .where(eq(apiKey.id, matchedKey.id))
      } catch (e) {
        logger.warn(`[${requestId}] Failed to update lastUsed for api key`)
      }
    }

    logger.info(`[${requestId}] Workflow deployed successfully: ${id}`)

    const responseApiKeyInfo = keyInfo ? `${keyInfo.name} (${keyInfo.type})` : 'Default key'

    return createSuccessResponse({
      apiKey: responseApiKeyInfo,
      isDeployed: true,
      deployedAt,
    })
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
  const requestId = generateRequestId()
  const { id } = await params

  try {
    logger.debug(`[${requestId}] Undeploying workflow: ${id}`)
    const validation = await validateWorkflowAccess(request, id, false)

    if (validation.error) {
      logger.warn(`[${requestId}] Workflow undeployment failed: ${validation.error.message}`)
      return createErrorResponse(validation.error.message, validation.error.status)
    }

    // Deactivate versions and clear deployment fields
    await db.transaction(async (tx) => {
      await tx
        .update(workflowDeploymentVersion)
        .set({ isActive: false })
        .where(eq(workflowDeploymentVersion.workflowId, id))

      await tx
        .update(workflow)
        .set({ isDeployed: false, deployedAt: null, deployedState: null, pinnedApiKeyId: null })
        .where(eq(workflow.id, id))
    })

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
