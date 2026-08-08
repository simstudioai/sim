import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db, workflow } from '@sim/db'
import { createLogger } from '@sim/logger'
import { assertWorkflowMutable, WorkflowLockedError } from '@sim/platform-authz/workflow'
import { getErrorMessage } from '@sim/utils/errors'
import { eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { updatePublicApiContract } from '@/lib/api/contracts/deployments'
import { parseRequest } from '@/lib/api/server'
import { InternalUnauthenticatedError, internalSessionAuth } from '@/lib/api/server/routes'
import { asOrchestrationError, statusForOrchestrationError } from '@/lib/core/orchestration/types'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import { deployWorkflow, undeployWorkflow } from '@/lib/workflows/application/deployments'
import { getWorkflowDeploymentSummary } from '@/lib/workflows/orchestration'
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
export const maxDuration = 120

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

      /**
       * A workflow is deployed only when an active version snapshot exists —
       * the same definition POST and the v1 routes use. The legacy
       * `workflow.isDeployed` flag is deliberately not consulted: when it
       * disagrees with the version table the workflow cannot actually serve
       * traffic, so reporting it as live would be untruthful.
       */
      const deploymentSummary = await getWorkflowDeploymentSummary(id)
      const isDeployed = deploymentSummary.activeDeployment !== null

      if (!isDeployed) {
        logger.info(`[${requestId}] Workflow is not deployed: ${id}`)
        return createSuccessResponse({
          isDeployed: false,
          deployedAt: null,
          apiKey: null,
          needsRedeployment: false,
          isPublicApi: workflowData.isPublicApi ?? false,
          activeDeployment: deploymentSummary.activeDeployment,
          latestDeploymentAttempt: deploymentSummary.latestDeploymentAttempt,
          warnings: deploymentSummary.warnings,
        })
      }

      const attemptStatus = deploymentSummary.latestDeploymentAttempt?.status
      const needsRedeployment =
        attemptStatus === 'preparing' || attemptStatus === 'activating'
          ? false
          : await checkNeedsRedeployment(id)

      logger.info(`[${requestId}] Successfully retrieved deployment info: ${id}`)

      const responseApiKeyInfo = workflowData.workspaceId
        ? 'Workspace API keys'
        : 'Personal API keys'

      return createSuccessResponse({
        apiKey: responseApiKeyInfo,
        isDeployed,
        deployedAt: deploymentSummary.activeDeployment?.deployedAt ?? workflowData.deployedAt,
        needsRedeployment,
        isPublicApi: workflowData.isPublicApi ?? false,
        activeDeployment: deploymentSummary.activeDeployment,
        latestDeploymentAttempt: deploymentSummary.latestDeploymentAttempt,
        warnings: deploymentSummary.warnings,
      })
    } catch (error: unknown) {
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
      const parsed = await parseRequest(updatePublicApiContract, request, context, {
        validationErrorResponse: () =>
          createErrorResponse('Invalid request body: isPublicApi must be a boolean', 400),
      })
      if (!parsed.success) return parsed.response

      const { id } = parsed.data.params
      const { isPublicApi } = parsed.data.body

      const {
        error,
        session,
        workflow: workflowData,
      } = await validateWorkflowPermissions(id, requestId, 'admin')
      if (error) {
        return createErrorResponse(error.message, error.status)
      }
      await assertWorkflowMutable(id)

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

      recordAudit({
        workspaceId: wsId ?? null,
        actorId: session!.user.id,
        action: AuditAction.WORKFLOW_PUBLIC_API_TOGGLED,
        resourceType: AuditResourceType.WORKFLOW,
        resourceId: id,
        resourceName: workflowData?.name ?? undefined,
        description: `${isPublicApi ? 'Enabled' : 'Disabled'} public API for workflow "${workflowData?.name ?? id}"`,
        metadata: { isPublicApi },
        request,
      })

      captureServerEvent(
        session!.user.id,
        'workflow_public_api_toggled',
        { workflow_id: id, workspace_id: wsId ?? '', is_public: isPublicApi },
        wsId ? { groups: { workspace: wsId } } : undefined
      )

      return createSuccessResponse({ isPublicApi })
    } catch (error: unknown) {
      if (error instanceof WorkflowLockedError) {
        return createErrorResponse(error.message, error.status)
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
