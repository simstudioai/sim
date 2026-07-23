import { createLogger } from '@sim/logger'
import { assertWorkflowMutable, WorkflowLockedError } from '@sim/platform-authz/workflow'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import {
  v1RollbackWorkflowBodySchema,
  v1RollbackWorkflowContract,
} from '@/lib/api/contracts/v1/workflows'
import { parseOptionalJsonBody, parseRequest, validationErrorResponse } from '@/lib/api/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { performActivateVersion } from '@/lib/workflows/orchestration'
import { statusForOrchestrationError } from '@/lib/workflows/orchestration/types'
import { findPreviousDeploymentVersion } from '@/lib/workflows/persistence/utils'
import { createApiResponse, getUserLimits } from '@/app/api/v1/logs/meta'
import { checkRateLimit, createRateLimitResponse } from '@/app/api/v1/middleware'
import { resolveV1DeploymentWorkflow } from '@/app/api/v1/workflows/utils'

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

      const target = await resolveV1DeploymentWorkflow(rateLimit, userId, id)
      if (!target.ok) return target.response
      const { workflow, workspaceId } = target

      if (!workflow.isDeployed) {
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
        requestId,
      })

      if (!result.success) {
        return NextResponse.json(
          { error: result.error || 'Failed to roll back workflow' },
          { status: statusForOrchestrationError(result.errorCode) }
        )
      }

      const limits = await getUserLimits(userId)
      const apiResponse = createApiResponse(
        {
          data: {
            id,
            isDeployed: Boolean(result.activeDeployment),
            deployedAt: result.deployedAt?.toISOString() ?? null,
            version: targetVersion,
            warnings: result.warnings ?? [],
            activeDeployment: result.activeDeployment ?? null,
            latestDeploymentAttempt: result.latestDeploymentAttempt ?? null,
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
