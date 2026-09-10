import { v2PreviewWorkspaceForkContract } from '@/lib/api/contracts/v2/workspace-fork'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2ForkErrorPolicy } from '@/ee/workspace-forking/api/route-policies'
import { previewWorkspaceFork } from '@/ee/workspace-forking/application/create-and-sync'
import { forkOperations } from '@/ee/workspace-forking/application/operations'

export const POST = defineV2JsonRoute({
  contract: v2PreviewWorkspaceForkContract,
  auth: v2ApiKeyAuth,
  operation: forkOperations.preview,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2ForkErrorPolicy,
  parseOptions: { maxBodyBytes: 10 * 1024 * 1024 },
  mapInput: ({ params, body }) => ({ ...params, ...body }),
  useCase: previewWorkspaceFork,
  present: (result) => ({ data: result }),
})
