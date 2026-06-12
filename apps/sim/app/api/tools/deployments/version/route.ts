import { db } from '@sim/db'
import { workflowDeploymentVersion } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { deploymentsGetVersionContract } from '@/lib/api/contracts/tools/deployments'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  authenticateDeploymentToolRequest,
  authorizeDeploymentWorkflow,
  deploymentToolError,
} from '@/app/api/tools/deployments/utils'

const logger = createLogger('DeploymentsGetVersionAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const auth = await authenticateDeploymentToolRequest(request, requestId)
    if (!auth.ok) return auth.response

    const parsed = await parseRequest(
      deploymentsGetVersionContract,
      request,
      {},
      {
        validationErrorResponse: (error) =>
          deploymentToolError(getValidationErrorMessage(error, 'Invalid request data'), 400),
      }
    )
    if (!parsed.success) return parsed.response

    const { workflowId, version } = parsed.data.query

    const access = await authorizeDeploymentWorkflow(auth.userId, workflowId, 'read')
    if (!access.ok) return access.response

    const [row] = await db
      .select({
        id: workflowDeploymentVersion.id,
        version: workflowDeploymentVersion.version,
        name: workflowDeploymentVersion.name,
        description: workflowDeploymentVersion.description,
        isActive: workflowDeploymentVersion.isActive,
        createdAt: workflowDeploymentVersion.createdAt,
        state: workflowDeploymentVersion.state,
      })
      .from(workflowDeploymentVersion)
      .where(
        and(
          eq(workflowDeploymentVersion.workflowId, workflowId),
          eq(workflowDeploymentVersion.version, version)
        )
      )
      .limit(1)

    if (!row) {
      return deploymentToolError('Deployment version not found', 404)
    }

    return NextResponse.json({
      success: true,
      output: {
        workflowId,
        version: row.version,
        name: row.name,
        description: row.description,
        isActive: row.isActive,
        createdAt: row.createdAt,
        deployedState: row.state,
      },
    })
  } catch (error: unknown) {
    logger.error(`[${requestId}] Deployment tool get version error`, { error })
    return deploymentToolError('Failed to get deployment version', 500)
  }
})
