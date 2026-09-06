import { workflowWatchStatusContract } from '@/lib/api/contracts/mothership-tasks'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
} from '@/lib/api/server/routes'
import { internalCopilotAuth } from '@/lib/mothership/auth/internal'
import { TASK_DELEGATION_AUDIENCE } from '@/lib/mothership/tasks/application/context'
import { taskOperations } from '@/lib/mothership/tasks/application/operations'
import { readWatchedWorkflowStatus } from '@/lib/mothership/tasks/application/read-workflow-status'

export const POST = defineInternalJsonRoute({
  contract: workflowWatchStatusContract,
  auth: internalCopilotAuth(TASK_DELEGATION_AUDIENCE),
  operation: taskOperations.readWorkflowStatus,
  rateLimit: internalRateLimits.none({
    reason: 'Authenticated worker reconciles its bounded task inbox.',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ body }) => body,
  useCase: readWatchedWorkflowStatus,
})
