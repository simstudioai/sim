import { db, workflow } from '@sim/db'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import { performFullDeploy, performFullUndeploy } from '@/lib/workflows/orchestration'
import { validateWorkflowPermissions } from '@/lib/workflows/utils'
import {
  checkNeedsRedeployment,
  createErrorResponse,
  createSuccessResponse,
} from '@/app/api/workflows/utils'
import {
  PublicApiNotAllowedError,
  validatePublicApiAllowed,
} from '@/ee/access-control/utils/permission-check'

const logger = createLogger('WorkflowDeployAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const GET = withRouteHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()
    const { id } = await params

    try {
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
          isPublicApi: workflowData.isPublicApi ?? false,
        })
      }

      const needsRedeployment = await checkNeedsRedeployment(id)

      logger.info(`[${requestId}] Successfully retrieved deployment info: ${id}`)

      const responseApiKeyInfo = workflowData.workspaceId
        ? 'Workspace API keys'
        : 'Personal API keys'

      return createSuccessResponse({
        apiKey: responseApiKeyInfo,
        isDeployed: workflowData.isDeployed,
        deployedAt: workflowData.deployedAt,
        needsRedeployment,
        isPublicApi: workflowData.isPublicApi ?? false,
      })
    } catch (error: any) {
      logger.error(`[${requestId}] Error fetching deployment info: ${id}`, error)
      return createErrorResponse(error.message || 'Failed to fetch deployment information', 500)
    }
  }
)

export const POST = withRouteHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()
    const { id } = await params

    try {
      const {
        error,
        session,
        workflow: workflowData,
      } = await validateWorkflowPermissions(id, requestId, 'admin')
      if (error) {
        return createErrorResponse(error.message, error.status)
      }

      const actorUserId: string | null = session?.user?.id ?? null
      if (!actorUserId) {
        logger.warn(`[${requestId}] Unable to resolve actor user for workflow deployment: ${id}`)
        return createErrorResponse('Unable to determine deploying user', 400)
      }

      const result = await performFullDeploy({
        workflowId: id,
        userId: actorUserId,
        workflowName: workflowData!.name || undefined,
        requestId,
        request,
      })

      if (!result.success) {
        const status =
          result.errorCode === 'validation' ? 400 : result.errorCode === 'not_found' ? 404 : 500
        return createErrorResponse(result.error || 'Failed to deploy workflow', status)
      }

      logger.info(`[${requestId}] Workflow deployed successfully: ${id}`)

      captureServerEvent(
        actorUserId,
        'workflow_deployed',
        { workflow_id: id, workspace_id: workflowData!.workspaceId ?? '' },
        {
          groups: workflowData!.workspaceId ? { workspace: workflowData!.workspaceId } : undefined,
          setOnce: { first_workflow_deployed_at: new Date().toISOString() },
        }
      )

      const responseApiKeyInfo = workflowData!.workspaceId
        ? 'Workspace API keys'
        : 'Personal API keys'

      return createSuccessResponse({
        apiKey: responseApiKeyInfo,
        isDeployed: true,
        deployedAt: result.deployedAt,
        warnings: result.warnings,
      })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to deploy workflow'
      logger.error(`[${requestId}] Error deploying workflow: ${id}`, { error })
      return createErrorResponse(message, 500)
    }
  }
)

export const PATCH = withRouteHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()
    const { id } = await params

    try {
      const {
        error,
        session,
        workflow: workflowData,
      } = await validateWorkflowPermissions(id, requestId, 'admin')
      if (error) {
        return createErrorResponse(error.message, error.status)
      }

      const body = await request.json()
      const { isPublicApi } = body

      if (typeof isPublicApi !== 'boolean') {
        return createErrorResponse('Invalid request body: isPublicApi must be a boolean', 400)
      }

      if (isPublicApi) {
        try {
          await validatePublicApiAllowed(session?.user?.id, workflowData?.workspaceId ?? undefined)
        } catch (err) {
          if (err instanceof PublicApiNotAllowedError) {
            return createErrorResponse('Public API access is disabled', 403)
          }
          throw err
        }
      }

      await db.update(workflow).set({ isPublicApi }).where(eq(workflow.id, id))

      logger.info(`[${requestId}] Updated isPublicApi for workflow ${id} to ${isPublicApi}`)

      const wsId = workflowData?.workspaceId
      captureServerEvent(
        session!.user.id,
        'workflow_public_api_toggled',
        { workflow_id: id, workspace_id: wsId ?? '', is_public: isPublicApi },
        wsId ? { groups: { workspace: wsId } } : undefined
      )

      return createSuccessResponse({ isPublicApi })
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Failed to update deployment settings'
      logger.error(`[${requestId}] Error updating deployment settings: ${id}`, { error })
      return createErrorResponse(message, 500)
    }
  }
)

export const DELETE = withRouteHandler(
  async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()
    const { id } = await params

    try {
      const {
        error,
        session,
        workflow: workflowData,
      } = await validateWorkflowPermissions(id, requestId, 'admin')
      if (error) {
        return createErrorResponse(error.message, error.status)
      }

      const result = await performFullUndeploy({
        workflowId: id,
        userId: session!.user.id,
        requestId,
      })

      if (!result.success) {
        return createErrorResponse(result.error || 'Failed to undeploy workflow', 500)
      }

      const wsId = workflowData?.workspaceId
      captureServerEvent(
        session!.user.id,
        'workflow_undeployed',
        { workflow_id: id, workspace_id: wsId ?? '' },
        wsId ? { groups: { workspace: wsId } } : undefined
      )

      return createSuccessResponse({
        isDeployed: false,
        deployedAt: null,
        apiKey: null,
      })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to undeploy workflow'
      logger.error(`[${requestId}] Error undeploying workflow: ${id}`, { error })
      return createErrorResponse(message, 500)
    }
  }
)
