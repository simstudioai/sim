import type { ProjectFileFolderRecord } from '@/lib/api/contracts/project-file-folders'
import type { V2ProjectFileFolder } from '@/lib/api/contracts/v2/project-file-folders'
import type { V2ProjectFile } from '@/lib/api/contracts/v2/project-files'
import { buildFolderPath } from '@/lib/folders/paths'
import type { OwnedFileRecord } from '@/lib/uploads/contexts/workspace'
import { workspaceFileRevisionField } from '@/lib/workspace-files/application/file-revision'
import { parseWorkspaceFileFolderDisplayPath } from '@/lib/workspace-files/folder-display-path'

/** Public projection of file metadata without collaboration or storage lifecycle internals. */
export function toV2ProjectFile(
  file: OwnedFileRecord<{ entityType: 'project'; entityId: string }>
): V2ProjectFile {
  if (file.folderId && file.folderPath === null) {
    throw new Error('File references an unresolved folder')
  }
  return {
    id: file.id,
    owner: file.owner,
    name: file.name,
    size: file.size,
    type: file.type,
    key: file.key,
    folderPath: file.folderPath
      ? buildFolderPath(parseWorkspaceFileFolderDisplayPath(file.folderPath))
      : '/',
    uploadedBy: file.uploadedBy,
    originalCreatorUserId: file.originalCreatorUserId,
    uploadedAt: file.uploadedAt.toISOString(),
    updatedAt: file.updatedAt.toISOString(),
    deletedAt: file.deletedAt?.toISOString() ?? null,
    ...workspaceFileRevisionField(file),
  }
}

/** Projects the shared folder record without relying on Date response coercion. */
export function toV2ProjectFileFolder(folder: ProjectFileFolderRecord): V2ProjectFileFolder {
  return {
    ...folder,
    createdAt: folder.createdAt.toISOString(),
    updatedAt: folder.updatedAt.toISOString(),
    deletedAt: folder.deletedAt?.toISOString() ?? null,
  }
}
