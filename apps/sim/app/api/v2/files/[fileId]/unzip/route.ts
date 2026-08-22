import { v2UnzipFileContract } from '@/lib/api/contracts/v2/files'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { buildFolderPath } from '@/lib/folders/paths'
import { v2FileErrorPolicies } from '@/lib/workspace-files/api'
import { extractWorkspaceFile } from '@/lib/workspace-files/application/extract-workspace-file'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { parseWorkspaceFileFolderDisplayPath } from '@/lib/workspace-files/folder-display-path'

export const dynamic = 'force-dynamic'

/**
 * Matches the internal extract route. Unarchiving downloads the archive and
 * writes every entry, and the use case's own budget is deliberately shorter
 * than this so the work stops on its terms with rollback still able to run.
 */
export const maxDuration = 300

/**
 * POST /api/v2/files/[fileId]/unzip — unzip an archive into a new folder
 * beside it.
 *
 * Not `extract`: `GET /api/v2/files/[fileId]/text` is the endpoint that
 * extracts a file's text, and the two cannot share a verb.
 *
 * Answers counts plus the destination `folderPath` rather than the unpacked
 * files: a large archive would otherwise materialize thousands of file objects
 * into one response. Page `GET /api/v2/files?folderPath=...` for the contents.
 *
 * Slow by nature — an archive near the size ceiling can run for minutes.
 * Concurrent unarchiving of the same archive answers `409`.
 */
export const POST = defineV2JsonRoute({
  contract: v2UnzipFileContract,
  auth: v2ApiKeyAuth,
  operation: fileOperations.extractArchive,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2FileErrorPolicies.concealResourceAuthorization,
  mapInput: ({ params, body }) => ({
    fileId: params.fileId,
    assertedWorkspaceId: body.workspaceId,
  }),
  useCase: extractWorkspaceFile,
  present: (result) => ({
    data: {
      folderPath: buildFolderPath(parseWorkspaceFileFolderDisplayPath(result.folderDisplayPath)),
      extractedFileCount: result.extractedCount,
      skippedFileCount: result.skippedCount,
    },
  }),
})
