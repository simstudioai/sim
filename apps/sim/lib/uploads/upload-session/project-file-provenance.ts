import { isRecordLike } from '@sim/utils/object'
import type { WorkspaceFileSecretProvenance } from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import {
  parseWorkspaceFileSecretProvenance,
  type WorkspaceFileUploadSource,
} from '@/lib/uploads/upload-session/workspace-file-provenance'

export const PROJECT_FILE_UPLOAD_PROVENANCE_KEY = 'projectFileSecretProvenance'

/** Classification is bound to the shared owner and sealed once when completion claims its lease. */
export function bindProjectFileUploadProvenance(
  projectId: string,
  source: WorkspaceFileUploadSource
) {
  return {
    version: 1,
    projectId,
    provenance:
      source === 'pending'
        ? { status: 'unknown' as const }
        : parseWorkspaceFileSecretProvenance(source),
    ...(source === 'pending' ? { pending: true } : {}),
  }
}

/** Malformed or missing Project classification remains unknown, never an implicit clean upload. */
export function readProjectFileUploadProvenance(
  metadata: Record<string, unknown>,
  projectId: string
): WorkspaceFileSecretProvenance {
  const binding = metadata[PROJECT_FILE_UPLOAD_PROVENANCE_KEY]
  if (
    !isRecordLike(binding) ||
    binding.version !== 1 ||
    binding.projectId !== projectId ||
    Object.hasOwn(binding, 'pending')
  )
    return { status: 'unknown' }
  return parseWorkspaceFileSecretProvenance(binding.provenance)
}
