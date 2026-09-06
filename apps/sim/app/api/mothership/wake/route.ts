import { after } from 'next/server'
import { wakeMothershipTaskContract } from '@/lib/api/contracts/mothership-tasks'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
} from '@/lib/api/server/routes'
import { taskOperations } from '@/lib/mothership/tasks/application/operations'
import { prepareTaskWake } from '@/lib/mothership/tasks/application/prepare-wake'
import { internalTaskAuth } from '@/lib/mothership/tasks/auth'
import { runWakeTurn } from '@/lib/mothership/tasks/wake'

export const POST = defineInternalJsonRoute({
  contract: wakeMothershipTaskContract,
  auth: internalTaskAuth,
  operation: taskOperations.wake,
  rateLimit: internalRateLimits.none({
    reason:
      'Worker dispatch leases bound requests; chat admission serializes wakes with user turns.',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ body }) => body,
  useCase: prepareTaskWake,
  onSuccess: ({ input }) => {
    after(() => runWakeTurn(input))
  },
})
