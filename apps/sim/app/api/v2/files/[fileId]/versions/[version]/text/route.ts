import { v2ReadFileVersionTextContract } from '@/lib/api/contracts/v2/file-versions'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2FileErrorPolicies } from '@/lib/workspace-files/api'
import { readWorkspaceFileVersionText } from '@/lib/workspace-files/application/file-versions'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { toV2FileText } from '@/app/api/v2/files/utils'

export const dynamic = 'force-dynamic'

/**
 * GET /api/v2/files/[fileId]/versions/[version]/text — extract one version's text.
 *
 * Extracts exactly as `GET /api/v2/files/[fileId]/text` does, including rendering a generated
 * document before parsing it. Head-safe for the same reason: nothing is audited or written.
 */
export const GET = defineV2JsonRoute({
  contract: v2ReadFileVersionTextContract,
  auth: v2ApiKeyAuth,
  operation: fileOperations.readVersionContent,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2FileErrorPolicies.concealResourceAuthorization,
  mapInput: ({ params, query }) => ({
    fileId: params.fileId,
    assertedWorkspaceId: query.workspaceId,
    version: params.version,
    maxBytes: query.maxBytes,
    offset: query.offset,
    limit: query.limit,
  }),
  useCase: readWorkspaceFileVersionText,
  present: (result) => ({ data: { ...toV2FileText(result), version: result.version.version } }),
})
