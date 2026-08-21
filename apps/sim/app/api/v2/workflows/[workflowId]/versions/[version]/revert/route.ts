import { v2RevertWorkflowVersionContract } from '@/lib/api/contracts/v2/workflows'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2WorkflowErrorPolicies } from '@/lib/workflows/api'
import { revertWorkflowVersion } from '@/lib/workflows/application/deployments'
import { workflowOperations } from '@/lib/workflows/application/operations'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * POST /api/v2/workflows/[workflowId]/versions/[version]/revert — overwrite the draft.
 *
 * This replaces the editable draft with the graph pinned by the named version
 * and discards every unsaved edit; it is the most destructive operation in the
 * deployment family. It does not change what is live — a caller looking to move
 * production wants `activate` or `rollback`, both of which leave the draft
 * alone.
 */
export const POST = defineV2JsonRoute({
  contract: v2RevertWorkflowVersionContract,
  auth: v2ApiKeyAuth,
  operation: workflowOperations.revertVersion,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2WorkflowErrorPolicies.concealWorkflowAuthorization,
  parseOptions: {
    optionalJsonBody: true,
  },
  mapInput: ({ params }) => ({ workflowId: params.workflowId, version: params.version }),
  useCase: revertWorkflowVersion,
  present: (result) => ({
    data: {
      id: result.workflowId,
      version: result.version,
      lastSaved: result.lastSaved,
    },
  }),
})
