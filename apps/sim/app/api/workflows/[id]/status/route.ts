import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import { workflowIdParamsSchema } from '@/lib/api/contracts/workflows'
import { getValidationErrorMessage, validateSchema } from '@/lib/api/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { validateWorkflowAccess } from '@/app/api/workflows/middleware'
import {
  checkNeedsRedeployment,
  createErrorResponse,
  createSuccessResponse,
} from '@/app/api/workflows/utils'

const logger = createLogger('WorkflowStatusAPI')

export const GET = withRouteHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()
    const paramsValidation = validateSchema(workflowIdParamsSchema, await params)
    if (!paramsValidation.success) {
      return createErrorResponse(
        getValidationErrorMessage(paramsValidation.error, 'Invalid route parameters'),
        400
      )
    }
    const { id } = paramsValidation.data

    try {
      const validation = await validateWorkflowAccess(request, id, false)
      if (validation.error) {
        logger.warn(`[${requestId}] Workflow access validation failed: ${validation.error.message}`)
        return createErrorResponse(validation.error.message, validation.error.status)
      }

      const needsRedeployment = validation.workflow.isDeployed
        ? await checkNeedsRedeployment(id)
        : false

      return createSuccessResponse({
        isDeployed: validation.workflow.isDeployed,
        deployedAt: validation.workflow.deployedAt,
        isPublished: validation.workflow.isPublished,
        needsRedeployment,
      })
    } catch (error) {
      logger.error(`[${requestId}] Error getting status for workflow: ${id}`, error)
      return createErrorResponse('Failed to get status', 500)
    }
  }
)
