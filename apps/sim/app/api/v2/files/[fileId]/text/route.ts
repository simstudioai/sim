import { v2ReadFileTextContract } from '@/lib/api/contracts/v2/files'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2FileErrorPolicies } from '@/lib/workspace-files/api'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { readWorkspaceFileText } from '@/lib/workspace-files/application/read-workspace-file-text'

export const dynamic = 'force-dynamic'

/**
 * GET /api/v2/files/[fileId]/text — extract a file's text.
 *
 * Runs on the existing `files.read_content` operation: extracting text reads
 * exactly the bytes that operation already authorizes.
 *
 * `degraded: true` means extraction did not fully succeed and the returned
 * text may be incomplete or synthesized from raw bytes. The legacy `doc` and
 * `ppt` parsers deliberately return best-effort content instead of throwing,
 * so the flag — not an error — is how that is reported.
 *
 * `offset` and `limit` narrow the response to a line window, reported back as
 * `lineRange`. `totalLines` there is what separates a file that ended from a
 * window that stopped early, so a caller can tell whether to read further.
 *
 * Head-safe: no audit is projected and nothing is written. The read does pull
 * bytes from object storage, but so does the metadata read beside it, and a
 * bodiless `HEAD` would answer no useful question here.
 */
export const GET = defineV2JsonRoute({
  contract: v2ReadFileTextContract,
  auth: v2ApiKeyAuth,
  operation: fileOperations.readContent,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2FileErrorPolicies.concealResourceAuthorization,
  mapInput: ({ params, query }) => ({
    fileId: params.fileId,
    assertedWorkspaceId: query.workspaceId,
    maxBytes: query.maxBytes,
    offset: query.offset,
    limit: query.limit,
  }),
  useCase: readWorkspaceFileText,
  present: ({ file, text, truncated, degraded, degradedReason, byteCount, lineRange }) => ({
    data: {
      fileId: file.id,
      name: file.name,
      type: file.type,
      text,
      truncated,
      degraded,
      degradedReason,
      charCount: text.length,
      byteCount,
      ...(lineRange ? { lineRange } : {}),
    },
  }),
})
