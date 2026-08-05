import type { V2File } from '@/lib/api/contracts/v2/files'
import { buildFolderPath } from '@/lib/folders/paths'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'

/** Shared serialization for the v2 files surface. */

/**
 * Public file projection. `workspaceId` (already known to the caller, who
 * supplied it) and the internal storage/versioning columns are not exposed.
 */
export function toV2File(record: WorkspaceFileRecord): V2File {
  const folderPath = record.folderId
    ? buildFolderPath(
        (() => {
          if (!record.folderPath) throw new Error('File references an unresolved folder')
          return record.folderPath.split('/')
        })()
      )
    : '/'

  return {
    id: record.id,
    name: record.name,
    size: record.size,
    type: record.type,
    key: record.key,
    folderPath,
    uploadedBy: record.uploadedBy,
    uploadedAt: record.uploadedAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  }
}
