import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { deploymentsListVersionsContract } from '@/lib/api/contracts/tools/deployments'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { listWorkflowVersions } from '@/lib/workflows/persistence/utils'
import {
  authenticateDeploymentToolRequest,
  authorizeDeploymentWorkflow,
  deploymentToolError,
} from '@/app/api/tools/deployments/utils'

const logger = createLogger('DeploymentsListVersionsAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const auth = await authenticateDeploymentToolRequest(request, requestId)
    if (!auth.ok) return auth.response

    const parsed = await parseRequest(
      deploymentsListVersionsContract,
      request,
      {},
      {
        validationErrorResponse: (error) =>
          deploymentToolError(getValidationErrorMessage(error, 'Invalid request data'), 400),
      }
    )
    if (!parsed.success) return parsed.response

    const { workflowId, workspaceId } = parsed.data.query

    const access = await authorizeDeploymentWorkflow(auth.userId, workflowId, workspaceId, 'read')
    if (!access.ok) return access.response

    const { versions } = await listWorkflowVersions(workflowId)

    return NextResponse.json({
      success: true,
      output: { workflowId, versions },
    })
  } catch (error: unknown) {
    logger.error(`[${requestId}] Deployment tool list versions error`, { error })
    return deploymentToolError('Failed to list deployment versions', 500)
  }
})
