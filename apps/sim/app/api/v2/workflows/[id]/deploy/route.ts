import { createLogger } from '@sim/logger'
import { assertWorkflowMutable, WorkflowLockedError } from '@sim/platform-authz/workflow'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { v1DeployWorkflowBodySchema } from '@/lib/api/contracts/v1/workflows'
import {
  v2DeployWorkflowContract,
  v2UndeployWorkflowContract,
} from '@/lib/api/contracts/v2/workflows'
import { parseOptionalJsonBody, parseRequest } from '@/lib/api/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import { performFullDeploy, performFullUndeploy } from '@/lib/workflows/orchestration'
import { checkRateLimit } from '@/app/api/v1/middleware'
import { resolveV1DeploymentWorkflow } from '@/app/api/v1/workflows/utils'
import { v2Data, v2Error, v2RateLimitError, v2ValidationError } from '@/app/api/v2/lib/response'

const logger = createLogger('V2WorkflowDeployAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()

    try {
      const rateLimit = await checkRateLimit(request, 'workflow-deploy')
      if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

      const userId = rateLimit.userId!
      const parsed = await parseRequest(v2DeployWorkflowContract, request, context, {
        validationErrorResponse: v2ValidationError,
      })
      if (!parsed.success) return parsed.response

      const { id } = parsed.data.params

      const rawBody = await parseOptionalJsonBody(request)
      if (!rawBody.success) {
        return rawBody.response.status === 413
          ? v2Error('PAYLOAD_TOO_LARGE', 'Request body is too large')
          : v2Error('BAD_REQUEST', 'Request body must be valid JSON')
      }
      const body = v1DeployWorkflowBodySchema.safeParse(rawBody.data ?? {})
      if (!body.success) return v2ValidationError(body.error)

      const target = await resolveV1DeploymentWorkflow(rateLimit, userId, id)
      if (!target.ok) return v2Error('NOT_FOUND', 'Workflow not found')
      const { workflow, workspaceId } = target

      await assertWorkflowMutable(id)

      logger.info(`[${requestId}] Deploying workflow ${id} via v2 API`, { userId })

      const result = await performFullDeploy({
        workflowId: id,
        userId,
        workflowName: workflow.name || undefined,
        versionName: body.data.name,
        versionDescription: body.data.description ?? undefined,
        requestId,
        request,
      })

      if (!result.success) {
        const code =
          result.errorCode === 'not_found'
            ? 'NOT_FOUND'
            : result.errorCode === 'validation'
              ? 'BAD_REQUEST'
              : 'INTERNAL_ERROR'
        return v2Error(code, result.error || 'Failed to deploy workflow')
      }

      captureServerEvent(
        userId,
        'workflow_deployed',
        { workflow_id: id, workspace_id: workspaceId },
        {
          groups: { workspace: workspaceId },
          setOnce: { first_workflow_deployed_at: new Date().toISOString() },
        }
      )

      return v2Data(
        {
          id,
          isDeployed: true,
          deployedAt: result.deployedAt?.toISOString() ?? null,
          version: result.version,
          warnings: result.warnings ?? [],
        },
        { rateLimit }
      )
    } catch (error) {
      if (error instanceof WorkflowLockedError) {
        return v2Error('LOCKED', error.message)
      }
      logger.error(`[${requestId}] Workflow deploy error`, {
        error: getErrorMessage(error, 'Unknown error'),
      })
      return v2Error('INTERNAL_ERROR', 'Internal server error')
    }
  }
)

export const DELETE = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()

    try {
      const rateLimit = await checkRateLimit(request, 'workflow-deploy')
      if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

      const userId = rateLimit.userId!
      const parsed = await parseRequest(v2UndeployWorkflowContract, request, context, {
        validationErrorResponse: v2ValidationError,
      })
      if (!parsed.success) return parsed.response

      const { id } = parsed.data.params

      const target = await resolveV1DeploymentWorkflow(rateLimit, userId, id)
      if (!target.ok) return v2Error('NOT_FOUND', 'Workflow not found')
      const { workflow, workspaceId } = target

      if (!workflow.isDeployed) {
        return v2Error('BAD_REQUEST', 'Workflow is not deployed')
      }

      await assertWorkflowMutable(id)

      logger.info(`[${requestId}] Undeploying workflow ${id} via v2 API`, { userId })

      const result = await performFullUndeploy({ workflowId: id, userId, requestId })
      if (!result.success) {
        return v2Error('INTERNAL_ERROR', result.error || 'Failed to undeploy workflow')
      }

      captureServerEvent(
        userId,
        'workflow_undeployed',
        { workflow_id: id, workspace_id: workspaceId },
        { groups: { workspace: workspaceId } }
      )

      return v2Data(
        {
          id,
          isDeployed: false,
          deployedAt: null,
          warnings: result.warnings ?? [],
        },
        { rateLimit }
      )
    } catch (error) {
      if (error instanceof WorkflowLockedError) {
        return v2Error('LOCKED', error.message)
      }
      logger.error(`[${requestId}] Workflow undeploy error`, {
        error: getErrorMessage(error, 'Unknown error'),
      })
      return v2Error('INTERNAL_ERROR', 'Internal server error')
    }
  }
)
