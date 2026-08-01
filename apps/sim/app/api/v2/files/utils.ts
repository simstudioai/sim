import type { V2File } from '@/lib/api/contracts/v2/files'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'

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
