import type { V2File, V2FileFolder } from '@/lib/api/contracts/v2/files'
import type {
  WorkspaceFileFolderRecord,
  WorkspaceFileRecord,
} from '@/lib/uploads/contexts/workspace'

/** Shared serialization for the v2 files surface. */

/**
 * Public file projection. `workspaceId` (already known to the caller, who
 * supplied it) and the internal storage/versioning columns are not exposed.
 */
export function toV2File(record: WorkspaceFileRecord): V2File {
  return {
    id: record.id,
    name: record.name,
    size: record.size,
    type: record.type,
    key: record.key,
    folderId: record.folderId ?? null,
    folderPath: record.folderPath ?? null,
    uploadedBy: record.uploadedBy,
    uploadedAt: record.uploadedAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  }
}

/**
 * Public file-folder projection, mirroring {@link toV2File}: `workspaceId` and
 * `userId` (the creator) are internal scoping columns and stay off the wire.
 */
export function toV2FileFolder(record: WorkspaceFileFolderRecord): V2FileFolder {
  return {
    id: record.id,
    name: record.name,
    parentId: record.parentId,
    path: record.path,
    sortOrder: record.sortOrder,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    deletedAt: record.deletedAt?.toISOString() ?? null,
  }
}
