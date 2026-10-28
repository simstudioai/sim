import { runWorkflowTestsContract } from '@/lib/api/contracts/workflow-tests'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { workflowTestOperations } from '@/lib/workflow-tests/application/operations'
import { startWorkflowTestRuns } from '@/lib/workflow-tests/application/run-tests'

export const POST = defineInternalJsonRoute({
  contract: runWorkflowTestsContract,
  auth: internalSessionAuth,
  operation: workflowTestOperations.run,
  rateLimit: internalRateLimits.user({ bucketName: 'workflow-tests' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({ workspaceId: params.id, ...body }),
  useCase: startWorkflowTestRuns,
})
