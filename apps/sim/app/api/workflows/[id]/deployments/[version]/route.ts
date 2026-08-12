import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import {
  getDeploymentVersionStateContract,
  updateDeploymentVersionMetadataContract,
} from '@/lib/api/contracts/deployments'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import {
  concealCrossTenantResourceError,
  defineInternalJsonRoute,
  InternalUnauthenticatedError,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { asOrchestrationError, statusForOrchestrationError } from '@/lib/core/orchestration/types'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createInternalWorkflowErrorPolicy, WORKFLOW_NOT_FOUND_MESSAGE } from '@/lib/workflows/api'
import {
  activateWorkflowVersion,
  updateWorkflowVersion,
} from '@/lib/workflows/application/deployments'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { readWorkflowVersion } from '@/lib/workflows/application/read-workflow-version'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('WorkflowDeploymentVersionAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

export const GET = defineInternalJsonRoute({
  contract: getDeploymentVersionStateContract,
  operation: workflowOperations.readVersion,
  useCase: readWorkflowVersion,
  auth: internalSessionAuth,
  rateLimit: internalRateLimits.none({
    reason: 'Authenticated workspace UI version reads retain their existing admission policy.',
  }),
  errorPolicy: createInternalWorkflowErrorPolicy('Failed to fetch deployment version'),
  /**
   * The deploy modal renders this graph in the preview editor for a member of the owning
   * workspace, who already sees the same credential selections and workspace references on the
   * draft graph. Redacting here would blank OAuth accounts and resource selectors in that viewer
   * without closing any disclosure boundary, so this surface opts into the raw graph.
   */
  mapInput: ({ params }) => ({
    workflowId: params.id,
    version: params.version,
    includeCredentialValues: true,
  }),
  present: ({ version }) => ({ deployedState: version.state }),
})

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
      const orchestrationError = asOrchestrationError(
        concealCrossTenantResourceError(error, WORKFLOW_NOT_FOUND_MESSAGE)
      )
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
