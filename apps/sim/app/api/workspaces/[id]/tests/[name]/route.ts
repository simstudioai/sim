import { getWorkflowTestContract } from '@/lib/api/contracts/workflow-tests'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { workflowTestOperations } from '@/lib/workflow-tests/application/operations'
import { getWorkflowTestDetail } from '@/lib/workflow-tests/application/tests'

export const GET = defineInternalJsonRoute({
  contract: getWorkflowTestContract,
  auth: internalSessionAuth,
  operation: workflowTestOperations.read,
  rateLimit: internalRateLimits.user({
    bucketName: 'workflow-tests-read',
    // A running test polls these every 3s from each open page and chat tab.
    config: { maxTokens: 240, refillRate: 120, refillIntervalMs: 60_000 },
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, query }) => ({
    workspaceId: params.id,
    name: params.name,
    version: query.version,
  }),
  useCase: getWorkflowTestDetail,
})
