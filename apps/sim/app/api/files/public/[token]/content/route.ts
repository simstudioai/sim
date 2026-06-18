import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import { getPublicFileContentContract } from '@/lib/api/contracts/public-shares'
import { parseRequest } from '@/lib/api/server'
import { loadServableDocArtifact } from '@/lib/copilot/tools/server/files/doc-compile'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { enforcePublicFileRateLimit } from '@/lib/public-shares/rate-limit'
import { resolveActiveShareByToken } from '@/lib/public-shares/share-manager'
import { downloadFile } from '@/lib/uploads/core/storage-service'
import { createErrorResponse, createFileResponse, FileNotFoundError } from '@/app/api/files/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('PublicFileContentAPI')

/**
 * GET /api/files/public/[token]/content
 * Public, unauthenticated bytes for a shared file. Authorized solely by an active
 * share token — never by workspace membership. 404 for unknown/inactive/deleted
 * shares. Disposition (inline vs attachment) is resolved from the file type by
 * {@link createFileResponse}; the public page's Download button uses `<a download>`.
 *
 * Generated office docs are stored as source; {@link loadServableDocArtifact}
 * swaps in their prebuilt compiled binary (read-only, never compiles). Uploaded
 * binaries pass through untouched.
 */
export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ token: string }> }) => {
    try {
      const limited = await enforcePublicFileRateLimit(request, 'content')
      if (limited) return limited

      const parsed = await parseRequest(getPublicFileContentContract, request, context)
      if (!parsed.success) return parsed.response
      const { token } = parsed.data.params

      const resolved = await resolveActiveShareByToken(token)
      if (!resolved) {
        throw new FileNotFoundError('Not found')
      }

      const { file } = resolved
      const raw = await downloadFile({ key: file.key, context: 'workspace' })

      const artifact = file.workspaceId
        ? await loadServableDocArtifact(file.workspaceId, raw, file.originalName)
        : null
      const buffer = artifact?.buffer ?? raw
      const contentType = artifact?.contentType ?? file.contentType

      logger.info('Public shared file served', { token, key: file.key, size: buffer.length })

      return createFileResponse({ buffer, contentType, filename: file.originalName })
    } catch (error) {
      logger.error('Error serving public shared file:', error)
      if (error instanceof FileNotFoundError) {
        return createErrorResponse(error)
      }
      return createErrorResponse(error instanceof Error ? error : new Error('Failed to serve file'))
    }
  }
)
