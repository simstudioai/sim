import { v2ListWorkspaceOperationsContract } from '@/lib/api/contracts/v2/workspace-operations'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { createV2ResourceConcealmentPolicy } from '@/lib/api/server/routes/resource-concealment'
import { listWorkspaceOperations } from '@/lib/workspaces/operations/application'
import { workspaceOperations } from '@/lib/workspaces/operations/operations'

export const GET = defineV2JsonRoute({
  contract: v2ListWorkspaceOperationsContract,
  auth: v2ApiKeyAuth,
  operation: workspaceOperations.read,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: createV2ResourceConcealmentPolicy({ notFoundMessage: 'Operation not found' }),
  mapInput: ({ params, query }) => ({ ...params, ...query }),
  useCase: listWorkspaceOperations,
  present: ({ operations, nextCursor }) => ({ data: operations, nextCursor }),
})
