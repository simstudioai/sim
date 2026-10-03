import { getMothershipTaskStatusContract } from '@/lib/api/contracts/mothership-tasks'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { taskOperations } from '@/lib/mothership/tasks/application/operations'
import { readTaskStatus } from '@/lib/mothership/tasks/application/read-status'

export const GET = defineInternalJsonRoute({
  contract: getMothershipTaskStatusContract,
  auth: internalSessionAuth,
  operation: taskOperations.readStatus,
  rateLimit: internalRateLimits.user({
    bucketName: 'mothership-task-status',
    // Twenty active watches, each refreshing every ten seconds.
    config: { maxTokens: 120, refillRate: 120, refillIntervalMs: 60_000 },
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => params,
  useCase: readTaskStatus,
})
