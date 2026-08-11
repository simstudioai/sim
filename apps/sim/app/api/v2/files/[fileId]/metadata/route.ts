import { v2GetFileContract } from '@/lib/api/contracts/v2/files'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2FileErrorPolicies } from '@/lib/workspace-files/api'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { readWorkspaceFileMetadata } from '@/lib/workspace-files/application/read-workspace-file-metadata'
import { toV2File } from '@/app/api/v2/files/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** GET /api/v2/files/[fileId]/metadata — Return file metadata without downloading its bytes. */
export const GET = defineV2JsonRoute({
  contract: v2GetFileContract,
  auth: v2ApiKeyAuth,
  operation: fileOperations.readMetadata,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2FileErrorPolicies.concealResourceAuthorization,
  mapInput: ({ params, query }) => ({
    fileId: params.fileId,
    assertedWorkspaceId: query.workspaceId,
  }),
  useCase: readWorkspaceFileMetadata,
  present: async ({ file, share }) => ({ data: { ...(await toV2File(file)), share } }),
})
