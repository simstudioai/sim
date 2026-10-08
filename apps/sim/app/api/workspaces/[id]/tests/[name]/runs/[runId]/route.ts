import { getWorkflowTestRunContract } from '@/lib/api/contracts/workflow-tests'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { workflowTestOperations } from '@/lib/workflow-tests/application/operations'
import { getWorkflowTestRunDetail } from '@/lib/workflow-tests/application/tests'

export const GET = defineInternalJsonRoute({
  contract: getWorkflowTestRunContract,
  auth: internalSessionAuth,
  operation: workflowTestOperations.read,
  rateLimit: internalRateLimits.user({ bucketName: 'workflow-tests' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({
    workspaceId: params.id,
    name: params.name,
    runId: params.runId,
  }),
  useCase: getWorkflowTestRunDetail,
})
