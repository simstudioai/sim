import { workspaceComputerUseAvailabilityContract } from '@/lib/api/contracts/computer-use'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { workspaceComputerUseAvailability } from '@/lib/computer-use/application/availability'

export const GET = defineInternalJsonRoute({
  contract: workspaceComputerUseAvailabilityContract,
  auth: internalSessionAuth,
  operation: workspaceComputerUseAvailability.operation,
  rateLimit: internalRateLimits.user({ bucketName: 'desktop-computer-use-availability' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({ workspaceId: params.id }),
  useCase: workspaceComputerUseAvailability,
  present: (available) => ({ available }),
})
