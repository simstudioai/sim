import { apiKey, db, workflow, workflowDeploymentVersion } from '@sim/db'
import { and, desc, eq, sql } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { generateApiKey } from '@/lib/api-key/service'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/db-helpers'
import { validateWorkflowPermissions } from '@/lib/workflows/utils'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('WorkflowDeployAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()
  const { id } = await params

  try {
    logger.debug(`[${requestId}] Fetching deployment info for workflow: ${id}`)

    const { error, workflow: workflowData } = await validateWorkflowPermissions(
      id,
      requestId,
      'read'
    )
    if (error) {
      return createErrorResponse(error.message, error.status)
    }

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

    const {
      error,
      session,
      workflow: workflowData,
    } = await validateWorkflowPermissions(id, requestId, 'admin')
    if (error) {
      return createErrorResponse(error.message, error.status)
    }

    const userId = workflowData!.userId

    let providedApiKey: string | null = null
    try {
      const parsed = await request.json()
      if (parsed && typeof parsed.apiKey === 'string' && parsed.apiKey.trim().length > 0) {
        providedApiKey = parsed.apiKey.trim()
      }
    } catch (_err) {}

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

    const userApiKey = await db
      .select({
        key: apiKey.key,
      })
      .from(apiKey)
      .where(and(eq(apiKey.userId, userId), eq(apiKey.type, 'personal')))
      .orderBy(desc(apiKey.lastUsed), desc(apiKey.createdAt))
      .limit(1)

    if (userApiKey.length === 0) {
      try {
        const newApiKey = generateApiKey()
        await db.insert(apiKey).values({
          id: uuidv4(),
          userId,
          workspaceId: null,
          name: 'Default API Key',
          key: newApiKey,
          type: 'personal',
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        logger.info(`[${requestId}] Generated new API key for user: ${userId}`)
      } catch (keyError) {
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

      const currentUserId = session?.user?.id

      if (currentUserId) {
        const [personalKey] = await db
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
              eq(apiKey.userId, currentUserId),
              eq(apiKey.type, 'personal')
            )
          )
          .limit(1)

        if (personalKey) {
          if (!personalKey.expiresAt || personalKey.expiresAt >= new Date()) {
            matchedKey = { ...personalKey, type: 'personal' }
            isValidKey = true
            keyInfo = { name: personalKey.name, type: 'personal' }
          }
        }
      }

      if (!isValidKey) {
        if (workflowData!.workspaceId) {
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
                eq(apiKey.workspaceId, workflowData!.workspaceId),
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

    // Attribution: this route is UI-only; require session user as actor
    const actorUserId: string | null = session?.user?.id ?? null
    if (!actorUserId) {
      logger.warn(`[${requestId}] Unable to resolve actor user for workflow deployment: ${id}`)
      return createErrorResponse('Unable to determine deploying user', 400)
    }

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
        createdBy: actorUserId,
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

    const { error } = await validateWorkflowPermissions(id, requestId, 'admin')
    if (error) {
      return createErrorResponse(error.message, error.status)
    }

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
