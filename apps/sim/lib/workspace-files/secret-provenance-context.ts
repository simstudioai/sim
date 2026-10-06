import type { WorkspaceFileSecretProvenanceIdentity } from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'

/** The `workspace_files.context` a loaded file record's provenance is bound under. */
export function secretProvenanceContextOf(file: {
  storageContext?: 'workspace' | 'mothership'
  vfsNamespace?: 'uploads' | 'issues'
}): WorkspaceFileSecretProvenanceIdentity['context'] {
  return file.vfsNamespace === 'issues' ? 'issue' : (file.storageContext ?? 'workspace')
}
