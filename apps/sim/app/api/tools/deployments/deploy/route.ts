import { createLogger } from '@sim/logger'
import { assertWorkflowMutable, WorkflowLockedError } from '@sim/platform-authz/workflow'
import { type NextRequest, NextResponse } from 'next/server'
import { deploymentsDeployContract } from '@/lib/api/contracts/tools/deployments'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { performFullDeploy } from '@/lib/workflows/orchestration'
import { statusForOrchestrationError } from '@/lib/workflows/orchestration/types'
import {
  authenticateDeploymentToolRequest,
  authorizeDeploymentWorkflow,
  deploymentToolError,
} from '@/app/api/tools/deployments/utils'

const logger = createLogger('DeploymentsDeployAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const auth = await authenticateDeploymentToolRequest(request, requestId)
    if (!auth.ok) return auth.response

    const parsed = await parseRequest(
      deploymentsDeployContract,
      request,
      {},
      {
        validationErrorResponse: (error) =>
          deploymentToolError(getValidationErrorMessage(error, 'Invalid request data'), 400),
      }
    )
    if (!parsed.success) return parsed.response

    const { workflowId, workspaceId, name, description } = parsed.data.body

    const access = await authorizeDeploymentWorkflow(auth.userId, workflowId, workspaceId, 'admin')
    if (!access.ok) return access.response

    await assertWorkflowMutable(workflowId)

    logger.info(`[${requestId}] Deploying workflow ${workflowId} via deployments tool`, {
      userId: auth.userId,
    })

    const result = await performFullDeploy({
      workflowId,
      userId: auth.userId,
      versionName: name,
      versionDescription: description ?? undefined,
      requestId,
    })

    if (!result.success) {
      return deploymentToolError(
        result.error || 'Failed to deploy workflow',
        statusForOrchestrationError(result.errorCode)
      )
    }

    return NextResponse.json({
      success: true,
      output: {
        workflowId,
        isDeployed: Boolean(result.activeDeployment),
        deployedAt: result.deployedAt?.toISOString() ?? null,
        version: result.version,
        activeDeployment: result.activeDeployment,
        latestDeploymentAttempt: result.latestDeploymentAttempt,
        warnings: result.warnings ?? [],
      },
    })
  } catch (error: unknown) {
    if (error instanceof WorkflowLockedError) {
      return deploymentToolError(error.message, error.status)
    }
    logger.error(`[${requestId}] Deployment tool deploy error`, { error })
    return deploymentToolError('Failed to deploy workflow', 500)
  }
})
