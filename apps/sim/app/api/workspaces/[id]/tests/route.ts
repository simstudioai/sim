import { listWorkflowTestsContract } from '@/lib/api/contracts/workflow-tests'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { workflowTestOperations } from '@/lib/workflow-tests/application/operations'
import { listWorkflowTests } from '@/lib/workflow-tests/application/tests'

export const GET = defineInternalJsonRoute({
  contract: listWorkflowTestsContract,
  auth: internalSessionAuth,
  operation: workflowTestOperations.read,
  rateLimit: internalRateLimits.user({ bucketName: 'workflow-tests' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, query }) => ({ workspaceId: params.id, version: query.version }),
  useCase: listWorkflowTests,
})
