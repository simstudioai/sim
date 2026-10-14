import type { OwnedFileRecord } from '@/lib/uploads/contexts/workspace'
import type { WorkspaceFileVersionRecord } from '@/lib/uploads/contexts/workspace/workspace-file-versions'
import { FILE_CACHE_CONTROL, presentFileDelivery } from '@/lib/uploads/server/delivery'
/** Historical source bytes use the selected version's type rather than the current head's type. */
export function presentProjectFileVersionContent({
  file,
  version,
  content,
}: {
  file: OwnedFileRecord
  version: WorkspaceFileVersionRecord
  content: Buffer
}) {
  return presentFileDelivery({
    body: content,
    filename: file.name,
    contentType: version.contentType,
    contentLength: content.length,
    attachment: true,
    cacheControl: FILE_CACHE_CONTROL.noStore,
  })
}
