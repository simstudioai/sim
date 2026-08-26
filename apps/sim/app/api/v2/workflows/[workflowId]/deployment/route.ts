import {
  v2GetWorkflowDeploymentContract,
  v2UpdateWorkflowPublicApiContract,
} from '@/lib/api/contracts/v2/workflows'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2WorkflowErrorPolicies } from '@/lib/workflows/api'
import { readWorkflowDeploymentStatus } from '@/lib/workflows/application/deployments'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { updateWorkflowPublicApi } from '@/lib/workflows/application/update-workflow-deployment-settings'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/v2/workflows/[workflowId]/deployment — Read current deployment state.
 *
 * The deploy, undeploy, and rollback responses are the only other place this
 * state is published, so a caller that lost one — or that polls from a
 * different process — had no way to ask. `needsRedeployment` is exposed here
 * only: it compares the draft against the live version, so it is meaningless on
 * the response of the mutation that just made them equal.
 *
 * `isPublicApi` is published here because it was otherwise write-only: it is
 * settable through `PATCH` on this path but appeared in no read, so a caller
 * that removed authentication from a deployed workflow had no way to audit
 * that it was still off.
 *
 * `deployedAt` comes from the active deployment version, which always carries
 * one. The workflow's own `deployed_at` column is deliberately not used as a
 * fallback: it retains the timestamp of a deployment that has since been
 * undeployed, so reading it would report a deploy time alongside
 * `isDeployed: false`.
 *
 * Deliberately head-safe despite the migrate-on-read write, for the reasons on
 * `GET /api/v2/workflows/[workflowId]`.
 */
export const GET = defineV2JsonRoute({
  contract: v2GetWorkflowDeploymentContract,
  auth: v2ApiKeyAuth,
  operation: workflowOperations.read,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2WorkflowErrorPolicies.concealWorkflowAuthorization,
  mapInput: ({ params }) => ({ workflowId: params.workflowId }),
  useCase: readWorkflowDeploymentStatus,
  present: (result) => ({
    data: {
      id: result.workflow.id,
      isDeployed: result.isDeployed,
      needsRedeployment: result.needsRedeployment,
      isPublicApi: result.workflow.isPublicApi,
      deployedAt: result.activeDeployment?.deployedAt ?? null,
      warnings: result.warnings ?? [],
      activeDeployment: result.activeDeployment ?? null,
      latestDeploymentAttempt: result.latestDeploymentAttempt ?? null,
    },
  }),
})

/**
 * PATCH /api/v2/workflows/[workflowId]/deployment — public API access.
 *
 * Enabling this removes the authentication requirement from the deployed
 * workflow: anyone holding the URL can execute it. It is therefore an admin
 * operation restricted to human principals, and an organization that forbids
 * public sharing refuses it with `PUBLIC_SHARING_NOT_ALLOWED`.
 *
 * It shares a path with the deployment read rather than taking one of its own
 * because the flag is deployment state — `GET` on this path is where a caller
 * looks to see what a deploy currently exposes.
 */
export const PATCH = defineV2JsonRoute({
  contract: v2UpdateWorkflowPublicApiContract,
  auth: v2ApiKeyAuth,
  operation: workflowOperations.updatePublicApi,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2WorkflowErrorPolicies.concealWorkflowAuthorization,
  mapInput: ({ params, body }) => ({
    workflowId: params.workflowId,
    isPublicApi: body.isPublicApi,
  }),
  useCase: updateWorkflowPublicApi,
  present: (result) => ({
    data: { id: result.workflowId, isPublicApi: result.isPublicApi },
  }),
})
