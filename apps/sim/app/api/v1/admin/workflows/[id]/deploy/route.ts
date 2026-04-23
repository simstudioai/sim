import { createLogger } from '@sim/logger'
import { getActiveWorkflowRecord } from '@sim/workflow-authz'
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
import type { AdminDeployResult, AdminUndeployResult } from '@/app/api/v1/admin/types'

const logger = createLogger('AdminWorkflowDeployAPI')

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
    const { id: workflowId } = await context.params
    const requestId = generateRequestId()

    try {
      const workflowRecord = await getActiveWorkflowRecord(workflowId)

      if (!workflowRecord) {
        return notFoundResponse('Workflow')
      }

      const result = await performFullDeploy({
        workflowId,
        userId: workflowRecord.userId,
        workflowName: workflowRecord.name,
        requestId,
        request,
        actorId: 'admin-api',
      })

      if (!result.success) {
        if (result.errorCode === 'not_found') return notFoundResponse('Workflow state')
        if (result.errorCode === 'validation') return badRequestResponse(result.error!)
        return internalErrorResponse(result.error || 'Failed to deploy workflow')
      }

      logger.info(`[${requestId}] Admin API: Deployed workflow ${workflowId} as v${result.version}`)

      const response: AdminDeployResult = {
        isDeployed: true,
        version: result.version!,
        deployedAt: result.deployedAt!.toISOString(),
        warnings: result.warnings,
      }

      return singleResponse(response)
    } catch (error) {
      logger.error(`Admin API: Failed to deploy workflow ${workflowId}`, { error })
      return internalErrorResponse('Failed to deploy workflow')
    }
  })
)

export const DELETE = withRouteHandler(
  withAdminAuthParams<RouteParams>(async (_request, context) => {
    const { id: workflowId } = await context.params
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

      const response: AdminUndeployResult = {
        isDeployed: false,
      }

      return singleResponse(response)
    } catch (error) {
      logger.error(`Admin API: Failed to undeploy workflow ${workflowId}`, { error })
      return internalErrorResponse('Failed to undeploy workflow')
    }
  })
)
