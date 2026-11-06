import type { V2FileVersion } from '@/lib/api/contracts/v2/file-versions'
import type { V2File, V2FileText } from '@/lib/api/contracts/v2/files'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { buildFolderPath } from '@/lib/folders/paths'
import { workspaceResourceWebUrl } from '@/lib/resources'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { workspaceFileVfsPath } from '@/lib/uploads/contexts/workspace/file-manager'
import type { WorkspaceFileVersionRecord } from '@/lib/uploads/contexts/workspace/file-version-store'
import { getUserEmailsByIds, requireResolvedUserEmail } from '@/lib/users/queries'
import { toFileVersion } from '@/lib/workspace-files/api'
import type { ReadWorkspaceFileTextResult } from '@/lib/workspace-files/application/read-workspace-file-text'
import { projectFileVersionAuthors } from '@/lib/workspace-files/application/version-authors'
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

/** Serializes extracted text for the file or version the result was read from. */
export function toV2FileText({
  file,
  text,
  truncated,
  degraded,
  degradedReason,
  byteCount,
  lineRange,
}: ReadWorkspaceFileTextResult): V2FileText {
  return {
    fileId: file.id,
    name: file.name,
    path: workspaceFileVfsPath(file),
    type: file.type,
    text,
    truncated,
    degraded,
    degradedReason,
    charCount: text.length,
    byteCount,
    ...(lineRange ? { lineRange } : {}),
  }
}

/** Serializes one version, resolving its authors' emails. */
export async function toV2FileVersion(record: WorkspaceFileVersionRecord): Promise<V2FileVersion> {
  const [version] = await projectFileVersionAuthors([record])
  return toFileVersion(version)
}
