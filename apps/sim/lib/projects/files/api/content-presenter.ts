import type { OwnedFileRecord } from '@/lib/uploads/contexts/workspace'
import { FILE_CACHE_CONTROL, presentFileDelivery } from '@/lib/uploads/server/delivery'

/** Presents authorized bytes without caching the mutable file URL. */
export function presentProjectFileContent(
  result: { file: OwnedFileRecord } & (
    | { stream: ReadableStream<Uint8Array>; contentLength: number }
    | { content: Buffer }
  )
) {
  const { file } = result
  const body = 'content' in result ? result.content : result.stream
  const contentLength = 'content' in result ? result.content.byteLength : result.contentLength
  return presentFileDelivery({
    body,
    filename: file.name,
    contentType: file.type,
    contentLength,
    cacheControl: FILE_CACHE_CONTROL.noStore,
  })
}
