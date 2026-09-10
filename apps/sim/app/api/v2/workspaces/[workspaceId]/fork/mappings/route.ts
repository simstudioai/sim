import {
  v2GetWorkspaceForkMappingsContract,
  v2UpdateWorkspaceForkMappingsContract,
} from '@/lib/api/contracts/v2/workspace-fork'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2ForkErrorPolicy } from '@/ee/workspace-forking/api/route-policies'
import { getWorkspaceForkMappings } from '@/ee/workspace-forking/application/discovery'
import { forkOperations } from '@/ee/workspace-forking/application/operations'
import { updateWorkspaceForkMappings } from '@/ee/workspace-forking/application/recovery-and-mappings'

export const GET = defineV2JsonRoute({
  contract: v2GetWorkspaceForkMappingsContract,
  auth: v2ApiKeyAuth,
  operation: forkOperations.mappingsRead,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2ForkErrorPolicy,
  mapInput: ({ params, query }) => ({ ...params, ...query }),
  useCase: getWorkspaceForkMappings,
  present: ({ items, nextCursor }) => ({ data: items, nextCursor }),
})

export const PUT = defineV2JsonRoute({
  contract: v2UpdateWorkspaceForkMappingsContract,
  auth: v2ApiKeyAuth,
  operation: forkOperations.mappingsUpdate,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2ForkErrorPolicy,
  parseOptions: { maxBodyBytes: 10 * 1024 * 1024 },
  mapInput: ({ params, body }) => ({ ...params, ...body }),
  useCase: updateWorkspaceForkMappings,
  present: (result) => ({ data: result }),
})
