import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { getPublicFileContentContract } from '@/lib/api/contracts/public-shares'
import { parseRequest } from '@/lib/api/server'
import { resolveServableDoc } from '@/lib/copilot/tools/server/files/doc-compile'
import { validateDeploymentAuth } from '@/lib/core/security/deployment-auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { enforcePerIpRateLimit, enforcePerShareRateLimit } from '@/lib/public-shares/rate-limit'
import { resolveActiveShareByToken } from '@/lib/public-shares/share-manager'
import { downloadFile, downloadFileStream, headObject } from '@/lib/uploads/core/storage-service'
import { resolveServableImageBytes } from '@/lib/uploads/server/image-derivative'
import { isMediaContentType, isReadStart } from '@/lib/uploads/utils/byte-range'
import {
  createByteRangeResponse,
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
      const limited = await enforcePerIpRateLimit(request, 'content')
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
      const rangeHeader = request.headers.get('range')

      /**
       * Whether this file is byte-served. Classified from the filename as well
       * as the stored type, matching how the workspace serve path decides
       * (`getContentType(displayName)`): uploads frequently land as
       * `application/octet-stream`, and keying only off `file.contentType` meant
       * a shared `.mp4` silently lost `Accept-Ranges` while the very same file
       * stayed seekable inside the workspace.
       */
      const isMedia =
        isMediaContentType(file.contentType) ||
        isMediaContentType(getContentType(file.originalName))

      /**
       * The share is only known after the token resolves, so the aggregate
       * per-share ceiling is enforced here rather than alongside the per-IP
       * bucket above, and after the auth gate so a caller holding the token but
       * failing the gate cannot drain the ceiling for everyone else. Both apply,
       * and this runs before any S3 egress is spent.
       *
       * A seek within an in-progress playback is charged nothing: the ceiling is
       * shared by every visitor to the link, so counting each of a player's range
       * requests would let one person scrubbing a video 429 everyone else.
       *
       * That exemption is scoped to responses that actually honour `Range`.
       * Every other path ignores the header and returns the whole body, so
       * reading the predicate unconditionally let `Range: bytes=1-` on any
       * non-media file collect the full download for free.
       */
      if (!isMedia || isReadStart(rangeHeader)) {
        const shareLimited = await enforcePerShareRateLimit('content', resolved.share.id)
        if (shareLimited) return shareLimited
      }

      /**
       * Media is byte-served so a shared video or track is seekable and never
       * resident in memory on either side. Taken before the download because
       * the buffered path below exists for the generated-document swap, which
       * no media file can be subject to.
       */
      if (isMedia) {
        const head = await headObject(file.key, 'workspace')
        if (!head) throw new FileNotFoundError('Not found')

        logger.info('Public shared media served', {
          shareId: resolved.share.id,
          key: file.key,
          ranged: rangeHeader !== null,
        })

        /**
         * One audit row per playback, not per seek. A player issues many range
         * requests for one view; only the opening fetch (no range, or one
         * starting at byte 0) is recorded, so the trail still shows every access
         * without a row for each scrub.
         */
        if (isReadStart(rangeHeader)) {
          recordAudit({
            workspaceId: file.workspaceId ?? null,
            actorId: null,
            action: AuditAction.FILE_DOWNLOADED,
            resourceType: AuditResourceType.FILE,
            resourceId: file.id,
            resourceName: file.originalName,
            description: `Public share playback of "${file.originalName}"`,
            metadata: {
              access: 'public_share',
              anonymous: true,
              sharedByUserId: file.userId,
              fileName: file.originalName,
              bytes: head.size,
            },
            request,
          })
        }

        return await createByteRangeResponse({
          openStream: (range) => downloadFileStream({ key: file.key, context: 'workspace', range }),
          size: head.size,
          contentType: file.contentType,
          filename: file.originalName,
          cacheControl: 'private, no-cache, must-revalidate',
          rangeHeader,
        })
      }

      const raw = await downloadFile({ key: file.key, context: 'workspace' })

      const servable = file.workspaceId
        ? await resolveServableDoc(file.workspaceId, raw, file.originalName)
        : ({ kind: 'passthrough' } as const)

      if (servable.kind === 'unavailable') {
        logger.info('Public shared doc not yet compiled', {
          shareId: resolved.share.id,
          key: file.key,
        })
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
      } else if (preview) {
        // Only for a render request: the Download button omits `preview`, so a saved
        // file is always the bytes that were shared.
        const image = await resolveServableImageBytes(raw, file.key)
        if (image) ({ buffer, contentType } = image)
      }

      logger.info('Public shared file served', {
        shareId: resolved.share.id,
        key: file.key,
        size: buffer.length,
      })

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
