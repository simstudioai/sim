import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { getPublicInlineFileContract } from '@/lib/api/contracts/public-shares'
import { parseRequest } from '@/lib/api/server'
import {
  extractEmbeddedImageIds,
  extractEmbeddedImageKeys,
} from '@/lib/copilot/tools/server/files/embedded-image-refs'
import { validateDeploymentAuth } from '@/lib/core/security/deployment-auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { enforcePublicFileRateLimit } from '@/lib/public-shares/rate-limit'
import { resolveActiveShareByToken } from '@/lib/public-shares/share-manager'
import { downloadFile } from '@/lib/uploads/core/storage-service'
import { resolveWorkspaceInlineImage } from '@/lib/uploads/server/inline-image'
import { serveInlineImage } from '@/app/api/files/serve-inline-image'
import { createErrorResponse, FileNotFoundError } from '@/app/api/files/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('PublicInlineFileAPI')

/**
 * GET /api/files/public/[token]/inline?key=<cloudKey>|fileId=<id>
 *
 * Cascades a markdown document's public share to the images it embeds, so a logged-out viewer sees them
 * instead of broken icons. The share grants the document bytes; this route extends that grant to the
 * document's referenced images only, behind three gates that together hold the security boundary:
 *
 * 1. Referenced-by-doc — the requested key/id must appear in the shared document's current bytes. The
 *    token is a capability for the document and its embeds, never an arbitrary workspace file.
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
      const limited = await enforcePublicFileRateLimit(request, 'content')
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
      const docText = (await downloadFile({ key: doc.key, context: 'workspace' })).toString('utf-8')
      const referenced = ref.fileId
        ? extractEmbeddedImageIds(docText).includes(ref.fileId)
        : extractEmbeddedImageKeys(docText).includes(ref.key as string)
      if (!referenced) {
        throw new FileNotFoundError('Not found')
      }

      // Same-workspace gate: resolve scoped to the document's own workspace.
      const image = await resolveWorkspaceInlineImage(doc.workspaceId, ref)
      if (!image) {
        throw new FileNotFoundError('Not found')
      }

      // Content-truth gate (`sniff`): render only genuine raster image bytes; audit after.
      const response = await serveInlineImage(image, { sniff: true })

      // Anonymous external access: null actor FK (not the owner), share owner in
      // metadata, ip/user-agent carry the trail.
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
