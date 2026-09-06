import type { WorkspaceFileSecretProvenanceEntry } from '@sim/db/schema'
import { normalizeDurableSecretProvenanceEntries } from '@/lib/execution/durable-secret-provenance'
import type { WorkspaceFileSecretProvenance } from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'

export const WORKSPACE_FILE_UPLOAD_PROVENANCE_KEY = 'workspaceFileSecretProvenance'

interface WorkspaceFileUploadProvenance {
  version: 1
  workspaceId: string
  provenance: WorkspaceFileSecretProvenance
  pending?: true
}

export type WorkspaceFileUploadSource = WorkspaceFileSecretProvenance | 'pending'

/** A streamed source starts unknown and is sealed by the host when it claims completion. */
export function bindWorkspaceFileUploadProvenance(
  workspaceId: string,
  provenance: WorkspaceFileUploadSource
): WorkspaceFileUploadProvenance {
  if (provenance === 'pending') {
    return { version: 1, workspaceId, provenance: { status: 'unknown' }, pending: true }
  }
  return { version: 1, workspaceId, provenance: parseProvenance(provenance) }
}

/** Absence preserves ordinary uploads; a malformed private binding never becomes exact-empty. */
export function readWorkspaceFileUploadProvenance(session: {
  workspaceId: string | null
  metadata: Record<string, unknown>
}): WorkspaceFileSecretProvenance | undefined {
  if (!Object.hasOwn(session.metadata, WORKSPACE_FILE_UPLOAD_PROVENANCE_KEY)) return undefined
  const binding = session.metadata[WORKSPACE_FILE_UPLOAD_PROVENANCE_KEY]
  if (
    !binding ||
    typeof binding !== 'object' ||
    !('version' in binding) ||
    binding.version !== 1 ||
    !('workspaceId' in binding) ||
    !session.workspaceId ||
    binding.workspaceId !== session.workspaceId ||
    !('provenance' in binding)
  )
    return { status: 'unknown' }
  if ('pending' in binding) return { status: 'unknown' }
  return parseProvenance(binding.provenance)
}

function parseProvenance(value: unknown): WorkspaceFileSecretProvenance {
  if (!value || typeof value !== 'object' || !('status' in value)) return { status: 'unknown' }
  if (value.status === 'unknown' || value.status === 'unrecorded') return { status: value.status }
  if (value.status !== 'exact' || !('entries' in value)) return { status: 'unknown' }
  const normalized = normalizeDurableSecretProvenanceEntries(value.entries)
  if (!normalized) return { status: 'unknown' }
  const entries: WorkspaceFileSecretProvenanceEntry[] = []
  for (const entry of normalized) {
    if (!entry.sourceUserId) return { status: 'unknown' }
    entries.push({ ...entry, sourceUserId: entry.sourceUserId })
  }
  return { status: 'exact', entries }
}
