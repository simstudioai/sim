import { createHash } from 'node:crypto'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { downloadFile, uploadFile } from '@/lib/uploads/core/storage-service'
import { isHevcHeifContainer, transcodeHeicToJpeg } from '@/lib/uploads/server/heic'
import { MAX_RENDERED_DOCUMENT_BYTES } from '@/lib/uploads/utils/file-utils'

const logger = createLogger('ImageDerivative')

/**
 * Keyed by the source's storage key rather than a hash of its bytes. Workspace keys
 * are regenerated on every content replacement, so the key is already a content
 * version — using it avoids streaming the whole original just to hash it.
 */
function derivativeKey(storageKey: string): string {
  const hash = createHash('sha256').update(storageKey, 'utf-8').digest('hex')
  return `image-derivative/${hash}.jpg`
}

/**
 * A cache miss here is recoverable, so unlike the compiled-doc store this swallows a
 * size breach too: falling through re-transcodes the original, and the transcode is
 * bounded by the source read that produced its input.
 */
async function loadDerivative(storageKey: string): Promise<Buffer | null> {
  try {
    return await downloadFile({
      key: derivativeKey(storageKey),
      context: 'copilot',
      maxBytes: MAX_RENDERED_DOCUMENT_BYTES,
    })
  } catch {
    return null
  }
}

/**
 * Stores the derivative, swallowing failure.
 *
 * Unlike the compiled-doc store — which throws, because its serve path is load-only
 * and cannot rebuild a missing artifact — a miss here is fully recoverable: the next
 * read transcodes again. Failing the request would turn a cache problem into a broken
 * image for bytes we have already rendered successfully.
 */
async function storeDerivative(storageKey: string, jpeg: Buffer): Promise<void> {
  try {
    await uploadFile({
      file: jpeg,
      fileName: 'derivative.jpg',
      contentType: 'image/jpeg',
      context: 'copilot',
      customKey: derivativeKey(storageKey),
      preserveKey: true,
    })
  } catch (error) {
    logger.warn('Failed to store image derivative', {
      storageKey,
      error: getErrorMessage(error),
    })
  }
}

/**
 * A browser-renderable form of stored image bytes, or `null` when the stored bytes
 * are already renderable and should be served untouched.
 *
 * Only HEVC-coded HEIF needs this today: no browser outside Safari decodes it, and
 * serving it under `X-Content-Type-Options: nosniff` guarantees a broken image.
 * AV1-coded HEIF (`.avif`) renders natively everywhere and is left alone — probing
 * it would cost a decode that can only fail. The transcoded JPEG is cached, because
 * a preview is re-fetched on every view and the WebAssembly decode costs roughly a
 * second for a phone photo.
 *
 * The original always remains the stored object — this runs only for `preview=1`
 * requests, so it never rewrites what a download hands back.
 */
export async function resolveServableImageBytes(
  buffer: Buffer,
  storageKey: string
): Promise<{ buffer: Buffer; contentType: string } | null> {
  if (!isHevcHeifContainer(buffer)) return null

  const cached = await loadDerivative(storageKey)
  if (cached) return { buffer: cached, contentType: 'image/jpeg' }

  const jpeg = await transcodeHeicToJpeg(buffer)
  if (!jpeg) return null

  await storeDerivative(storageKey, jpeg)
  return { buffer: jpeg, contentType: 'image/jpeg' }
}
