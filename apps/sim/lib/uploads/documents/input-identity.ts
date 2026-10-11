import type { WorkspaceFileRow } from '@sim/db/schema'
import { compareStrings } from '@sim/utils/string'
import type { EditableFileOwner } from '@/lib/workspace-files/ownership'

/** Binds a rendered cache entry to every authorized input revision, in canonical file order. */
export function fileDocumentInputIdentity(
  owner: EditableFileOwner,
  files: readonly Pick<WorkspaceFileRow, 'id' | 'key' | 'contentUpdatedAt' | 'sizeBytes'>[]
) {
  return files.length > 0
    ? JSON.stringify({
        version: 1,
        inputs: [...files]
          .sort((left, right) => compareStrings(left.id, right.id))
          .map((file) => ({
            fileId: file.id,
            key: file.key,
            context: owner.entityType,
            contentVersion: file.contentUpdatedAt.toISOString(),
            size: file.sizeBytes,
          })),
      })
    : undefined
}
