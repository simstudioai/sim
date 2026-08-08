import type { ShareRecord } from '@/lib/api/contracts/public-shares'
import type {
  V2DisabledFileSharing,
  V2EnabledFileSharing,
  V2File,
  V2FileSharing,
} from '@/lib/api/contracts/v2/files'
import { buildFolderPath } from '@/lib/folders/paths'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { getUserEmailsByIds, requireResolvedUserEmail } from '@/lib/users/queries'

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
    uploadedByEmail,
    uploadedAt: record.uploadedAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
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

/** Projects the persisted share row into the stable public sharing state. */
export function toV2FileSharing(share: ShareRecord | null): V2FileSharing {
  if (!share?.isActive) return { enabled: false }

  return {
    enabled: true,
    url: share.url,
    authType: share.authType,
    hasPassword: share.hasPassword,
    allowedEmails: share.allowedEmails,
  }
}

/** Projects a successful share mutation and rejects an inconsistent inactive result. */
export function toV2EnabledFileSharing(share: ShareRecord): V2EnabledFileSharing {
  const sharing = toV2FileSharing(share)
  if (!sharing.enabled) throw new Error('Sharing a workspace file returned an inactive share')
  return sharing
}

/** Projects a successful unshare mutation and rejects an inconsistent active result. */
export function toV2DisabledFileSharing(share: ShareRecord | null): V2DisabledFileSharing {
  if (share?.isActive) throw new Error('Unsharing a workspace file returned an active share')
  return { enabled: false }
}
