import { createLogger } from '@sim/logger'
import { assertWorkflowMutable, WorkflowLockedError } from '@sim/platform-authz/workflow'
import { v1DeployWorkflowBodySchema } from '@/lib/api/contracts/v1/workflows'
import {
  v2DeployWorkflowContract,
  v2UndeployWorkflowContract,
} from '@/lib/api/contracts/v2/workflows'
import { parseOptionalJsonBody } from '@/lib/api/server'
import { captureServerEvent } from '@/lib/posthog/server'
import { performFullDeploy, performFullUndeploy } from '@/lib/workflows/orchestration'
import { withPublicApiRouteHandler } from '@/app/api/public-api-route-handler'
import { v2Data, v2Error, v2ValidationError } from '@/app/api/v2/lib/response'
import { resolveV2WorkflowTarget } from '@/app/api/v2/workflows/utils'

const logger = createLogger('V2WorkflowDeployAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

export const POST = withPublicApiRouteHandler({
  contract: v2DeployWorkflowContract,
  rateLimitEndpoint: 'workflow-deploy',
  handler: async ({ request, input, auth: { requestId, userId, rateLimit } }) => {
    try {
      const { id } = input.params

      const rawBody = await parseOptionalJsonBody(request)
      if (!rawBody.success) {
        return rawBody.response.status === 413
          ? v2Error('PAYLOAD_TOO_LARGE', 'Request body is too large')
          : v2Error('BAD_REQUEST', 'Request body must be valid JSON')
      }
      const body = v1DeployWorkflowBodySchema.safeParse(rawBody.data ?? {})
      if (!body.success) return v2ValidationError(body.error)

      const target = await resolveV2WorkflowTarget(rateLimit, userId, id, 'admin')
      if (!target) return v2Error('NOT_FOUND', 'Workflow not found')
      const { workspaceId } = target

      await assertWorkflowMutable(id)

      logger.info(`[${requestId}] Deploying workflow ${id} via v2 API`, { userId })

      const result = await performFullDeploy({
        workflowId: id,
        userId,
        versionName: body.data.name,
        versionDescription: body.data.description ?? undefined,
        requestId,
      })

      if (!result.success) {
        const code =
          result.errorCode === 'not_found'
            ? 'NOT_FOUND'
            : result.errorCode === 'validation'
              ? 'BAD_REQUEST'
              : 'INTERNAL_ERROR'
        return v2Error(code, result.error || 'Failed to deploy workflow')
      }

      captureServerEvent(
        userId,
        'workflow_deployed',
        { workflow_id: id, workspace_id: workspaceId },
        {
          groups: { workspace: workspaceId },
          setOnce: { first_workflow_deployed_at: new Date().toISOString() },
        }
      )

      return v2Data(
        {
          id,
          isDeployed: true,
          deployedAt: result.deployedAt?.toISOString() ?? null,
          version: result.version,
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

export const DELETE = withPublicApiRouteHandler({
  contract: v2UndeployWorkflowContract,
  rateLimitEndpoint: 'workflow-deploy',
  handler: async ({ input, auth: { requestId, userId, rateLimit } }) => {
    try {
      const { id } = input.params

      const target = await resolveV2WorkflowTarget(rateLimit, userId, id, 'admin')
      if (!target) return v2Error('NOT_FOUND', 'Workflow not found')
      const { workflow, workspaceId } = target

      if (!workflow.isDeployed) {
        return v2Error('BAD_REQUEST', 'Workflow is not deployed')
      }

      await assertWorkflowMutable(id)

      logger.info(`[${requestId}] Undeploying workflow ${id} via v2 API`, { userId })

      const result = await performFullUndeploy({ workflowId: id, userId, requestId })
      if (!result.success) {
        return v2Error('INTERNAL_ERROR', result.error || 'Failed to undeploy workflow')
      }

      captureServerEvent(
        userId,
        'workflow_undeployed',
        { workflow_id: id, workspace_id: workspaceId },
        { groups: { workspace: workspaceId } }
      )

      return v2Data(
        {
          id,
          isDeployed: false,
          deployedAt: null,
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
