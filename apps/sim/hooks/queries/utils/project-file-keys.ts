import type { ListProjectFileFoldersQuery } from '@/lib/api/contracts/project-file-folders'
import type { ListProjectFilesQuery } from '@/lib/api/contracts/project-files'

export const PROJECT_FILE_STALE_TIME = 30_000

export const projectFilesKeys = {
  all: ['project-files'] as const,
  project: (projectId?: string) => [...projectFilesKeys.all, projectId ?? ''] as const,
  projectLists: (projectId?: string) => [...projectFilesKeys.project(projectId), 'list'] as const,
  list: (projectId: string | undefined, filters: Omit<ListProjectFilesQuery, 'cursor'>) =>
    [...projectFilesKeys.projectLists(projectId), filters] as const,
  inventory: (projectId?: string) =>
    [...projectFilesKeys.projectLists(projectId), 'inventory'] as const,
  records: (projectId?: string) => [...projectFilesKeys.project(projectId), 'record'] as const,
  record: (projectId?: string, fileId?: string) =>
    [...projectFilesKeys.records(projectId), fileId ?? ''] as const,
  contentFile: (projectId?: string, fileId?: string) =>
    [...projectFilesKeys.record(projectId, fileId), 'content'] as const,
  content: (
    projectId: string | undefined,
    fileId: string | undefined,
    mode: 'text' | 'raw' | 'binary',
    storageKey?: string
  ) => [...projectFilesKeys.contentFile(projectId, fileId), mode, storageKey ?? ''] as const,
  projectFolders: (projectId?: string) =>
    [...projectFilesKeys.project(projectId), 'folders'] as const,
  folders: (projectId: string | undefined, scope: ListProjectFileFoldersQuery['scope']) =>
    [...projectFilesKeys.projectFolders(projectId), scope] as const,
  workspaceProject: (workspaceId?: string) =>
    [...projectFilesKeys.all, 'workspace-project', workspaceId ?? ''] as const,
}
