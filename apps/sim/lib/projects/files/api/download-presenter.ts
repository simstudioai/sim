import { FILE_CACHE_CONTROL, presentFileDelivery } from '@/lib/uploads/server/delivery'

/** Serves the authorized archive through a buffer view, without cloning its bounded payload. */
export function presentProjectFileDownload(result: {
  buffer: Buffer
  fileName: string
  contentType: string
}) {
  return presentFileDelivery({
    body: result.buffer,
    filename: result.fileName,
    contentType: result.contentType,
    contentLength: result.buffer.length,
    attachment: true,
    cacheControl: FILE_CACHE_CONTROL.noStore,
  })
}
