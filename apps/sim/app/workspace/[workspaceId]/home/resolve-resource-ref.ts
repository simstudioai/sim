import type { MothershipResource, WorkspaceResourceRef } from '@/lib/copilot/resources/types'
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

/**
 * Turns a chip's best-effort reference into a resource the panel can open, or
 * null when nothing identifies it.
 *
 * An explicit id is authoritative even when the file list has not caught up
 * with it — the id is addressable regardless of what this client has cached.
 * Everything else has to match a known file, by path first and then by a unique
 * name, because a path or a title is only an id if something answers to it.
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

  const withPath = path ? { path } : {}
  if (id) {
    const title = ref.title || files.find((file) => file.id === id)?.name || 'File'
    return { type: 'file', id, title, ...withPath }
  }

  const match =
    findWorkspaceFileByPath(files, path) ?? findFileByUniqueName(files, ref.title.trim())
  if (!match) return null
  return { type: 'file', id: match.id, title: ref.title || match.name, ...withPath }
}
