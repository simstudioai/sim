import { v2InspectWorkflowContract } from '@/lib/api/contracts/v2/workflow-inspection'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2WorkflowErrorPolicies } from '@/lib/workflows/api'
import { presentWorkflowInspection } from '@/lib/workflows/api/workflow-inspection'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { readWorkflowGraph } from '@/lib/workflows/application/read-workflow-graph'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = defineV2JsonRoute({
  contract: v2InspectWorkflowContract,
  auth: v2ApiKeyAuth,
  operation: workflowOperations.read,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2WorkflowErrorPolicies.concealWorkflowAuthorization,
  mapInput: ({ params }) => ({ workflowId: params.workflowId }),
  useCase: readWorkflowGraph,
  present: (graph, { query }) => ({ data: presentWorkflowInspection(graph, query) }),
})
