import { createLogger } from '@sim/logger'
import { assertWorkflowMutable, WorkflowLockedError } from '@sim/platform-authz/workflow'
import { v1RollbackWorkflowBodySchema } from '@/lib/api/contracts/v1/workflows'
import { v2RollbackWorkflowContract } from '@/lib/api/contracts/v2/workflows'
import { parseOptionalJsonBody } from '@/lib/api/server'
import { captureServerEvent } from '@/lib/posthog/server'
import { performActivateVersion } from '@/lib/workflows/orchestration'
import { findPreviousDeploymentVersion } from '@/lib/workflows/persistence/utils'
import { withPublicApiRouteHandler } from '@/app/api/public-api-route-handler'
import { v2Data, v2Error, v2ValidationError } from '@/app/api/v2/lib/response'
import { resolveV2WorkflowTarget } from '@/app/api/v2/workflows/utils'

const logger = createLogger('V2WorkflowRollbackAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

export const POST = withPublicApiRouteHandler({
  contract: v2RollbackWorkflowContract,
  rateLimitEndpoint: 'workflow-rollback',
  handler: async ({ request, input, auth: { requestId, userId, rateLimit } }) => {
    try {
      const { id } = input.params

      const rawBody = await parseOptionalJsonBody(request)
      if (!rawBody.success) {
        return rawBody.response.status === 413
          ? v2Error('PAYLOAD_TOO_LARGE', 'Request body is too large')
          : v2Error('BAD_REQUEST', 'Request body must be valid JSON')
      }
      const body = v1RollbackWorkflowBodySchema.safeParse(rawBody.data ?? {})
      if (!body.success) return v2ValidationError(body.error)

      const target = await resolveV2WorkflowTarget(rateLimit, userId, id, 'admin')
      if (!target) return v2Error('NOT_FOUND', 'Workflow not found')
      const { workflow, workspaceId } = target

      if (!workflow.isDeployed) {
        return v2Error('BAD_REQUEST', 'Workflow is not deployed')
      }

      await assertWorkflowMutable(id)

      let targetVersion = body.data.version
      if (targetVersion === undefined) {
        const previous = await findPreviousDeploymentVersion(id)
        if (!previous.ok) {
          const message =
            previous.reason === 'no_active_version'
              ? 'Workflow has no active deployment to roll back from'
              : 'No previous deployment version to roll back to'
          return v2Error('BAD_REQUEST', message)
        }
        targetVersion = previous.version
      }

      logger.info(
        `[${requestId}] Rolling back workflow ${id} to version ${targetVersion} via v2 API`,
        { userId }
      )

      const result = await performActivateVersion({
        workflowId: id,
        version: targetVersion,
        userId,
        requestId,
      })

      if (!result.success) {
        const code =
          result.errorCode === 'not_found'
            ? 'NOT_FOUND'
            : result.errorCode === 'validation'
              ? 'BAD_REQUEST'
              : 'INTERNAL_ERROR'
        return v2Error(code, result.error || 'Failed to roll back workflow')
      }

      captureServerEvent(
        userId,
        'deployment_version_activated',
        { workflow_id: id, workspace_id: workspaceId, version: targetVersion },
        { groups: { workspace: workspaceId } }
      )

      return v2Data(
        {
          id,
          isDeployed: true,
          deployedAt: result.deployedAt?.toISOString() ?? null,
          version: targetVersion,
          warnings: result.warnings ?? [],
        },
        { rateLimit }
      )
    } catch (error) {
      if (error instanceof WorkflowLockedError) {
        return v2Error('LOCKED', error.message)
      }
      throw error
    }
  },
})
