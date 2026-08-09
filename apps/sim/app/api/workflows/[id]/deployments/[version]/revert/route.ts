import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import { revertToDeploymentVersionContract } from '@/lib/api/contracts/deployments'
import { parseRequest } from '@/lib/api/server'
import { InternalUnauthenticatedError, internalSessionAuth } from '@/lib/api/server/routes'
import { asOrchestrationError, statusForOrchestrationError } from '@/lib/core/orchestration/types'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import { revertWorkflowVersion } from '@/lib/workflows/application/deployments'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('RevertToDeploymentVersionAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string; version: string }> }) => {
    try {
      const principal = await internalSessionAuth.authenticate()
      const parsed = await parseRequest(revertToDeploymentVersionContract, request, context)
      if (!parsed.success) return parsed.response
      const { id, version } = parsed.data.params

      const result = await revertWorkflowVersion.execute({
        principal,
        input: { workflowId: id, version },
        request,
      })

      captureServerEvent(
        principal.userId,
        'workflow_deployment_reverted',
        {
          workflow_id: result.workflowId,
          workspace_id: result.workspaceId,
          version: String(result.version),
        },
        { groups: { workspace: result.workspaceId } }
      )

      return createSuccessResponse({
        message: 'Reverted to deployment version',
        lastSaved: result.lastSaved,
      })
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
      logger.error('Error reverting to deployment version', { error })
      return createErrorResponse('Failed to revert', 500)
    }
  }
)
