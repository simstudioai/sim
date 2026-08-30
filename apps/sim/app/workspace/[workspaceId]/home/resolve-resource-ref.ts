import type { MothershipResource, WorkspaceResourceRef } from '@/lib/mothership/resources/types'
import { canonicalWorkspaceFilePath } from '@/lib/mothership/vfs/path-utils'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { findWorkspaceFileByPath } from '@/hooks/queries/utils/find-workspace-file-by-src'

/**
 * The one file whose name is exactly {@link name}, or undefined. Two files can
 * share a name in different folders, and opening the wrong one is worse than
 * opening none, so an ambiguous name does not resolve.
 */
function findFileByUniqueName(
  files: readonly WorkspaceFileRecord[],
  name: string
): WorkspaceFileRecord | undefined {
  if (!name) return undefined
  let match: WorkspaceFileRecord | undefined
  for (const file of files) {
    if (file.name !== name) continue
    if (match) return undefined
    match = file
  }
  return match
}

/** A file answering to `reference` as an id, as a VFS path, or by name. */
function findFileByReference(
  files: readonly WorkspaceFileRecord[],
  reference: string | undefined
): WorkspaceFileRecord | undefined {
  if (!reference) return undefined
  return (
    files.find((file) => file.id === reference) ??
    findWorkspaceFileByPath(files, reference) ??
    findFileByUniqueName(files, reference)
  )
}

/**
 * Turns a chip's best-effort reference into a resource the panel can open, or
 * null when nothing identifies it.
 *
 * A file chip's reference is lossy — the agent writes the tag by hand, and
 * rendering it as a link collapses id and path into one value — so each
 * candidate is tried against every interpretation. The match must be a file
 * this workspace actually has: an id the client's list has not caught up with
 * resolves once the caller refetches, and one that never resolves was never an
 * id. Trusting an unverified id would open a tab pointing at nothing, which is
 * the state this whole path exists to prevent.
 */
export function resolveWorkspaceResourceRef(
  ref: WorkspaceResourceRef,
  files: readonly WorkspaceFileRecord[]
): MothershipResource | null {
  const id = ref.id?.trim()
  const path = ref.path?.trim()
  if (ref.type !== 'file') {
    return id ? { type: ref.type, id, title: ref.title } : null
  }

  let match: WorkspaceFileRecord | undefined
  for (const candidate of [id, path, ref.title.trim()]) {
    match = findFileByReference(files, candidate)
    if (match) break
  }
  if (!match) return null

  return {
    type: 'file',
    id: match.id,
    title: ref.title || match.name,
    // Always the matched file's canonical path, never the reference we were
    // handed — the viewer reads this as a real path.
    path: canonicalWorkspaceFilePath({ folderPath: match.folderPath, name: match.name }),
  }
}
