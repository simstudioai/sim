import { createLogger } from '@sim/logger'
import { generateRequestId } from '@/lib/core/utils/request'
import { getActiveWorkflowRecord } from '@/lib/workflows/active-context'
import { performFullDeploy, performFullUndeploy } from '@/lib/workflows/orchestration'
import { withAdminAuthParams } from '@/app/api/v1/admin/middleware'
import {
  internalErrorResponse,
  notFoundResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'
import type { AdminDeployResult, AdminUndeployResult } from '@/app/api/v1/admin/types'

const logger = createLogger('AdminWorkflowDeployAPI')

interface RouteParams {
  id: string
}

export const POST = withAdminAuthParams<RouteParams>(async (request, context) => {
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
    })

    if (!result.success) {
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

export const DELETE = withAdminAuthParams<RouteParams>(async (_request, context) => {
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
