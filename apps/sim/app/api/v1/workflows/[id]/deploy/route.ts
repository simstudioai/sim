import { createLogger } from '@sim/logger'
import { assertWorkflowMutable, WorkflowLockedError } from '@sim/platform-authz/workflow'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import {
  v1DeployWorkflowBodySchema,
  v1DeployWorkflowContract,
  v1UndeployWorkflowContract,
} from '@/lib/api/contracts/v1/workflows'
import { parseOptionalJsonBody, parseRequest, validationErrorResponse } from '@/lib/api/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import { performFullDeploy, performFullUndeploy } from '@/lib/workflows/orchestration'
import { statusForOrchestrationError } from '@/lib/workflows/orchestration/types'
import { createApiResponse, getUserLimits } from '@/app/api/v1/logs/meta'
import { checkRateLimit, createRateLimitResponse } from '@/app/api/v1/middleware'
import { resolveV1DeploymentWorkflow } from '@/app/api/v1/workflows/utils'

const logger = createLogger('V1WorkflowDeployAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()

    try {
      const rateLimit = await checkRateLimit(request, 'workflow-deploy')
      if (!rateLimit.allowed) {
        return createRateLimitResponse(rateLimit)
      }

      const userId = rateLimit.userId!
      const parsed = await parseRequest(v1DeployWorkflowContract, request, context, {
        validationErrorResponse: () =>
          NextResponse.json({ error: 'Invalid workflow ID' }, { status: 400 }),
      })
      if (!parsed.success) return parsed.response

      const { id } = parsed.data.params

      const rawBody = await parseOptionalJsonBody(request)
      if (!rawBody.success) return rawBody.response
      const body = v1DeployWorkflowBodySchema.safeParse(rawBody.data ?? {})
      if (!body.success) {
        return validationErrorResponse(body.error)
      }

      const target = await resolveV1DeploymentWorkflow(rateLimit, userId, id)
      if (!target.ok) return target.response
      const { workflow, workspaceId } = target

      await assertWorkflowMutable(id)

      logger.info(`[${requestId}] Deploying workflow ${id} via v1 API`, { userId })

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
        return NextResponse.json(
          { error: result.error || 'Failed to deploy workflow' },
          { status: statusForOrchestrationError(result.errorCode) }
        )
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

      const limits = await getUserLimits(userId)
      const apiResponse = createApiResponse(
        {
          data: {
            id,
            isDeployed: true,
            deployedAt: result.deployedAt?.toISOString() ?? null,
            version: result.version,
            warnings: result.warnings ?? [],
          },
        },
        limits,
        rateLimit
      )

      return NextResponse.json(apiResponse.body, { headers: apiResponse.headers })
    } catch (error: unknown) {
      if (error instanceof WorkflowLockedError) {
        return NextResponse.json({ error: error.message }, { status: error.status })
      }
      const message = getErrorMessage(error, 'Unknown error')
      logger.error(`[${requestId}] Workflow deploy error`, { error: message })
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)

export const DELETE = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()

    try {
      const rateLimit = await checkRateLimit(request, 'workflow-deploy')
      if (!rateLimit.allowed) {
        return createRateLimitResponse(rateLimit)
      }

      const userId = rateLimit.userId!
      const parsed = await parseRequest(v1UndeployWorkflowContract, request, context, {
        validationErrorResponse: () =>
          NextResponse.json({ error: 'Invalid workflow ID' }, { status: 400 }),
      })
      if (!parsed.success) return parsed.response

      const { id } = parsed.data.params

      const target = await resolveV1DeploymentWorkflow(rateLimit, userId, id)
      if (!target.ok) return target.response
      const { workflow, workspaceId } = target

      if (!workflow.isDeployed) {
        return NextResponse.json({ error: 'Workflow is not deployed' }, { status: 400 })
      }

      await assertWorkflowMutable(id)

      logger.info(`[${requestId}] Undeploying workflow ${id} via v1 API`, { userId })

      const result = await performFullUndeploy({ workflowId: id, userId, requestId })
      if (!result.success) {
        return NextResponse.json(
          { error: result.error || 'Failed to undeploy workflow' },
          { status: 500 }
        )
      }

      captureServerEvent(
        userId,
        'workflow_undeployed',
        { workflow_id: id, workspace_id: workspaceId },
        { groups: { workspace: workspaceId } }
      )

      const limits = await getUserLimits(userId)
      const apiResponse = createApiResponse(
        {
          data: {
            id,
            isDeployed: false,
            deployedAt: null,
            warnings: result.warnings ?? [],
          },
        },
        limits,
        rateLimit
      )

      return NextResponse.json(apiResponse.body, { headers: apiResponse.headers })
    } catch (error: unknown) {
      if (error instanceof WorkflowLockedError) {
        return NextResponse.json({ error: error.message }, { status: error.status })
      }
      const message = getErrorMessage(error, 'Unknown error')
      logger.error(`[${requestId}] Workflow undeploy error`, { error: message })
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)
