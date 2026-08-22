import { createLogger } from '@sim/logger'
import {
  deployedWorkflowStateSchema,
  getDeployedWorkflowStateContract,
} from '@/lib/api/contracts/deployments'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
} from '@/lib/api/server/routes'
import { internalWorkflowSessionOrExecutorAuth } from '@/lib/workflows/api'
import { readWorkflowDefinition } from '@/lib/workflows/application/read-workflow-definition'

const logger = createLogger('WorkflowDeployedStateAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const GET = defineInternalJsonRoute({
  contract: getDeployedWorkflowStateContract,
  auth: internalWorkflowSessionOrExecutorAuth,
  operation: readWorkflowDefinition.operation,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing internal workflow read behavior',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({ workflowId: params.id, state: 'deployed' as const }),
  useCase: readWorkflowDefinition,
  present: ({ state }) => ({
    deployedState: state
      ? deployedWorkflowStateSchema.parse({
          blocks: state.blocks,
          edges: state.edges,
          loops: state.loops,
          parallels: state.parallels,
          variables: 'variables' in state ? (state.variables ?? {}) : {},
        })
      : null,
  }),
  onSuccess: ({ input, result }) => {
    if (!result.state) logger.warn('Workflow has no active deployed state', input)
  },
  responseHeaders: () => ({
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  }),
})
