import { createLogger } from '@sim/logger'
import { assertWorkflowMutable, WorkflowLockedError } from '@sim/platform-authz/workflow'
import { type NextRequest, NextResponse } from 'next/server'
import { deploymentsUndeployContract } from '@/lib/api/contracts/tools/deployments'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { performFullUndeploy } from '@/lib/workflows/orchestration'
import {
  authenticateDeploymentToolRequest,
  authorizeDeploymentWorkflow,
  deploymentToolError,
} from '@/app/api/tools/deployments/utils'

const logger = createLogger('DeploymentsUndeployAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const auth = await authenticateDeploymentToolRequest(request, requestId)
    if (!auth.ok) return auth.response

    const parsed = await parseRequest(
      deploymentsUndeployContract,
      request,
      {},
      {
        validationErrorResponse: (error) =>
          deploymentToolError(getValidationErrorMessage(error, 'Invalid request data'), 400),
      }
    )
    if (!parsed.success) return parsed.response

    const { workflowId, workspaceId, acknowledgePinnedApps } = parsed.data.body

    const access = await authorizeDeploymentWorkflow(auth.userId, workflowId, workspaceId, 'admin')
    if (!access.ok) return access.response

    if (!access.workflow.isDeployed) {
      return deploymentToolError('Workflow is not deployed', 400)
    }

    await assertWorkflowMutable(workflowId)

    logger.info(`[${requestId}] Undeploying workflow ${workflowId} via deployments tool`, {
      userId: auth.userId,
    })

    const result = await performFullUndeploy({
      workflowId,
      userId: auth.userId,
      requestId,
      acknowledgePinnedApps,
    })

    if (!result.success) {
      if (result.code === 'PINNED_APP_RELEASES_EXIST') {
        return NextResponse.json(
          {
            success: false,
            error: result.error,
            code: result.code,
            apps: result.apps,
          },
          { status: 409 }
        )
      }
      return deploymentToolError(result.error || 'Failed to undeploy workflow', 500)
    }

    return NextResponse.json({
      success: true,
      output: {
        workflowId,
        isDeployed: false,
        deployedAt: null,
        warnings: result.warnings ?? [],
      },
    })
  } catch (error: unknown) {
    if (error instanceof WorkflowLockedError) {
      return deploymentToolError(error.message, error.status)
    }
    logger.error(`[${requestId}] Deployment tool undeploy error`, { error })
    return deploymentToolError('Failed to undeploy workflow', 500)
  }
})
