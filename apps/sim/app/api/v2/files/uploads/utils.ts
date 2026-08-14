import type { V2FileUpload } from '@/lib/api/contracts/v2/files'
import type { V2UploadStatus } from '@/lib/api/contracts/v2/uploads'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import type { UploadSessionRecord } from '@/lib/uploads/upload-session/service'
import { toV2File } from '@/app/api/v2/files/utils'

export async function toV2FileUpload(
  session: UploadSessionRecord,
  file: WorkspaceFileRecord | null
): Promise<V2FileUpload> {
  return {
    id: session.id,
    status: uploadStatus(session.status),
    name: session.fileName,
    contentType: session.contentType,
    size: session.fileSize,
    expiresAt: session.expiresAt.toISOString(),
    error: session.error,
    file: file ? await toV2File(file) : null,
  }
}

function uploadStatus(status: string): V2UploadStatus {
  if (
    status !== 'uploading' &&
    status !== 'completing' &&
    status !== 'finalizing' &&
    status !== 'completed' &&
    status !== 'failed' &&
    status !== 'aborting' &&
    status !== 'aborted' &&
    status !== 'expired'
  ) {
    throw new Error(`Invalid upload session status: ${status}`)
  }
  return status
}
