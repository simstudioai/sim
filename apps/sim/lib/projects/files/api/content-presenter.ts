import type { OwnedFileRecord } from '@/lib/uploads/contexts/workspace'
import { FILE_CACHE_CONTROL, presentFileDelivery } from '@/lib/uploads/server/delivery'

/** Presents authorized bytes without caching the mutable file URL. */
export function presentProjectFileContent({
  file,
  content,
}: {
  file: OwnedFileRecord
  content: Buffer
}) {
  return presentFileDelivery({
    body: content,
    filename: file.name,
    contentType: file.type,
    contentLength: content.length,
    cacheControl: FILE_CACHE_CONTROL.noStore,
  })
}
