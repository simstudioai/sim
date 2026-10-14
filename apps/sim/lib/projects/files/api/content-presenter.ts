import type { OwnedFileRecord } from '@/lib/uploads/contexts/workspace'
import { FILE_CACHE_CONTROL, presentFileDelivery } from '@/lib/uploads/server/delivery'

/** Presents authorized bytes without caching the mutable file URL. */
export function presentProjectFileContent({
  file,
  stream,
  contentLength,
}: {
  file: OwnedFileRecord
  stream: ReadableStream<Uint8Array>
  contentLength: number
}) {
  return presentFileDelivery({
    body: stream,
    filename: file.name,
    contentType: file.type,
    contentLength,
    cacheControl: FILE_CACHE_CONTROL.noStore,
  })
}
