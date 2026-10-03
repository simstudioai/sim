import { createLogger } from '@sim/logger'
import type { NextResponse } from 'next/server'
import { downloadFile } from '@/lib/uploads/core/storage-service'
import type { ResolvedInlineImage } from '@/lib/uploads/server/inline-image'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import { sniffImageContentType } from '@/lib/uploads/utils/validation'
import { createFileResponse, FileNotFoundError } from '@/app/api/files/utils'

const logger = createLogger('InlineImageServe')

/**
 * An embedded image is authenticated content served from a fixed inline URL, and the file behind it can
 * be DELETED or its access REVOKED at any time — so it always revalidates, letting each request re-run the
 * server-side deletion/authorization check rather than serving a stale (possibly no-longer-authorized)
 * image from cache. Private so no shared cache/CDN ever stores it.
 */
const INLINE_CACHE_CONTROL = 'private, no-cache, must-revalidate'

/**
 * Download and respond with an already-workspace-scoped inline image — the single serving tail for both
 * the in-app and public inline routes. When `sniff` is set (public shares, a less-trusted audience), the
 * served content type is derived from the bytes and non-raster content is refused with 404; otherwise the
 * stored content type is served, matching the in-app serve route.
 */
export async function serveInlineImage(
  image: ResolvedInlineImage,
  { sniff }: { sniff: boolean }
): Promise<NextResponse> {
  const buffer = await downloadFile({
    key: image.key,
    context: 'workspace',
    maxBytes: MAX_BUFFERED_TRANSFER_BYTES,
  })

  let contentType = image.contentType
  if (sniff) {
    const sniffed = sniffImageContentType(buffer)
    if (!sniffed) {
      logger.warn('Embedded reference is not a renderable image', { key: image.key })
      throw new FileNotFoundError('Not found')
    }
    contentType = sniffed
  }

  return createFileResponse({
    buffer,
    contentType,
    filename: image.filename,
    cacheControl: INLINE_CACHE_CONTROL,
  })
}
