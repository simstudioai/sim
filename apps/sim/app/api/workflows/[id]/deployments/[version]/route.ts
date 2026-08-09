import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import { updateDeploymentVersionMetadataContract } from '@/lib/api/contracts/deployments'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { InternalUnauthenticatedError, internalSessionAuth } from '@/lib/api/server/routes'
import { asOrchestrationError, statusForOrchestrationError } from '@/lib/core/orchestration/types'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  activateWorkflowVersion,
  updateWorkflowVersion,
} from '@/lib/workflows/application/deployments'
import { readWorkflowVersion } from '@/lib/workflows/application/read-workflow-version'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('WorkflowDeploymentVersionAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

export const GET = withRouteHandler(
  async (
    request: NextRequest,
    { params }: { params: Promise<{ id: string; version: string }> }
  ) => {
    const requestId = generateRequestId()
    const { id, version } = await params

    try {
      const principal = await internalSessionAuth.authenticate()

      const versionNum = Number(version)
      if (!Number.isFinite(versionNum)) {
        return createErrorResponse('Invalid version', 400)
      }

      const { version: row } = await readWorkflowVersion.execute({
        principal,
        input: { workflowId: id, version: versionNum },
        request,
      })

      return createSuccessResponse({ deployedState: row.state })
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
      logger.error(
        `[${requestId}] Error fetching deployment version ${version} for workflow ${id}`,
        { error }
      )
      return createErrorResponse('Failed to fetch deployment version', 500)
    }
  }
)

export const PATCH = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string; version: string }> }) => {
    const requestId = generateRequestId()

    try {
      const principal = await internalSessionAuth.authenticate()
      const parsed = await parseRequest(updateDeploymentVersionMetadataContract, request, context, {
        validationErrorResponse: (error) =>
          createErrorResponse(getValidationErrorMessage(error, 'Invalid request body'), 400),
      })
      if (!parsed.success) return parsed.response

      const { id, version } = parsed.data.params
      const { name, description, isActive } = parsed.data.body

      const versionNum = version

      // Handle activation
      if (isActive) {
        const activateResult = await activateWorkflowVersion.execute({
          principal,
          input: {
            workflowId: id,
            version: versionNum,
            transition: 'activate',
            requestId,
            analytics: 'human',
            name,
            description,
          },
          request,
        })

        if (name !== undefined || description !== undefined) {
          logger.info(
            `[${requestId}] Updated deployment version ${version} metadata during activation`,
            { name, description }
          )
        }

        return createSuccessResponse({
          success: true,
          deployedAt: activateResult.deployedAt ?? null,
          warnings: activateResult.warnings,
          activeDeployment: activateResult.activeDeployment ?? null,
          latestDeploymentAttempt: activateResult.latestDeploymentAttempt ?? null,
          ...(name !== undefined && { name: activateResult.name ?? null }),
          ...(description !== undefined && { description: activateResult.description ?? null }),
        })
      }

      const updated = await updateWorkflowVersion.execute({
        principal,
        input: { workflowId: id, version: versionNum, name, description },
        request,
      })

      logger.info(`[${requestId}] Updated deployment version ${version} for workflow ${id}`, {
        name,
        description,
      })

      return createSuccessResponse({ name: updated.name, description: updated.description })
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
      logger.error(`[${requestId}] Error updating deployment version`, { error })
      return createErrorResponse('Failed to update deployment version', 500)
    }
  }
)
