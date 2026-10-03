import { canonicalWorkspaceFilePath } from '@/lib/mothership/vfs/path-utils'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { extractEmbeddedFileRef } from '@/lib/uploads/utils/embedded-image-ref'

/**
 * Resolve the workspace file a canonical VFS path points at (`files/docs/a.md`).
 * The path is rebuilt per candidate with the same helper the VFS serves, so a
 * caller cannot drift from the encoding the agent's tags use.
 */
export function findWorkspaceFileByPath(
  records: readonly WorkspaceFileRecord[] | undefined,
  path: string | undefined
): WorkspaceFileRecord | undefined {
  if (!path || !records) return undefined
  return records.find(
    (record) =>
      canonicalWorkspaceFilePath({ folderPath: record.folderPath, name: record.name }) === path
  )
}

/**
 * Resolve the workspace file record an embedded image `src` points at, matching the persisted serve-URL
 * shape by storage key or file id. Returns `undefined` for external / `data:` / unrecognized srcs, and
 * when the file list isn't loaded — callers then fall back to on-load measurement rather than reserving
 * from metadata.
 */
export function findWorkspaceFileBySrc(
  records: WorkspaceFileRecord[] | undefined,
  src: string | undefined
): WorkspaceFileRecord | undefined {
  const ref = src ? extractEmbeddedFileRef(src) : null
  if (!ref || !records) return undefined
  return 'key' in ref
    ? records.find((record) => record.key === ref.key)
    : records.find((record) => record.id === ref.fileId)
}
