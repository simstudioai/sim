import { v2RollbackWorkspaceForkContract } from '@/lib/api/contracts/v2/workspace-fork'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2ForkErrorPolicy } from '@/ee/workspace-forking/api/route-policies'
import { forkOperations } from '@/ee/workspace-forking/application/operations'
import { rollbackWorkspaceFork } from '@/ee/workspace-forking/application/recovery-and-mappings'

export const POST = defineV2JsonRoute({
  contract: v2RollbackWorkspaceForkContract,
  auth: v2ApiKeyAuth,
  operation: forkOperations.rollback,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2ForkErrorPolicy,
  parseOptions: { maxBodyBytes: 10 * 1024 * 1024 },
  mapInput: ({ params, body }) => ({ ...params, ...body }),
  useCase: rollbackWorkspaceFork,
  present: (result) => ({ data: result }),
})
