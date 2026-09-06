import { workflowWatchStatusContract } from '@/lib/api/contracts/mothership-tasks'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
} from '@/lib/api/server/routes'
import { taskOperations } from '@/lib/mothership/tasks/application/operations'
import { readWatchedWorkflowStatus } from '@/lib/mothership/tasks/application/read-workflow-status'
import { internalTaskAuth } from '@/lib/mothership/tasks/auth'

export const POST = defineInternalJsonRoute({
  contract: workflowWatchStatusContract,
  auth: internalTaskAuth,
  operation: taskOperations.readWorkflowStatus,
  rateLimit: internalRateLimits.none({
    reason: 'Authenticated worker reconciles its bounded task inbox.',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ body }) => body,
  useCase: readWatchedWorkflowStatus,
})
