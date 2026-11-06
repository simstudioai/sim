import { selectMemorySpaceContract } from '@/lib/api/contracts/memory-spaces'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  memorySpaceOperations,
  selectMemorySpace,
} from '@/lib/mothership/memory/application/spaces'

export const PUT = defineInternalJsonRoute({
  contract: selectMemorySpaceContract,
  auth: internalSessionAuth,
  operation: memorySpaceOperations.select,
  rateLimit: internalRateLimits.user({ bucketName: 'memory-spaces' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({ organizationId: params.id, ...body }),
  useCase: selectMemorySpace,
})
