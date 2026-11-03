import { canonicalWorkspaceFilePath } from '@/lib/mothership/vfs/path-utils'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'

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
