import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import {
  assertWorkflowMutable,
  getActiveWorkflowRecord,
  WorkflowLockedError,
} from '@sim/workflow-authz'
import { type NextRequest, NextResponse } from 'next/server'
import {
  v1DeployWorkflowBodySchema,
  v1DeployWorkflowContract,
  v1UndeployWorkflowContract,
} from '@/lib/api/contracts/v1/workflows'
import { parseRequest, validationErrorResponse } from '@/lib/api/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import { performFullDeploy, performFullUndeploy } from '@/lib/workflows/orchestration'
import { createApiResponse, getUserLimits } from '@/app/api/v1/logs/meta'
import {
  checkRateLimit,
  createRateLimitResponse,
  validateWorkspaceAccess,
} from '@/app/api/v1/middleware'

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

      // boundary-raw-json: the deploy body is optional version metadata; tolerate an absent or empty body
      const rawBody = await request.json().catch(() => ({}))
      const body = v1DeployWorkflowBodySchema.safeParse(rawBody ?? {})
      if (!body.success) {
        return validationErrorResponse(body.error)
      }

      const workflowData = await getActiveWorkflowRecord(id)
      if (!workflowData) {
        return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
      }

      const accessError = await validateWorkspaceAccess(
        rateLimit,
        userId,
        workflowData.workspaceId!,
        'admin'
      )
      if (accessError) return accessError

      await assertWorkflowMutable(id)

      logger.info(`[${requestId}] Deploying workflow ${id} via v1 API`, { userId })

      const result = await performFullDeploy({
        workflowId: id,
        userId,
        workflowName: workflowData.name || undefined,
        versionName: body.data.name,
        versionDescription: body.data.description,
        requestId,
        request,
      })

      if (!result.success) {
        const status =
          result.errorCode === 'validation' ? 400 : result.errorCode === 'not_found' ? 404 : 500
        return NextResponse.json({ error: result.error || 'Failed to deploy workflow' }, { status })
      }

      captureServerEvent(
        userId,
        'workflow_deployed',
        { workflow_id: id, workspace_id: workflowData.workspaceId ?? '' },
        {
          groups: workflowData.workspaceId ? { workspace: workflowData.workspaceId } : undefined,
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
            warnings: result.warnings,
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

      const workflowData = await getActiveWorkflowRecord(id)
      if (!workflowData) {
        return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
      }

      const accessError = await validateWorkspaceAccess(
        rateLimit,
        userId,
        workflowData.workspaceId!,
        'admin'
      )
      if (accessError) return accessError

      if (!workflowData.isDeployed) {
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
        { workflow_id: id, workspace_id: workflowData.workspaceId ?? '' },
        workflowData.workspaceId ? { groups: { workspace: workflowData.workspaceId } } : undefined
      )

      const limits = await getUserLimits(userId)
      const apiResponse = createApiResponse(
        {
          data: {
            id,
            isDeployed: false,
            deployedAt: null,
            warnings: result.warnings,
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
