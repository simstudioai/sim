import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import { getPublicInterfaceFileContentContract } from '@/lib/api/contracts/public-interfaces'
import { parseRequest } from '@/lib/api/server'
import { resolveServableDoc } from '@/lib/copilot/tools/server/files/doc-compile'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { resolvePublicInterfaceModule } from '@/lib/public-shares/interface-access'
import { enforcePerIpRateLimit, enforcePerShareRateLimit } from '@/lib/public-shares/rate-limit'
import { getWorkspaceFile } from '@/lib/uploads/contexts/workspace'
import { downloadFile, downloadFileStream, headObject } from '@/lib/uploads/core/storage-service'
import { isMediaContentType } from '@/lib/uploads/utils/byte-range'
import { createByteRangeResponse, createFileResponse } from '@/app/api/files/utils'
import {
  PUBLIC_INTERFACE_CACHE_CONTROL,
  publicInterfaceJson,
  publicInterfaceNotFound,
} from '@/app/api/interfaces/public/[token]/modules/[moduleId]/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('PublicInterfaceFileContentAPI')

/**
 * GET /api/interfaces/public/[token]/modules/[moduleId]/file/content
 *
 * Bytes of the one file a shared interface's file module points at. The file id
 * is **derived** from the interface's stored layout — the route accepts no file
 * identifier — and {@link getWorkspaceFile} then re-asserts that the file is a
 * live `workspace` file in the interface's own workspace.
 *
 * Generated office docs are stored as source; {@link resolveServableDoc} swaps
 * in their prebuilt compiled binary (read-only, never compiles). A generated doc
 * whose compiled artifact isn't built yet returns 409 rather than serving raw
 * source under a binary content type.
 */
export const GET = withRouteHandler(
  async (
    request: NextRequest,
    context: { params: Promise<{ token: string; moduleId: string }> }
  ) => {
    const requestId = generateRequestId()

    const limited = await enforcePerIpRateLimit(request, 'content')
    if (limited) return limited

    const parsed = await parseRequest(getPublicInterfaceFileContentContract, request, context)
    if (!parsed.success) return parsed.response
    const { token, moduleId } = parsed.data.params

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
     * above. Both apply, and this one runs before a single byte of S3 egress is
     * spent: the per-IP bucket bounds one visitor, this one bounds a link that
     * has been passed around.
     */
    const shareLimited = await enforcePerShareRateLimit('content', share.id)
    if (shareLimited) return shareLimited

    /**
     * Re-assert same-workspace on the resolved resource. `validateLayout`
     * grandfathers references that were already stored, so a stored reference is
     * only proven in-workspace at the moment it was introduced.
     * `getWorkspaceFile` applies all three predicates the check needs — same
     * workspace, `context = 'workspace'`, not soft-deleted.
     */
    const file = await getWorkspaceFile(workspaceId, resource.id)
    if (!file) {
      logger.warn(`[${requestId}] Public interface file reference no longer resolves`, { moduleId })
      return publicInterfaceNotFound()
    }

    /**
     * Media is byte-served so a shared video or track is seekable and never
     * resident in memory on either side. Decided before the download, because
     * the buffered path below exists for the generated-document swap, which no
     * media file can be subject to.
     */
    if (isMediaContentType(file.type)) {
      const head = await headObject(file.key, 'workspace')
      if (!head) return publicInterfaceNotFound()

      const rangeHeader = request.headers.get('range')

      logger.info(`[${requestId}] Public interface media served`, { moduleId, size: head.size })

      /**
       * One audit row per playback, not per seek: a player issues many ranged
       * requests for a single view, so only the opening fetch is recorded.
       * Without this a shared document download was audited while a shared video
       * playback was not — the same access, through the same token, invisible.
       */
      if (!rangeHeader || rangeHeader.startsWith('bytes=0-')) {
        recordAudit({
          workspaceId,
          actorId: null,
          action: AuditAction.FILE_DOWNLOADED,
          resourceType: AuditResourceType.FILE,
          resourceId: file.id,
          resourceName: file.name,
          description: `Public interface share playback of "${file.name}"`,
          metadata: {
            access: 'public_share',
            anonymous: true,
            interfaceId: result.access.definition.id,
            moduleId,
            sharedByUserId: file.uploadedBy,
            fileName: file.name,
            bytes: head.size,
          },
          request,
        })
      }

      return await createByteRangeResponse({
        openStream: (range) => downloadFileStream({ key: file.key, context: 'workspace', range }),
        size: head.size,
        contentType: file.type,
        filename: file.name,
        cacheControl: PUBLIC_INTERFACE_CACHE_CONTROL,
        rangeHeader,
      })
    }

    const raw = await downloadFile({ key: file.key, context: 'workspace' })
    const servable = await resolveServableDoc(workspaceId, raw, file.name)

    if (servable.kind === 'unavailable') {
      logger.info(`[${requestId}] Public interface doc not yet compiled`, { moduleId })
      return publicInterfaceJson(
        { error: 'This document is still being prepared. Please try again shortly.' },
        409
      )
    }

    const buffer = servable.kind === 'artifact' ? servable.buffer : raw
    const contentType = servable.kind === 'artifact' ? servable.contentType : file.type

    logger.info(`[${requestId}] Public interface file served`, {
      moduleId,
      size: buffer.length,
    })

    // Anonymous access: null actor (owner-as-actor would misread as a self-download).
    recordAudit({
      workspaceId,
      actorId: null,
      action: AuditAction.FILE_DOWNLOADED,
      resourceType: AuditResourceType.FILE,
      resourceId: file.id,
      resourceName: file.name,
      description: `Public interface share download of "${file.name}"`,
      metadata: {
        access: 'public_share',
        anonymous: true,
        interfaceId: result.access.definition.id,
        moduleId,
        sharedByUserId: file.uploadedBy,
        fileName: file.name,
        bytes: buffer.length,
      },
      request,
    })

    // Revalidate every request: the module can be re-pointed, the share disabled,
    // or the file replaced, so the fixed token URL must never serve stale bytes.
    return createFileResponse({
      buffer,
      contentType,
      filename: file.name,
      cacheControl: PUBLIC_INTERFACE_CACHE_CONTROL,
    })
  }
)
