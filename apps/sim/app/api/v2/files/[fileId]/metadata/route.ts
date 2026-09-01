import { v2GetFileContract } from '@/lib/api/contracts/v2/files'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2FileErrorPolicies } from '@/lib/workspace-files/api'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { readWorkspaceFileMetadata } from '@/lib/workspace-files/application/read-workspace-file-metadata'
import { toV2File } from '@/app/api/v2/files/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/v2/files/[fileId]/metadata — Return file metadata without downloading its bytes.
 *
 * `scope` mirrors the list endpoint's lifecycle selector: it defaults to `active`, and only an
 * explicit `scope=archived` relaxes the soft-delete predicate on the row lookup so a caller can
 * inspect an archived file before restoring it. Authorization is unaffected — the use case still
 * resolves the canonical workspace context for the file and authorizes `files.read_metadata`
 * against it either way.
 */
export const GET = defineV2JsonRoute({
  contract: v2GetFileContract,
  auth: v2ApiKeyAuth,
  operation: fileOperations.readMetadata,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2FileErrorPolicies.concealResourceAuthorization,
  mapInput: ({ params, query }) => ({
    fileId: params.fileId,
    assertedWorkspaceId: query.workspaceId,
    includeDeleted: query.scope === 'archived',
  }),
  useCase: readWorkspaceFileMetadata,
  present: async ({ file, share }) => ({ data: { ...(await toV2File(file)), share } }),
})
