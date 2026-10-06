import type { CopyFileItemsResponse } from '@/lib/api/contracts/file-copy'
import { workspaceFileRevision } from '@/lib/workspace-files/application/file-revision'
import type { CopiedFileItems } from '@/lib/workspace-files/copy'

/** Both copy surfaces expose new canonical identities without object-storage addresses. */
export function presentCopiedFileItems(result: CopiedFileItems): CopyFileItemsResponse {
  return {
    files: result.files.map(({ key, path, ...file }) => {
      const revision = workspaceFileRevision(file)
      if (revision === null) throw new Error('Copied file is missing its content revision')
      return {
        ...file,
        uploadedAt: file.uploadedAt.toISOString(),
        updatedAt: file.updatedAt.toISOString(),
        contentUpdatedAt: file.contentUpdatedAt?.toISOString() ?? null,
        deletedAt: file.deletedAt?.toISOString() ?? null,
        revision,
      }
    }),
    folders: result.folders.map((folder) => ({
      ...folder,
      createdAt: folder.createdAt.toISOString(),
      updatedAt: folder.updatedAt.toISOString(),
      deletedAt: folder.deletedAt?.toISOString() ?? null,
    })),
  }
}
