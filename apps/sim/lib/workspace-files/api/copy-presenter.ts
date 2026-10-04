import type { CopyFileItemsResponse } from '@/lib/api/contracts/file-copy'
import { workspaceFileRevisionField } from '@/lib/workspace-files/application/file-revision'
import type { CopiedFileItems } from '@/lib/workspace-files/copy'

/** Both copy surfaces expose new canonical identities without object-storage addresses. */
export function presentCopiedFileItems(result: CopiedFileItems): CopyFileItemsResponse {
  return {
    files: result.files.map(({ key, path, ...file }) => ({
      ...file,
      uploadedAt: file.uploadedAt.toISOString(),
      updatedAt: file.updatedAt.toISOString(),
      contentUpdatedAt: file.contentUpdatedAt?.toISOString() ?? null,
      deletedAt: file.deletedAt?.toISOString() ?? null,
      ...workspaceFileRevisionField(file),
    })),
    folders: result.folders.map((folder) => ({
      ...folder,
      createdAt: folder.createdAt.toISOString(),
      updatedAt: folder.updatedAt.toISOString(),
      deletedAt: folder.deletedAt?.toISOString() ?? null,
    })),
  }
}
