import { v2GetWorkspaceForkLineageContract } from '@/lib/api/contracts/v2/workspace-fork'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2ForkErrorPolicy } from '@/ee/workspace-forking/api/route-policies'
import { getWorkspaceForkLineage } from '@/ee/workspace-forking/application/discovery'
import { forkOperations } from '@/ee/workspace-forking/application/operations'

export const GET = defineV2JsonRoute({
  contract: v2GetWorkspaceForkLineageContract,
  auth: v2ApiKeyAuth,
  operation: forkOperations.discover,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2ForkErrorPolicy,
  mapInput: ({ params }) => params,
  useCase: getWorkspaceForkLineage,
  present: (result) => ({ data: result }),
})
