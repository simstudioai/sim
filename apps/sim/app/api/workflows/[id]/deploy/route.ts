import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { updatePublicApiContract } from '@/lib/api/contracts/deployments'
import { parseRequest } from '@/lib/api/server'
import { InternalUnauthenticatedError, internalSessionAuth } from '@/lib/api/server/routes'
import { asOrchestrationError, statusForOrchestrationError } from '@/lib/core/orchestration/types'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import {
  deployWorkflow,
  readWorkflowDeploymentStatus,
  undeployWorkflow,
} from '@/lib/workflows/application/deployments'
import { updateWorkflowPublicApi } from '@/lib/workflows/application/update-workflow-deployment-settings'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('WorkflowDeployAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

export const GET = withRouteHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()
    const { id } = await params

    try {
      const principal = await internalSessionAuth.authenticate()
      const result = await readWorkflowDeploymentStatus.execute({
        principal,
        input: { workflowId: id },
        request,
      })
      const workflowData = result.workflow

      /**
       * A workflow is deployed only when an active version snapshot exists —
       * the same definition POST and the v1 routes use. The legacy
       * `workflow.isDeployed` flag is deliberately not consulted: when it
       * disagrees with the version table the workflow cannot actually serve
       * traffic, so reporting it as live would be untruthful.
       */
      const isDeployed = result.isDeployed

      if (!isDeployed) {
        logger.info(`[${requestId}] Workflow is not deployed: ${id}`)
        return createSuccessResponse({
          isDeployed: false,
          deployedAt: null,
          apiKey: null,
          needsRedeployment: false,
          isPublicApi: workflowData.isPublicApi ?? false,
          activeDeployment: result.activeDeployment,
          latestDeploymentAttempt: result.latestDeploymentAttempt,
          warnings: result.warnings,
        })
      }

      logger.info(`[${requestId}] Successfully retrieved deployment info: ${id}`)

      const responseApiKeyInfo = workflowData.workspaceId
        ? 'Workspace API keys'
        : 'Personal API keys'

      return createSuccessResponse({
        apiKey: responseApiKeyInfo,
        isDeployed,
        deployedAt: result.activeDeployment?.deployedAt ?? workflowData.deployedAt,
        needsRedeployment: result.needsRedeployment,
        isPublicApi: workflowData.isPublicApi ?? false,
        activeDeployment: result.activeDeployment,
        latestDeploymentAttempt: result.latestDeploymentAttempt,
        warnings: result.warnings,
      })
    } catch (error: unknown) {
      if (error instanceof InternalUnauthenticatedError) {
        return createErrorResponse(error.message, 401)
      }
      const orchestrationError = asOrchestrationError(error)
      if (orchestrationError) {
        return createErrorResponse(
          orchestrationError.message,
          statusForOrchestrationError(orchestrationError.code)
        )
      }
      logger.error(`[${requestId}] Error fetching deployment info: ${id}`, {
        error: getErrorMessage(error, 'Unknown error'),
      })
      return createErrorResponse('Failed to fetch deployment information', 500)
    }
  }
)

export const POST = withRouteHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()
    const { id } = await params

    try {
      const principal = await internalSessionAuth.authenticate()
      const result = await deployWorkflow.execute({
        principal,
        input: { workflowId: id, requestId, analytics: 'human' },
        request,
      })

      const isDeployed = Boolean(result.activeDeployment)
      const attemptActivated = result.latestDeploymentAttempt?.status === 'active'
      logger.info(
        `[${requestId}] Workflow deployment ${attemptActivated ? 'activated' : 'accepted for preparation'}: ${id}`
      )

      return createSuccessResponse({
        apiKey: 'Workspace API keys',
        isDeployed,
        deployedAt: result.deployedAt,
        warnings: result.warnings,
        activeDeployment: result.activeDeployment,
        latestDeploymentAttempt: result.latestDeploymentAttempt,
      })
    } catch (error: unknown) {
      if (error instanceof InternalUnauthenticatedError) {
        return createErrorResponse(error.message, 401)
      }
      const orchestrationError = asOrchestrationError(error)
      if (orchestrationError) {
        return createErrorResponse(
          orchestrationError.message,
          statusForOrchestrationError(orchestrationError.code)
        )
      }
      logger.error(`[${requestId}] Error deploying workflow: ${id}`, {
        error: getErrorMessage(error, 'Unknown error'),
      })
      return createErrorResponse('Failed to deploy workflow', 500)
    }
  }
)

export const PATCH = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()

    try {
      const principal = await internalSessionAuth.authenticate()
      const parsed = await parseRequest(updatePublicApiContract, request, context, {
        validationErrorResponse: () =>
          createErrorResponse('Invalid request body: isPublicApi must be a boolean', 400),
      })
      if (!parsed.success) return parsed.response

      const { id } = parsed.data.params
      const { isPublicApi } = parsed.data.body

      const result = await updateWorkflowPublicApi.execute({
        principal,
        input: { workflowId: id, isPublicApi },
        request,
      })

      logger.info(`[${requestId}] Updated isPublicApi for workflow ${id} to ${isPublicApi}`)

      captureServerEvent(
        principal.userId,
        'workflow_public_api_toggled',
        { workflow_id: id, workspace_id: result.workspaceId, is_public: isPublicApi },
        { groups: { workspace: result.workspaceId } }
      )

      return createSuccessResponse({ isPublicApi })
    } catch (error: unknown) {
      if (error instanceof InternalUnauthenticatedError) {
        return createErrorResponse(error.message, 401)
      }
      const orchestrationError = asOrchestrationError(error)
      if (orchestrationError) {
        return createErrorResponse(
          orchestrationError.message,
          statusForOrchestrationError(orchestrationError.code)
        )
      }
      logger.error(`[${requestId}] Error updating deployment settings`, {
        error: getErrorMessage(error, 'Unknown error'),
      })
      return createErrorResponse('Failed to update deployment settings', 500)
    }
  }
)

export const DELETE = withRouteHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()
    const { id } = await params

    try {
      const principal = await internalSessionAuth.authenticate()
      const result = await undeployWorkflow.execute({
        principal,
        input: { workflowId: id, requestId },
        request,
      })
      captureServerEvent(
        principal.userId,
        'workflow_undeployed',
        { workflow_id: result.workflowId, workspace_id: result.workspaceId },
        { groups: { workspace: result.workspaceId } }
      )

      return createSuccessResponse({
        isDeployed: false,
        deployedAt: null,
        apiKey: null,
        warnings: result.warnings,
      })
    } catch (error: unknown) {
      if (error instanceof InternalUnauthenticatedError) {
        return createErrorResponse(error.message, 401)
      }
      const orchestrationError = asOrchestrationError(error)
      if (orchestrationError) {
        return createErrorResponse(
          orchestrationError.message,
          statusForOrchestrationError(orchestrationError.code)
        )
      }
      logger.error(`[${requestId}] Error undeploying workflow: ${id}`, {
        error: getErrorMessage(error, 'Unknown error'),
      })
      return createErrorResponse('Failed to undeploy workflow', 500)
    }
  }
)
