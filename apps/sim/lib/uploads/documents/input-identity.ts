import type { WorkspaceFileRow } from '@sim/db/schema'
import type { EditableFileOwner } from '@/lib/workspace-files/ownership'

/** Binds a rendered cache entry to every authorized input revision, in canonical file order. */
export function fileDocumentInputIdentity(
  owner: EditableFileOwner,
  files: readonly WorkspaceFileRow[]
) {
  return files.length > 0
    ? JSON.stringify({
        version: 1,
        inputs: files.map((file) => ({
          fileId: file.id,
          key: file.key,
          context: owner.entityType,
          contentVersion: file.contentUpdatedAt.toISOString(),
          size: file.sizeBytes,
        })),
      })
    : undefined
}
