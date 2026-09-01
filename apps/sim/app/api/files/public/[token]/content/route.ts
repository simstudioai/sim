import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { getPublicFileContentContract } from '@/lib/api/contracts/public-shares'
import { parseRequest } from '@/lib/api/server'
import { resolveServableDoc } from '@/lib/copilot/tools/server/files/doc-compile'
import { validateDeploymentAuth } from '@/lib/core/security/deployment-auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { assertKnownSizeWithinLimit } from '@/lib/core/utils/stream-limits'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { enforcePublicFileRateLimit } from '@/lib/public-shares/rate-limit'
import { resolveActiveShareByToken } from '@/lib/public-shares/share-manager'
import { downloadFile } from '@/lib/uploads/core/storage-service'
import { resolveServableImageBytes } from '@/lib/uploads/server/image-derivative'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import { isSimPageSource, SIM_PAGE_CONTENT_TYPE } from '@/lib/workspace-files/page-compile'
import { renderSimPageDocumentWithAssets } from '@/lib/workspace-files/page-document.server'
import {
  createErrorResponse,
  createFileResponse,
  FileNotFoundError,
  getContentType,
} from '@/app/api/files/utils'

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
 * pass through untouched, except under `preview=1`, where a format no browser
 * decodes is substituted with a renderable derivative. A generated doc whose
 * compiled artifact isn't built yet returns 409 rather than serving raw source
 * under a binary content type.
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
      const preview = parsed.data.query.preview === '1'

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
      // The same ceiling the authenticated serve route reads this object under
      // (`fetchWorkspaceFileBuffer`). Without it a share link is the one way to ask
      // an unauthenticated caller's request to hold a 5 GB workspace file resident.
      const raw = await downloadFile({
        key: file.key,
        context: 'workspace',
        maxBytes: MAX_BUFFERED_TRANSFER_BYTES,
      })

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

      // This response is `nosniff`, so a stored `application/octet-stream` refuses to render
      // even though the bytes are fine. Resolving from the filename also keeps this route on
      // the same inline allowlist as the workspace serve route.
      let buffer = raw
      let contentType = getContentType(file.originalName)
      if (servable.kind === 'artifact') {
        buffer = servable.buffer
        contentType = servable.contentType
      } else if (
        // Sim pages store an extensionless name — the record type marks them;
        // legacy pages still carry .html.
        (file.contentType === SIM_PAGE_CONTENT_TYPE ||
          file.originalName.toLowerCase().endsWith('.html')) &&
        isSimPageSource(raw.toString('utf8'))
      ) {
        // The pdf model for pages: the stored .html is source; a share serves
        // the fully styled compiled document, matching the preview and serve
        // routes. sim: links resolve to workspace routes (a viewer without
        // workspace access simply lands on the sign-in gate).
        buffer = Buffer.from(
          await renderSimPageDocumentWithAssets(raw.toString('utf8'), {
            workspaceId: file.workspaceId ?? undefined,
          }),
          'utf8'
        )
        contentType = 'text/html'
      } else if (preview) {
        // Only for a render request: the Download button omits `preview`, so a saved
        // file is always the bytes that were shared.
        const image = await resolveServableImageBytes(raw, file.key)
        if (image) ({ buffer, contentType } = image)
      }

      // Bounding the source read does not bound the response: each branch above can
      // replace it with bytes fetched or produced separately — a compiled artifact, a
      // page with its images inlined, a transcoded derivative. This is an anonymous
      // route, so the bytes it actually returns are what has to fit.
      assertKnownSizeWithinLimit(buffer.length, MAX_BUFFERED_TRANSFER_BYTES, 'served file render')

      logger.info('Public shared file served', { token, key: file.key, size: buffer.length })

      // Anonymous access: null actor (owner-as-actor would misread as a self-download).
      recordAudit({
        workspaceId: file.workspaceId ?? null,
        actorId: null,
        action: AuditAction.FILE_DOWNLOADED,
        resourceType: AuditResourceType.FILE,
        resourceId: file.id,
        resourceName: file.originalName,
        description: `Public share download of "${file.originalName}"`,
        metadata: {
          access: 'public_share',
          anonymous: true,
          sharedByUserId: file.userId,
          fileName: file.originalName,
          bytes: buffer.length,
        },
        request,
      })

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
