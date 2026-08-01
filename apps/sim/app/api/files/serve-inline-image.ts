import { createLogger } from '@sim/logger'
import type { NextResponse } from 'next/server'
import { downloadFile } from '@/lib/uploads/core/storage-service'
import type { ResolvedInlineImage } from '@/lib/uploads/server/inline-image'
import { sniffImageContentType } from '@/lib/uploads/utils/validation'
import { createFileResponse, FileNotFoundError } from '@/app/api/files/utils'

const logger = createLogger('InlineImageServe')

/**
 * A `fileId=` embed (or a shared/revocable audience) must never serve stale bytes from its fixed inline
 * URL, so it revalidates on each request. See `immutable` below for the cacheable case.
 */
const INLINE_CACHE_CONTROL = 'private, no-cache, must-revalidate'

/**
 * A `key=` embed addresses a CONTENT-ADDRESSED, immutable storage key (a re-upload mints a new key), so
 * its bytes never change — safe to cache hard in the (private) browser cache, avoiding a re-download of
 * every embedded image on each doc re-open/re-render. NEVER use this for the public-share route (a share
 * can be revoked) or a `fileId=` embed (the underlying key can change under a stable fileId).
 */
const INLINE_IMMUTABLE_CACHE_CONTROL = 'private, max-age=31536000, immutable'

/**
 * Download and respond with an already-workspace-scoped inline image — the single serving tail for both
 * the in-app and public inline routes. When `sniff` is set (public shares, a less-trusted audience), the
 * served content type is derived from the bytes and non-raster content is refused with 404; otherwise the
 * stored content type is served, matching the in-app serve route. `immutable` opts a content-addressed
 * (`key=`) in-app embed into a long private cache; leave it false for `fileId=` embeds and public shares.
 */
export async function serveInlineImage(
  image: ResolvedInlineImage,
  { sniff, immutable = false }: { sniff: boolean; immutable?: boolean }
): Promise<NextResponse> {
  const buffer = await downloadFile({ key: image.key, context: 'workspace' })

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
    cacheControl: immutable ? INLINE_IMMUTABLE_CACHE_CONTROL : INLINE_CACHE_CONTROL,
  })
}
