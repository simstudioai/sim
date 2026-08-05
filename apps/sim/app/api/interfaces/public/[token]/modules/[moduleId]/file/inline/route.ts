import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import { getPublicInterfaceInlineFileContract } from '@/lib/api/contracts/public-interfaces'
import { parseRequest } from '@/lib/api/server'
import {
  extractEmbeddedImageIds,
  extractEmbeddedImageKeys,
} from '@/lib/copilot/tools/server/files/embedded-image-refs'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { resolvePublicInterfaceModule } from '@/lib/public-shares/interface-access'
import { enforcePerIpRateLimit, enforcePerShareRateLimit } from '@/lib/public-shares/rate-limit'
import { getWorkspaceFile } from '@/lib/uploads/contexts/workspace'
import { downloadFile } from '@/lib/uploads/core/storage-service'
import { resolveWorkspaceInlineImage } from '@/lib/uploads/server/inline-image'
import { serveInlineImage } from '@/app/api/files/serve-inline-image'
import { FileNotFoundError } from '@/app/api/files/utils'
import { publicInterfaceNotFound } from '@/app/api/interfaces/public/[token]/modules/[moduleId]/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('PublicInterfaceInlineFileAPI')

/**
 * GET /api/interfaces/public/[token]/modules/[moduleId]/file/inline?key=|fileId=
 *
 * Cascades a shared interface's file module to the images its document embeds,
 * so a logged-out visitor sees them instead of broken icons. The share grants
 * the module's one document; this extends that grant to the document's
 * referenced images only, behind the same three gates the public file share
 * uses:
 *
 * 1. Referenced-by-doc — the requested key/id must appear in the module
 *    document's *current* bytes, re-read per request. The token is a capability
 *    for that document and its embeds, never an arbitrary workspace file.
 * 2. Same-workspace — the referenced file must be a `workspace` file in the
 *    interface's own workspace ({@link resolveWorkspaceInlineImage}), so a
 *    cross-workspace embed (which an author can write but must never resolve)
 *    cannot load.
 * 3. Content-truth — the served content type is sniffed from the bytes, not the
 *    stored type, and only genuine raster images are served.
 */
export const GET = withRouteHandler(
  async (
    request: NextRequest,
    context: { params: Promise<{ token: string; moduleId: string }> }
  ) => {
    const requestId = generateRequestId()

    const limited = await enforcePerIpRateLimit(request, 'content')
    if (limited) return limited

    const parsed = await parseRequest(getPublicInterfaceInlineFileContract, request, context)
    if (!parsed.success) return parsed.response
    const { token, moduleId } = parsed.data.params
    const ref = parsed.data.query

    const result = await resolvePublicInterfaceModule({
      token,
      moduleId,
      expectedType: 'file',
      request,
      requestId,
    })
    if (!result.ok) return result.response
    const { share, workspaceId, resource } = result.access

    /**
     * The share is only known after the token resolves, so the aggregate
     * per-share ceiling is enforced here rather than alongside the per-IP bucket
     * above. Both apply, and this one runs before the document and its embedded
     * image are pulled from storage: one page of a shared document can fan out
     * to many inline requests, so the link-level ceiling matters most here.
     */
    const shareLimited = await enforcePerShareRateLimit('content', share.id)
    if (shareLimited) return shareLimited

    /**
     * Re-assert same-workspace on the module's own document before it can grant
     * anything: `validateLayout` grandfathers references that were already
     * stored, so a stored reference is only proven in-workspace at the moment it
     * was introduced.
     */
    const doc = await getWorkspaceFile(workspaceId, resource.id)
    if (!doc) {
      logger.warn(`[${requestId}] Public interface file reference no longer resolves`, { moduleId })
      return publicInterfaceNotFound()
    }

    try {
      // Gate 1 — the share grants exactly the images the document embeds.
      const docText = (await downloadFile({ key: doc.key, context: 'workspace' })).toString('utf-8')
      const referenced = ref.fileId
        ? extractEmbeddedImageIds(docText).includes(ref.fileId)
        : extractEmbeddedImageKeys(docText).includes(ref.key as string)
      if (!referenced) return publicInterfaceNotFound()

      // Gate 2 — resolve scoped to the interface's own workspace.
      const image = await resolveWorkspaceInlineImage(workspaceId, ref)
      if (!image) return publicInterfaceNotFound()

      // Gate 3 (`sniff`) — render only genuine raster image bytes; audit after.
      const response = await serveInlineImage(image, { sniff: true })

      // Anonymous access: null actor (owner-as-actor would misread as a self-download).
      recordAudit({
        workspaceId,
        actorId: null,
        action: AuditAction.FILE_DOWNLOADED,
        resourceType: AuditResourceType.FILE,
        resourceName: image.filename,
        description: `Public interface share inline image "${image.filename}"`,
        metadata: {
          access: 'public_share',
          anonymous: true,
          inline: true,
          interfaceId: result.access.definition.id,
          moduleId,
          sharedByUserId: doc.uploadedBy,
        },
        request,
      })

      return response
    } catch (error) {
      /**
       * `serveInlineImage` rejects non-raster content with a `FileNotFoundError`;
       * it is folded into the uniform 404 so a spoofed content type is
       * indistinguishable from an unreferenced one.
       */
      if (error instanceof FileNotFoundError) return publicInterfaceNotFound()
      throw error
    }
  }
)
