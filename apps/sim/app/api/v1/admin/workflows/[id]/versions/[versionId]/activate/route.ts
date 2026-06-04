import { createLogger } from '@sim/logger'
import { getActiveWorkflowRecord } from '@sim/workflow-authz'
import { adminV1ActivateWorkflowVersionContract } from '@/lib/api/contracts/v1/admin'
import { parseRequest } from '@/lib/api/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { performActivateVersion } from '@/lib/workflows/orchestration'
import { withAdminAuthParams } from '@/app/api/v1/admin/middleware'
import {
  badRequestResponse,
  internalErrorResponse,
  notFoundResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'

const logger = createLogger('AdminWorkflowActivateVersionAPI')
export const maxDuration = 120

interface RouteParams {
  id: string
  versionId: string
}

export const POST = withRouteHandler(
  withAdminAuthParams<RouteParams>(async (request, context) => {
    const requestId = generateRequestId()
    const parsed = await parseRequest(adminV1ActivateWorkflowVersionContract, request, context)
    if (!parsed.success) return parsed.response

    const { id: workflowId, versionId: versionNum } = parsed.data.params

    try {
      const workflowRecord = await getActiveWorkflowRecord(workflowId)

      if (!workflowRecord) {
        return notFoundResponse('Workflow')
      }

      const result = await performActivateVersion({
        workflowId,
        version: versionNum,
        userId: workflowRecord.userId,
        workflow: workflowRecord as Record<string, unknown>,
        requestId,
        request,
        actorId: 'admin-api',
      })

      if (!result.success) {
        if (result.errorCode === 'not_found') return notFoundResponse('Deployment version')
        if (result.errorCode === 'validation') return badRequestResponse(result.error!)
        return internalErrorResponse(result.error || 'Failed to activate version')
      }

      logger.info(
        `[${requestId}] Admin API: Activated version ${versionNum} for workflow ${workflowId}`
      )

      return singleResponse({
        success: true,
        version: versionNum,
        deployedAt: result.deployedAt!.toISOString(),
        warnings: result.warnings,
      })
    } catch (error) {
      logger.error(
        `[${requestId}] Admin API: Failed to activate version for workflow ${workflowId}`,
        { error }
      )
      return internalErrorResponse('Failed to activate deployment version')
    }
  })
)
