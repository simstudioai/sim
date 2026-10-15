import type { ProjectFileUploadSession } from '@/lib/api/contracts/project-file-uploads'
import type { V2ProjectFileUpload } from '@/lib/api/contracts/v2/project-file-uploads'
import { toV2ProjectFile } from '@/lib/projects/files/api/presenters'
import type { OwnedFileRecord } from '@/lib/uploads/contexts/workspace'
import { presentUploadSessionState } from '@/lib/uploads/upload-session/presenter'
import type { UploadSessionRecord } from '@/lib/uploads/upload-session/service'

/** Selects public fields explicitly; session metadata contains private credential and provenance bindings. */
export function presentProjectFileUpload(
  session: UploadSessionRecord,
  file: OwnedFileRecord<{ entityType: 'project'; entityId: string }> | null
): ProjectFileUploadSession {
  return {
    ...presentUploadSessionState(session),
    purpose: 'project_file',
    result: file,
  }
}

/** The public control protocol presents canonical file paths after registration. */
export function toV2ProjectFileUpload(
  session: UploadSessionRecord,
  file: OwnedFileRecord<{ entityType: 'project'; entityId: string }> | null
): V2ProjectFileUpload {
  return { ...presentUploadSessionState(session), file: file ? toV2ProjectFile(file) : null }
}
