import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import {
  assertWorkflowMutable,
  getActiveWorkflowRecord,
  WorkflowLockedError,
} from '@sim/workflow-authz'
import { type NextRequest, NextResponse } from 'next/server'
import {
  v1RollbackWorkflowBodySchema,
  v1RollbackWorkflowContract,
} from '@/lib/api/contracts/v1/workflows'
import { parseOptionalJsonBody, parseRequest, validationErrorResponse } from '@/lib/api/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import { performActivateVersion } from '@/lib/workflows/orchestration'
import { findPreviousDeploymentVersion } from '@/lib/workflows/persistence/utils'
import { createApiResponse, getUserLimits } from '@/app/api/v1/logs/meta'
import {
  checkRateLimit,
  createRateLimitResponse,
  validateWorkspaceAccess,
} from '@/app/api/v1/middleware'

const logger = createLogger('V1WorkflowRollbackAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()

    try {
      const rateLimit = await checkRateLimit(request, 'workflow-rollback')
      if (!rateLimit.allowed) {
        return createRateLimitResponse(rateLimit)
      }

      const userId = rateLimit.userId!
      const parsed = await parseRequest(v1RollbackWorkflowContract, request, context, {
        validationErrorResponse: () =>
          NextResponse.json({ error: 'Invalid workflow ID' }, { status: 400 }),
      })
      if (!parsed.success) return parsed.response

      const { id } = parsed.data.params

      const rawBody = await parseOptionalJsonBody(request)
      if (!rawBody.success) return rawBody.response
      const body = v1RollbackWorkflowBodySchema.safeParse(rawBody.data ?? {})
      if (!body.success) {
        return validationErrorResponse(body.error)
      }

      const workflowData = await getActiveWorkflowRecord(id)
      if (!workflowData?.workspaceId) {
        return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
      }
      const workspaceId = workflowData.workspaceId

      const accessError = await validateWorkspaceAccess(rateLimit, userId, workspaceId, 'admin')
      if (accessError) {
        return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
      }

      if (!workflowData.isDeployed) {
        return NextResponse.json({ error: 'Workflow is not deployed' }, { status: 400 })
      }

      await assertWorkflowMutable(id)

      let targetVersion = body.data.version
      if (targetVersion === undefined) {
        const previous = await findPreviousDeploymentVersion(id)
        if (!previous.ok) {
          const message =
            previous.reason === 'no_active_version'
              ? 'Workflow has no active deployment to roll back from'
              : 'No previous deployment version to roll back to'
          return NextResponse.json({ error: message }, { status: 400 })
        }
        targetVersion = previous.version
      }

      logger.info(
        `[${requestId}] Rolling back workflow ${id} to version ${targetVersion} via v1 API`,
        { userId }
      )

      const result = await performActivateVersion({
        workflowId: id,
        version: targetVersion,
        userId,
        workflow: workflowData as Record<string, unknown>,
        requestId,
        request,
      })

      if (!result.success) {
        const status =
          result.errorCode === 'not_found' ? 404 : result.errorCode === 'validation' ? 400 : 500
        return NextResponse.json(
          { error: result.error || 'Failed to roll back workflow' },
          { status }
        )
      }

      captureServerEvent(
        userId,
        'deployment_version_activated',
        { workflow_id: id, workspace_id: workspaceId, version: targetVersion },
        { groups: { workspace: workspaceId } }
      )

      const limits = await getUserLimits(userId)
      const apiResponse = createApiResponse(
        {
          data: {
            id,
            isDeployed: true,
            deployedAt: result.deployedAt?.toISOString() ?? null,
            version: targetVersion,
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
      logger.error(`[${requestId}] Workflow rollback error`, { error: message })
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)
