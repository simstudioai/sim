import {
  createMemorySpaceContract,
  listMemorySpacesContract,
} from '@/lib/api/contracts/memory-spaces'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  createMemorySpace,
  listMemorySpaces,
  memorySpaceOperations,
} from '@/lib/mothership/memory/application/spaces'
export const GET = defineInternalJsonRoute({
  contract: listMemorySpacesContract,
  auth: internalSessionAuth,
  operation: memorySpaceOperations.list,
  rateLimit: internalRateLimits.user({ bucketName: 'memory-spaces' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({ organizationId: params.id }),
  useCase: listMemorySpaces,
})

export const POST = defineInternalJsonRoute({
  contract: createMemorySpaceContract,
  auth: internalSessionAuth,
  operation: memorySpaceOperations.create,
  rateLimit: internalRateLimits.user({ bucketName: 'memory-spaces' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({ organizationId: params.id, ...body }),
  useCase: createMemorySpace,
})
