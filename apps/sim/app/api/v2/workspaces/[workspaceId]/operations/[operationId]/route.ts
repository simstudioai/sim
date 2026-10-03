import { v2GetWorkspaceOperationContract } from '@/lib/api/contracts/v2/workspace-operations'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { createV2ResourceConcealmentPolicy } from '@/lib/api/server/routes/resource-concealment'
import { getWorkspaceOperation } from '@/lib/workspaces/operations/application'
import { workspaceOperations } from '@/lib/workspaces/operations/operations'

export const GET = defineV2JsonRoute({
  contract: v2GetWorkspaceOperationContract,
  auth: v2ApiKeyAuth,
  operation: workspaceOperations.read,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: createV2ResourceConcealmentPolicy({ notFoundMessage: 'Operation not found' }),
  mapInput: ({ params }) => params,
  useCase: getWorkspaceOperation,
  present: (result) => ({ data: result }),
})
