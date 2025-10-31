import { db, workflow, workflowDeploymentVersion } from '@sim/db'
import { and, desc, eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import { deployWorkflow } from '@/lib/workflows/db-helpers'
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

    const responseApiKeyInfo = workflowData.workspaceId ? 'Workspace API keys' : 'Personal API keys'

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

    // Attribution: this route is UI-only; require session user as actor
    const actorUserId: string | null = session?.user?.id ?? null
    if (!actorUserId) {
      logger.warn(`[${requestId}] Unable to resolve actor user for workflow deployment: ${id}`)
      return createErrorResponse('Unable to determine deploying user', 400)
    }

    const deployResult = await deployWorkflow({
      workflowId: id,
      deployedBy: actorUserId,
      workflowName: workflowData!.name,
    })

    if (!deployResult.success) {
      return createErrorResponse(deployResult.error || 'Failed to deploy workflow', 500)
    }

    const deployedAt = deployResult.deployedAt!

    logger.info(`[${requestId}] Workflow deployed successfully: ${id}`)

    const responseApiKeyInfo = workflowData!.workspaceId
      ? 'Workspace API keys'
      : 'Personal API keys'

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
        .set({ isDeployed: false, deployedAt: null })
        .where(eq(workflow.id, id))
    })

    logger.info(`[${requestId}] Workflow undeployed successfully: ${id}`)

    // Track workflow undeployment
    try {
      const { trackPlatformEvent } = await import('@/lib/telemetry/tracer')
      trackPlatformEvent('platform.workflow.undeployed', {
        'workflow.id': id,
      })
    } catch (_e) {
      // Silently fail
    }

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
