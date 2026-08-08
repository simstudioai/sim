import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import { listDeploymentVersionsContract } from '@/lib/api/contracts/deployments'
import { parseRequest } from '@/lib/api/server'
import { InternalUnauthenticatedError, internalSessionAuth } from '@/lib/api/server/routes'
import { asOrchestrationError, statusForOrchestrationError } from '@/lib/core/orchestration/types'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { listWorkflowVersions } from '@/lib/workflows/application/list-workflow-versions'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('WorkflowDeploymentsListAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()

    try {
      const principal = await internalSessionAuth.authenticate()
      const parsed = await parseRequest(listDeploymentVersionsContract, request, context)
      if (!parsed.success) return parsed.response
      const { id } = parsed.data.params

      const { versions: rows } = await listWorkflowVersions.execute({
        principal,
        input: { workflowId: id },
        request,
      })
      const versions = rows.map(({ deployedByName, ...version }) => ({
        ...version,
        deployedBy: deployedByName,
      }))

      return createSuccessResponse({ versions })
    } catch (error: unknown) {
      if (error instanceof InternalUnauthenticatedError) {
        return createErrorResponse(error.message, 401)
      }
      const orchestrationError = asOrchestrationError(error)
      if (orchestrationError) {
        return createErrorResponse(
          orchestrationError.message,
          statusForOrchestrationError(orchestrationError.code)
        )
      }
      logger.error(`[${requestId}] Error listing workflow deployments`, { error })
      return createErrorResponse('Failed to list deployments', 500)
    }
  }
)
