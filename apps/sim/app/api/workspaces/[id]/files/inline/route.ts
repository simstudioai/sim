import { getInlineWorkspaceFileContract } from '@/lib/api/contracts/workspace-files'
import {
  defineInternalBinaryRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalFileErrorPolicies } from '@/lib/workspace-files/api'
import { readWorkspaceInlineFile } from '@/lib/workspace-files/application/read-workspace-inline-file'
import { encodeFilenameForHeader, getSecureFileHeaders } from '@/app/api/files/utils'

export const dynamic = 'force-dynamic'

/**
 * GET /api/workspaces/[id]/files/inline?key=<cloudKey>|fileId=<id>
 *
 * Serves an authenticated workspace-scoped image. Authentication and the
 * `files.read_content` authorization check happen before resolving or reading
 * the referenced object, preserving cross-workspace concealment.
 */
export const GET = defineInternalBinaryRoute({
  contract: getInlineWorkspaceFileContract,
  auth: internalSessionAuth,
  operation: readWorkspaceInlineFile.operation,
  rateLimit: internalRateLimits.none({ reason: 'Internal workspace inline image delivery' }),
  errorPolicy: internalFileErrorPolicies.inline,
  mapInput: ({ params, query }) => ({
    workspaceId: params.id,
    key: query.key,
    fileId: query.fileId,
  }),
  useCase: readWorkspaceInlineFile,
  present: ({ file, stream }) => {
    const secure = getSecureFileHeaders(file.name, file.type)
    const headers = new Headers({
      'Content-Type': secure.contentType,
      'Content-Disposition': `${secure.disposition}; ${encodeFilenameForHeader(file.name)}`,
      'Cache-Control': 'private, no-cache, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
    })
    if (secure.contentType === 'image/svg+xml') {
      headers.set(
        'Content-Security-Policy',
        "default-src 'none'; style-src 'unsafe-inline'; sandbox;"
      )
    }
    return {
      body: stream,
      contentType: secure.contentType,
      contentLength: file.size,
      headers,
    }
  },
})
