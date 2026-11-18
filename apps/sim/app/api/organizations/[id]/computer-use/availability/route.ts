import { organizationComputerUseAvailabilityContract } from '@/lib/api/contracts/computer-use'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { organizationComputerUseAvailability } from '@/lib/computer-use/application/availability'

export const GET = defineInternalJsonRoute({
  contract: organizationComputerUseAvailabilityContract,
  auth: internalSessionAuth,
  operation: organizationComputerUseAvailability.operation,
  rateLimit: internalRateLimits.user({ bucketName: 'desktop-computer-use-availability' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({ organizationId: params.id }),
  useCase: organizationComputerUseAvailability,
  present: (available) => ({ available }),
})
