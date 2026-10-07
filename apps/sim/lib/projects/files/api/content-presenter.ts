import type { OwnedFileRecord } from '@/lib/uploads/contexts/workspace'
import {
  bufferedRepresentationEtag,
  FILE_CACHE_CONTROL,
  presentFileDelivery,
} from '@/lib/uploads/server/delivery'

/** Presents authorized bytes with a representation validator independent of optimistic write revisions. */
export function presentProjectFileContent({
  file,
  content,
}: {
  file: OwnedFileRecord
  content: Buffer
}) {
  const result = presentFileDelivery({
    body: content,
    filename: file.name,
    contentType: file.type,
    contentLength: content.length,
    cacheControl: FILE_CACHE_CONTROL.noStore,
  })
  result.headers.set('ETag', bufferedRepresentationEtag(content))
  return result
}
