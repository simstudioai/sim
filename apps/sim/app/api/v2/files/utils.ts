import type { V2File } from '@/lib/api/contracts/v2/files'
import { buildFolderPath } from '@/lib/folders/paths'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { getUserEmailsByIds, requireResolvedUserEmail } from '@/lib/users/queries'
import { parseWorkspaceFileFolderDisplayPath } from '@/lib/workspace-files/folder-display-path'

/** Shared serialization for the v2 files surface. */

/**
 * Public file projection. `workspaceId` (already known to the caller, who
 * supplied it) and the internal storage/versioning columns are not exposed.
 */
function serializeV2File(record: WorkspaceFileRecord, uploadedByEmail: string): V2File {
  const folderPath = record.folderId
    ? buildFolderPath(
        (() => {
          if (!record.folderPath) throw new Error('File references an unresolved folder')
          return parseWorkspaceFileFolderDisplayPath(record.folderPath)
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
    uploadedByEmail,
    uploadedAt: record.uploadedAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    deletedAt: record.deletedAt?.toISOString() ?? null,
  }
}

/** Resolves and serializes one public file attribution. */
export async function toV2File(record: WorkspaceFileRecord): Promise<V2File> {
  const emailByUserId = await getUserEmailsByIds([record.uploadedBy])
  return serializeV2File(record, requireResolvedUserEmail(emailByUserId, record.uploadedBy))
}

/** Resolves a file page's attribution in one query before serialization. */
export async function toV2Files(records: WorkspaceFileRecord[]): Promise<V2File[]> {
  const emailByUserId = await getUserEmailsByIds(records.map((record) => record.uploadedBy))
  return records.map((record) =>
    serializeV2File(record, requireResolvedUserEmail(emailByUserId, record.uploadedBy))
  )
}
