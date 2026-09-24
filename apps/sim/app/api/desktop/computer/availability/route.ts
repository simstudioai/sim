import { computerUseAvailabilityContract } from '@/lib/api/contracts/computer-use'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { readComputerUseAvailability } from '@/lib/computer-use/application/availability'

export const GET = defineInternalJsonRoute({
  contract: computerUseAvailabilityContract,
  auth: internalSessionAuth,
  operation: readComputerUseAvailability.operation,
  rateLimit: internalRateLimits.none({
    reason: 'Read-only rollout switch used on each desktop chat admission.',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: () => undefined,
  useCase: readComputerUseAvailability,
  present: (result) => result,
})
