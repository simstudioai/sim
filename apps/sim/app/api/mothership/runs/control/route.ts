import { readRunControlContract } from '@/lib/api/contracts/mothership-run-control'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
} from '@/lib/api/server/routes'
import { internalCopilotAuth } from '@/lib/mothership/auth/internal'
import {
  RUN_CONTROL_AUDIENCE,
  readRunControl,
  readRunControlOperation,
} from '@/lib/mothership/request/application/read-control'

export const POST = defineInternalJsonRoute({
  contract: readRunControlContract,
  auth: internalCopilotAuth(RUN_CONTROL_AUDIENCE),
  operation: readRunControlOperation,
  rateLimit: internalRateLimits.none({
    reason: 'Worker reconciles durable cancellation for its own run.',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ body }) => body,
  useCase: readRunControl,
})
