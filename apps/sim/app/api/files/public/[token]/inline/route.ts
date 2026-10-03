import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { getPublicInlineFileContract } from '@/lib/api/contracts/public-shares'
import { parseRequest } from '@/lib/api/server'
import { validateDeploymentAuth } from '@/lib/core/security/deployment-auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { enforcePublicFileRateLimit } from '@/lib/public-shares/rate-limit'
import { resolveActiveShareByToken } from '@/lib/public-shares/share-manager'
import { downloadFile } from '@/lib/uploads/core/storage-service'
import { hasEmbeddedFileRef } from '@/lib/uploads/server/embedded-image-refs'
import { resolveWorkspaceInlineImage } from '@/lib/uploads/server/inline-image'
import { serveInlineImage } from '@/app/api/files/serve-inline-image'
import { createErrorResponse, FileNotFoundError } from '@/app/api/files/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('PublicInlineFileAPI')

/**
 * Ceiling on the shared document read for the referenced-by-doc gate below.
 *
 * Far tighter than the ceiling on a file this route SERVES, because these bytes are
 * never served — they are scanned for image references and discarded, and scanning
 * decodes them to UTF-16 on top of the buffer, so the resident cost is roughly double
 * the read. A share can point at any workspace file, admitted at 5 GB, and this route
 * is anonymous; nothing a person writes as a document approaches even this bound.
 */
const MAX_INLINE_REF_SCAN_BYTES = 10 * 1024 * 1024

/**
 * GET /api/files/public/[token]/inline?key=<cloudKey>|fileId=<id>
 *
 * Cascades a markdown document's public share to the images it embeds, so a logged-out viewer sees them
 * instead of broken icons. The share grants the document bytes; this route extends that grant to the
 * document's referenced images only, behind three gates that together hold the security boundary:
 *
 * 1. Referenced-by-doc — the requested key/id must be embedded as an image by the shared document's
 *    current bytes. The token is a capability for the document and its embeds, never an arbitrary
 *    workspace file, and never one the document merely links to or mentions in prose.
 * 2. Same-workspace — the referenced file must be a `workspace` file in the document's own workspace
 *    ({@link resolveWorkspaceInlineImage}). This blocks any cross-workspace reference (which an author
 *    can write but must never resolve) from loading.
 * 3. Content-truth — the served content type is sniffed from the bytes, not the client-declared type,
 *    and only genuine raster images are served. A file spoofing `image/png` while holding HTML/SVG is
 *    refused rather than rendered inline.
 */
export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ token: string }> }) => {
    const requestId = generateRequestId()

    try {
      const limited = await enforcePublicFileRateLimit(request, 'inline')
      if (limited) return limited

      const parsed = await parseRequest(getPublicInlineFileContract, request, context)
      if (!parsed.success) return parsed.response
      const { token } = parsed.data.params
      const ref = parsed.data.query

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

      const { file: doc } = resolved
      if (!doc.workspaceId) {
        throw new FileNotFoundError('Not found')
      }

      // Referenced-by-doc gate: the share grants exactly the images the document embeds.
      // A document too large to scan fails the gate like any other unverifiable
      // reference — the grant cannot be extended to an embed we were unable to confirm.
      let docText: string
      try {
        const docBuffer = await downloadFile({
          key: doc.key,
          context: 'workspace',
          maxBytes: MAX_INLINE_REF_SCAN_BYTES,
        })
        docText = docBuffer.toString('utf-8')
      } catch (error) {
        if (!isPayloadSizeLimitError(error)) throw error
        logger.info('Shared document too large to scan for embedded references', { token })
        throw new FileNotFoundError('Not found')
      }
      const target = ref.fileId ? { fileId: ref.fileId } : ref.key ? { key: ref.key } : null
      if (!target || !hasEmbeddedFileRef(docText, target)) {
        throw new FileNotFoundError('Not found')
      }

      // Same-workspace gate: resolve scoped to the document's own workspace.
      const image = await resolveWorkspaceInlineImage(doc.workspaceId, ref)
      if (!image) {
        throw new FileNotFoundError('Not found')
      }

      // Content-truth gate (`sniff`): render only genuine raster image bytes; audit after.
      const response = await serveInlineImage(image, { sniff: true })

      // Anonymous access: null actor (owner-as-actor would misread as a self-download).
      recordAudit({
        workspaceId: doc.workspaceId,
        actorId: null,
        action: AuditAction.FILE_DOWNLOADED,
        resourceType: AuditResourceType.FILE,
        resourceName: image.filename,
        description: `Public share inline image "${image.filename}"`,
        metadata: {
          access: 'public_share',
          anonymous: true,
          inline: true,
          sharedByUserId: doc.userId,
        },
        request,
      })

      return response
    } catch (error) {
      if (error instanceof FileNotFoundError) {
        return createErrorResponse(error)
      }
      logger.error('Error serving public inline image:', error)
      return createErrorResponse(error instanceof Error ? error : new Error('Failed to serve file'))
    }
  }
)
