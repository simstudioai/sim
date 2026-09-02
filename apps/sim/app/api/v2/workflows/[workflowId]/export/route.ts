import { v2ExportWorkflowContract } from '@/lib/api/contracts/v2/workflows'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2WorkflowErrorPolicies } from '@/lib/workflows/api'
import { exportWorkflow } from '@/lib/workflows/application/import-export'
import { workflowOperations } from '@/lib/workflows/application/operations'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * `headSafe: false` because the use case projects a `WORKFLOW_EXPORTED` audit
 * event. Letting Next alias `HEAD` onto this `GET` would record an export that
 * handed the caller no bytes.
 */
export const GET = defineV2JsonRoute({
  contract: v2ExportWorkflowContract,
  auth: v2ApiKeyAuth,
  operation: workflowOperations.export,
  rateLimit: v2RateLimits.publicApi,
  headSafe: false,
  errorPolicy: v2WorkflowErrorPolicies.concealWorkflowAuthorization,
  mapInput: ({ params, query }) => ({
    workflowId: params.workflowId,
    includeWorkspaceBindings: query.includeWorkspaceBindings,
  }),

  useCase: exportWorkflow,
  present: ({ payload, folderPath }) => ({
    data: {
      ...payload,
      workflow: {
        id: payload.workflow.id,
        name: payload.workflow.name,
        description: payload.workflow.description,
        workspaceId: payload.workflow.workspaceId,
        folderPath,
      },
    },
  }),
})
