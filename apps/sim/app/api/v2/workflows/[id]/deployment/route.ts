import { v2GetWorkflowDeploymentContract } from '@/lib/api/contracts/v2/workflows'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2WorkflowErrorPolicies } from '@/lib/workflows/api'
import { readWorkflowDeploymentStatus } from '@/lib/workflows/application/deployments'
import { workflowOperations } from '@/lib/workflows/application/operations'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/v2/workflows/[id]/deployment — Read current deployment state.
 *
 * The deploy, undeploy, and rollback responses are the only other place this
 * state is published, so a caller that lost one — or that polls from a
 * different process — had no way to ask. `needsRedeployment` is exposed here
 * only: it compares the draft against the live version, so it is meaningless on
 * the response of the mutation that just made them equal.
 *
 * `deployedAt` comes from the active deployment version, which always carries
 * one. The workflow's own `deployed_at` column is deliberately not used as a
 * fallback: it retains the timestamp of a deployment that has since been
 * undeployed, so reading it would report a deploy time alongside
 * `isDeployed: false`.
 */
/**
 * Deliberately head-safe despite issuing a write.
 *
 * Reading a workflow can trigger a migrate-on-read `workflow_blocks` update when
 * `applyBlockMigrations` upgrades a stored block. That write is convergent: it is
 * conditional on a migration actually applying, idempotent, and would be issued by
 * the next ordinary read regardless, so a `HEAD` only brings it forward.
 *
 * `headSafe: false` is reserved for effects a probe would otherwise *fabricate* —
 * an audit row recording an export or download that never happened — or that reach
 * a third party. Declaring it here would also cost real capability, because
 * {@link v2HeadNoEffect} answers `200` unconditionally, so a `HEAD` could no longer
 * distinguish a workflow that exists from one that does not.
 */
export const GET = defineV2JsonRoute({
  contract: v2GetWorkflowDeploymentContract,
  auth: v2ApiKeyAuth,
  operation: workflowOperations.read,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2WorkflowErrorPolicies.concealWorkflowAuthorization,
  mapInput: ({ params }) => ({ workflowId: params.id }),
  useCase: readWorkflowDeploymentStatus,
  present: (result) => ({
    data: {
      id: result.workflow.id,
      isDeployed: result.isDeployed,
      needsRedeployment: result.needsRedeployment,
      deployedAt: result.activeDeployment?.deployedAt ?? null,
      warnings: result.warnings ?? [],
      activeDeployment: result.activeDeployment ?? null,
      latestDeploymentAttempt: result.latestDeploymentAttempt ?? null,
    },
  }),
})
