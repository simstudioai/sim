import { createLogger } from '@sim/logger'
import { getActiveWorkflowRecord } from '@sim/platform-authz/workflow'
import {
  type AdminV1DeployResult,
  type AdminV1UndeployResult,
  adminV1DeployWorkflowContract,
  adminV1UndeployWorkflowContract,
} from '@/lib/api/contracts/v1/admin'
import { parseRequest } from '@/lib/api/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { performFullDeploy, performFullUndeploy } from '@/lib/workflows/orchestration'
import { withAdminAuthParams } from '@/app/api/v1/admin/middleware'
import {
  badRequestResponse,
  internalErrorResponse,
  notFoundResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'

const logger = createLogger('AdminWorkflowDeployAPI')
export const maxDuration = 120

interface RouteParams {
  id: string
}

/**
 * POST — Deploy a workflow via admin API.
 *
 * `userId` is set to the workflow owner so that webhook credential resolution
 * (OAuth token lookups for providers like Airtable, Attio, etc.) uses a real
 * user. `actorId` is set to `'admin-api'` so that the `deployedBy` field on
 * the deployment version and audit log entries are correctly attributed to an
 * admin action rather than the workflow owner.
 */
export const POST = withRouteHandler(
  withAdminAuthParams<RouteParams>(async (request, context) => {
    const parsed = await parseRequest(adminV1DeployWorkflowContract, request, context)
    if (!parsed.success) return parsed.response

    const { id: workflowId } = parsed.data.params
    const requestId = generateRequestId()

    try {
      const workflowRecord = await getActiveWorkflowRecord(workflowId)

      if (!workflowRecord) {
        return notFoundResponse('Workflow')
      }

      const result = await performFullDeploy({
        workflowId,
        userId: workflowRecord.userId,
        requestId,
        actorId: 'admin-api',
      })

      if (!result.success) {
        if (result.errorCode === 'not_found') return notFoundResponse('Workflow state')
        if (result.errorCode === 'validation') return badRequestResponse(result.error!)
        return internalErrorResponse(result.error || 'Failed to deploy workflow')
      }

      const isDeployed = Boolean(result.activeDeployment)
      const attemptActivated = result.latestDeploymentAttempt?.status === 'active'
      logger.info(
        `[${requestId}] Admin API: Deployment ${attemptActivated ? 'activated' : 'accepted'} for workflow ${workflowId}`
      )

      const response: AdminV1DeployResult = {
        isDeployed,
        version: result.version ?? null,
        deployedAt: result.deployedAt?.toISOString() ?? null,
        warnings: result.warnings,
        activeDeployment: result.activeDeployment,
        latestDeploymentAttempt: result.latestDeploymentAttempt,
      }

      return singleResponse(response)
    } catch (error) {
      logger.error(`Admin API: Failed to deploy workflow ${workflowId}`, { error })
      return internalErrorResponse('Failed to deploy workflow')
    }
  })
)

export const DELETE = withRouteHandler(
  withAdminAuthParams<RouteParams>(async (request, context) => {
    const parsed = await parseRequest(adminV1UndeployWorkflowContract, request, context)
    if (!parsed.success) return parsed.response

    const { id: workflowId } = parsed.data.params
    const requestId = generateRequestId()

    try {
      const workflowRecord = await getActiveWorkflowRecord(workflowId)

      if (!workflowRecord) {
        return notFoundResponse('Workflow')
      }

      const result = await performFullUndeploy({
        workflowId,
        userId: workflowRecord.userId,
        requestId,
        actorId: 'admin-api',
      })

      if (!result.success) {
        return internalErrorResponse(result.error || 'Failed to undeploy workflow')
      }

      logger.info(`Admin API: Undeployed workflow ${workflowId}`)

      const response: AdminV1UndeployResult = {
        isDeployed: false,
        warnings: result.warnings,
      }

      return singleResponse(response)
    } catch (error) {
      logger.error(`Admin API: Failed to undeploy workflow ${workflowId}`, { error })
      return internalErrorResponse('Failed to undeploy workflow')
    }
  })
)
