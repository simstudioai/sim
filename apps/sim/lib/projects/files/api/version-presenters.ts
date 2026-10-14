import type { OwnedFileRecord } from '@/lib/uploads/contexts/workspace'
import type { WorkspaceFileVersionRecord } from '@/lib/uploads/contexts/workspace/file-version-store'
import { FILE_CACHE_CONTROL, presentFileDelivery } from '@/lib/uploads/server/delivery'
/** Historical source bytes use the selected version's type rather than the current head's type. */
export function presentProjectFileVersionContent({
  file,
  version,
  stream,
  contentLength,
}: {
  file: OwnedFileRecord
  version: WorkspaceFileVersionRecord
  stream: ReadableStream<Uint8Array>
  contentLength: number
}) {
  return presentFileDelivery({
    body: stream,
    filename: file.name,
    contentType: version.contentType,
    contentLength,
    attachment: true,
    cacheControl: FILE_CACHE_CONTROL.noStore,
  })
}
