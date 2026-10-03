import { v2PushWorkspaceContract } from '@/lib/api/contracts/v2/workspace-fork'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2ForkErrorPolicy } from '@/ee/workspace-forking/api/route-policies'
import { syncWorkspace } from '@/ee/workspace-forking/application/create-and-sync'
import { forkOperations } from '@/ee/workspace-forking/application/operations'

export const POST = defineV2JsonRoute({
  contract: v2PushWorkspaceContract,
  auth: v2ApiKeyAuth,
  operation: forkOperations.sync,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2ForkErrorPolicy,
  parseOptions: { maxBodyBytes: 10 * 1024 * 1024 },
  mapInput: ({ params, body }) => {
    const { dependentValues, confirm: _confirm, ...choices } = body
    return {
      ...params,
      ...choices,
      sourceDependentValues: dependentValues,
      direction: 'push' as const,
    }
  },
  useCase: syncWorkspace,
  present: (result) => ({ data: result.operation! }),
})
