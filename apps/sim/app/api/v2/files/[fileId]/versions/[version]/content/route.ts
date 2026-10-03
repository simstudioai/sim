import { v2DownloadFileVersionContract } from '@/lib/api/contracts/v2/file-versions'
import { defineV2BinaryRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2FileErrorPolicies } from '@/lib/workspace-files/api'
import { downloadWorkspaceFileVersion } from '@/lib/workspace-files/application/file-versions'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { encodeFilenameForHeader } from '@/app/api/files/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/v2/files/[fileId]/versions/[version]/content — Download one version's bytes.
 *
 * Served exactly as `GET /api/v2/files/[fileId]` serves the current bytes: ordinary files stream,
 * and a generated document resolves to its rendered artifact (`CONFLICT` while it compiles).
 *
 * `headSafe: false` because downloading records a `FILE_DOWNLOADED` audit event.
 */
export const GET = defineV2BinaryRoute({
  contract: v2DownloadFileVersionContract,
  auth: v2ApiKeyAuth,
  headSafe: false,
  operation: fileOperations.downloadVersion,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2FileErrorPolicies.concealResourceAuthorization,
  mapInput: ({ params, query }) => ({
    fileId: params.fileId,
    assertedWorkspaceId: query.workspaceId,
    version: params.version,
  }),
  useCase: downloadWorkspaceFileVersion,
  present: ({ file, stream, contentType, contentLength }) => ({
    body: stream,
    contentType,
    contentDisposition: `attachment; ${encodeFilenameForHeader(file.name)}`,
    contentLength,
  }),
})
