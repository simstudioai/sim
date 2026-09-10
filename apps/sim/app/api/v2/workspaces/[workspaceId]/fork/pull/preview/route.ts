import { v2PreviewWorkspacePullContract } from '@/lib/api/contracts/v2/workspace-fork'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2ForkErrorPolicy } from '@/ee/workspace-forking/api/route-policies'
import { previewWorkspaceSync } from '@/ee/workspace-forking/application/create-and-sync'
import { forkOperations } from '@/ee/workspace-forking/application/operations'

export const POST = defineV2JsonRoute({
  contract: v2PreviewWorkspacePullContract,
  auth: v2ApiKeyAuth,
  operation: forkOperations.syncPreview,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2ForkErrorPolicy,
  parseOptions: { maxBodyBytes: 10 * 1024 * 1024 },
  mapInput: ({ params, body }) => {
    const { dependentValues, ...choices } = body
    return {
      ...params,
      ...choices,
      sourceDependentValues: dependentValues,
      direction: 'pull' as const,
    }
  },
  useCase: previewWorkspaceSync,
  present: (result) => ({ data: result }),
})
