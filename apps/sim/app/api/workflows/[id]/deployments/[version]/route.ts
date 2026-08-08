import { db, workflowDeploymentVersion } from '@sim/db'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { updateDeploymentVersionMetadataContract } from '@/lib/api/contracts/deployments'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { InternalUnauthenticatedError, internalSessionAuth } from '@/lib/api/server/routes'
import { asOrchestrationError, statusForOrchestrationError } from '@/lib/core/orchestration/types'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import { activateWorkflowVersion } from '@/lib/workflows/application/deployments'
import { readWorkflowVersion } from '@/lib/workflows/application/read-workflow-version'
import { updateDeploymentVersionMetadata } from '@/lib/workflows/persistence/utils'
import { validateWorkflowPermissions } from '@/lib/workflows/utils'
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
          input: { workflowId: id, version: versionNum, transition: 'activate', requestId },
          request,
        })

        let updatedName: string | null | undefined
        let updatedDescription: string | null | undefined
        if (name !== undefined || description !== undefined) {
          const activationUpdateData: { name?: string; description?: string | null } = {}
          if (name !== undefined) {
            activationUpdateData.name = name
          }
          if (description !== undefined) {
            activationUpdateData.description = description
          }

          const [updated] = await db
            .update(workflowDeploymentVersion)
            .set(activationUpdateData)
            .where(
              and(
                eq(workflowDeploymentVersion.workflowId, id),
                eq(workflowDeploymentVersion.version, versionNum)
              )
            )
            .returning({
              name: workflowDeploymentVersion.name,
              description: workflowDeploymentVersion.description,
            })

          if (updated) {
            updatedName = updated.name
            updatedDescription = updated.description
            logger.info(
              `[${requestId}] Updated deployment version ${version} metadata during activation`,
              { name: activationUpdateData.name, description: activationUpdateData.description }
            )
          }
        }

        captureServerEvent(
          principal.userId,
          'deployment_version_activated',
          {
            workflow_id: activateResult.workflowId,
            workspace_id: activateResult.workspaceId,
            version: versionNum,
          },
          { groups: { workspace: activateResult.workspaceId } }
        )

        return createSuccessResponse({
          success: true,
          deployedAt: activateResult.deployedAt ?? null,
          warnings: activateResult.warnings,
          activeDeployment: activateResult.activeDeployment ?? null,
          latestDeploymentAttempt: activateResult.latestDeploymentAttempt ?? null,
          ...(updatedName !== undefined && { name: updatedName }),
          ...(updatedDescription !== undefined && { description: updatedDescription }),
        })
      }

      const { error } = await validateWorkflowPermissions(id, requestId, 'write')
      if (error) {
        return createErrorResponse(error.message, error.status)
      }

      // Handle name/description updates (shared with the update_deployment_version copilot tool)
      const updated = await updateDeploymentVersionMetadata({
        workflowId: id,
        version: versionNum,
        name,
        description,
      })

      if (!updated) {
        return createErrorResponse('Deployment version not found', 404)
      }

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
