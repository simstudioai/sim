import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { getPublicFileContentContract } from '@/lib/api/contracts/public-shares'
import { parseRequest } from '@/lib/api/server'
import { resolveServableDoc } from '@/lib/copilot/tools/server/files/doc-compile'
import { validateDeploymentAuth } from '@/lib/core/security/deployment-auth'
import { generateRequestId } from '@/lib/core/utils/request'
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
 * Generated office docs are stored as source; {@link resolveServableDoc} swaps in
 * their prebuilt compiled binary (read-only, never compiles). Uploaded binaries
 * pass through untouched. A generated doc whose compiled artifact isn't built yet
 * returns 409 rather than serving raw source under a binary content type.
 */
export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ token: string }> }) => {
    const requestId = generateRequestId()

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

      const auth = await validateDeploymentAuth(
        requestId,
        resolved.share,
        request,
        undefined,
        'file'
      )
      if (!auth.authorized) {
        return NextResponse.json({ error: auth.error ?? 'auth_required_password' }, { status: 401 })
      }

      const { file } = resolved
      const raw = await downloadFile({ key: file.key, context: 'workspace' })

      const servable = file.workspaceId
        ? await resolveServableDoc(file.workspaceId, raw, file.originalName)
        : ({ kind: 'passthrough' } as const)

      if (servable.kind === 'unavailable') {
        logger.info('Public shared doc not yet compiled', { token, key: file.key })
        return NextResponse.json(
          { error: 'This document is still being prepared. Please try again shortly.' },
          { status: 409 }
        )
      }

      const buffer = servable.kind === 'artifact' ? servable.buffer : raw
      const contentType = servable.kind === 'artifact' ? servable.contentType : file.contentType

      logger.info('Public shared file served', { token, key: file.key, size: buffer.length })

      // Revalidate every request: a shared file can be unshared, edited, or deleted,
      // so the fixed token URL must never serve stale bytes from a long-lived cache.
      return createFileResponse({
        buffer,
        contentType,
        filename: file.originalName,
        cacheControl: 'private, no-cache, must-revalidate',
      })
    } catch (error) {
      logger.error('Error serving public shared file:', error)
      if (error instanceof FileNotFoundError) {
        return createErrorResponse(error)
      }
      return createErrorResponse(error instanceof Error ? error : new Error('Failed to serve file'))
    }
  }
)
