import type { V2FileUpload } from '@/lib/api/contracts/v2/files'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { presentUploadSessionState } from '@/lib/uploads/upload-session/presenter'
import type { UploadSessionRecord } from '@/lib/uploads/upload-session/service'
import { toV2File } from '@/app/api/v2/files/utils'

export async function toV2FileUpload(
  session: UploadSessionRecord,
  file: WorkspaceFileRecord | null
): Promise<V2FileUpload> {
  return {
    ...presentUploadSessionState(session),
    file: file ? await toV2File(file) : null,
  }
}
