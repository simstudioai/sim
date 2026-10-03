import { v2ApplyWorkflowVariablesContract } from '@/lib/api/contracts/v2/workflows'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2WorkflowErrorPolicies } from '@/lib/workflows/api'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { applyWorkflowVariableOperations } from '@/lib/workflows/application/update-workflow-content'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Merge-patch shaped: only the named variables change, and a `delete` operation
 * is how one is removed. A batch that changes nothing answers `200` with
 * `changed: false` and writes neither a row nor an audit event.
 */
export const PATCH = defineV2JsonRoute({
  contract: v2ApplyWorkflowVariablesContract,
  auth: v2ApiKeyAuth,
  operation: workflowOperations.applyVariableOperations,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2WorkflowErrorPolicies.concealWorkflowAuthorization,
  mapInput: ({ params, body }) => ({
    workflowId: params.workflowId,
    operations: body.operations.map((operation) => ({
      name: operation.name,
      operation: operation.operation,
      ...(operation.operation === 'delete' ? {} : { value: operation.value, type: operation.type }),
    })),
  }),
  useCase: applyWorkflowVariableOperations,
  present: (result, { params }) => ({
    data: { id: params.workflowId, variableCount: result.updated, changed: result.changed },
  }),
})
