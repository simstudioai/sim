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
 * How long the browser may reuse an embedded image, decided by whether the URL names the exact object
 * that was streamed (see {@link ReadWorkspaceInlineFileResult.contentAddressed}).
 *
 * A content write never rewrites a storage object, so a URL that names one addresses bytes that can
 * never change and the browser needs no round trip — which is the difference between an embedded image
 * reappearing instantly and being downloaded again. Every document render asks for the same image at
 * least twice (ProseMirror's own DOM, then the React node view) and every editor mounts twice (the
 * read-only placeholder, then the live editor), so revalidating each time meant re-fetching the whole
 * image on every open and reload — measured at ~1 MB per open on a real document, with the image area
 * blank until it landed. `private` keeps it out of shared caches: the bytes are authorized per user.
 *
 * Anything else — a request that names the FILE, whose bytes move under it, or one whose object was
 * rotated away mid-request — keeps revalidating.
 */
const IMMUTABLE_CACHE_CONTROL = 'private, max-age=31536000, immutable'
const REVALIDATE_CACHE_CONTROL = 'private, no-cache, must-revalidate'

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
  present: ({ file, stream, contentAddressed }) => {
    const secure = getSecureFileHeaders(file.name, file.type)
    const headers = new Headers({
      'Content-Type': secure.contentType,
      'Content-Disposition': `${secure.disposition}; ${encodeFilenameForHeader(file.name)}`,
      'Cache-Control': contentAddressed ? IMMUTABLE_CACHE_CONTROL : REVALIDATE_CACHE_CONTROL,
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
