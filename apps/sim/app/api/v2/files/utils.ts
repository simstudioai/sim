import type { V2FileVersion } from '@/lib/api/contracts/v2/file-versions'
import type { V2File } from '@/lib/api/contracts/v2/files'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { buildFolderPath } from '@/lib/folders/paths'
import { workspaceResourceWebUrl } from '@/lib/resources'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import type { WorkspaceFileVersionRecord } from '@/lib/uploads/contexts/workspace/workspace-file-versions'
import {
  findUserEmailsByIds,
  getUserEmailsByIds,
  requireResolvedUserEmail,
} from '@/lib/users/queries'
import { parseWorkspaceFileFolderDisplayPath } from '@/lib/workspace-files/folder-display-path'

/** Shared serialization for the v2 files surface. */

/**
 * Public file projection. `workspaceId` (already known to the caller, who
 * supplied it) and the internal storage/versioning columns are not exposed.
 */
function serializeV2File(
  record: WorkspaceFileRecord,
  uploadedByEmail: string,
  baseUrl: string
): V2File {
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
    webUrl: workspaceResourceWebUrl(baseUrl, record.workspaceId, 'file', record.id),
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
  return serializeV2File(
    record,
    requireResolvedUserEmail(emailByUserId, record.uploadedBy),
    getBaseUrl()
  )
}

/** Resolves a file page's attribution in one query before serialization. */
export async function toV2Files(records: WorkspaceFileRecord[]): Promise<V2File[]> {
  const emailByUserId = await getUserEmailsByIds(records.map((record) => record.uploadedBy))
  const baseUrl = getBaseUrl()
  return records.map((record) =>
    serializeV2File(record, requireResolvedUserEmail(emailByUserId, record.uploadedBy), baseUrl)
  )
}

function serializeV2FileVersion(
  record: WorkspaceFileVersionRecord,
  emailByUserId: Map<string, string>
): V2FileVersion {
  return {
    fileId: record.fileId,
    version: record.version,
    isCurrent: record.isCurrent,
    size: record.size,
    contentType: record.contentType,
    source: record.source,
    authors: record.authorUserIds.map((id) => ({ id, email: emailByUserId.get(id) ?? null })),
    restoredFromVersion: record.restoredFromVersion,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    supersededAt: record.supersededAt?.toISOString() ?? null,
  }
}

/** Serializes file versions, resolving every author's email in one query. */
export async function toV2FileVersions(
  records: WorkspaceFileVersionRecord[]
): Promise<V2FileVersion[]> {
  const emailByUserId = await findUserEmailsByIds(records.flatMap((record) => record.authorUserIds))
  return records.map((record) => serializeV2FileVersion(record, emailByUserId))
}

export async function toV2FileVersion(record: WorkspaceFileVersionRecord): Promise<V2FileVersion> {
  const [version] = await toV2FileVersions([record])
  return version
}
