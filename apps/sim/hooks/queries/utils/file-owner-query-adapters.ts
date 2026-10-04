import type { QueryClient, QueryFilters, QueryKey } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  getProjectCsvPreviewContract,
  getProjectFileContract,
  type ProjectFileRecord,
  updateProjectFileContentContract,
} from '@/lib/api/contracts/project-files'
import {
  getWorkspaceCsvPreviewContract,
  type WorkspaceCsvPreviewResponse,
} from '@/lib/api/contracts/workspace-file-table'
import {
  type UpdateWorkspaceFileContentBody,
  updateWorkspaceFileContentContract,
} from '@/lib/api/contracts/workspace-files'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import {
  type FileOwnerAdapters,
  requireFileOwnerAdapter,
} from '@/lib/workspace-files/owner-adapters'
import type { FileOwner } from '@/lib/workspace-files/ownership'
import { workspaceFileTableKeys } from '@/hooks/queries/utils/file-table-keys'
import { projectFilesKeys } from '@/hooks/queries/utils/project-file-keys'
import {
  getWorkspaceFilesQueryOptions,
  workspaceFilesKeys,
} from '@/hooks/queries/utils/workspace-file-query'

type FileRecord = WorkspaceFileRecord | ProjectFileRecord
interface FileOwnerQueryAdapter {
  contentKey(
    id: string,
    fileId: string,
    mode: 'text' | 'raw' | 'binary',
    key: string,
    version?: string | number
  ): QueryKey
  recordFilter(id: string, fileId: string): QueryFilters
  recoveryFilters(id: string, fileId: string): QueryFilters[]
  invalidationFilters(id: string, fileId: string): QueryFilters[]
  reloadRecord(client: QueryClient, id: string, fileId: string): Promise<FileRecord>
  updateContent(
    id: string,
    fileId: string,
    body: UpdateWorkspaceFileContentBody
  ): Promise<{ file: FileRecord }>
  csvKey(id: string, fileId: string, key: string, version?: number): QueryKey
  readCsv(
    id: string,
    fileId: string,
    key: string,
    version?: number,
    signal?: AbortSignal
  ): Promise<WorkspaceCsvPreviewResponse>
}

const FILE_QUERY_ADAPTERS: FileOwnerAdapters<FileOwnerQueryAdapter> = {
  workspace: {
    contentKey: (id, fileId, mode, key, version) => [
      ...workspaceFilesKeys.content(id, fileId, mode, key),
      ...(mode === 'binary' && version != null ? [version] : []),
    ],
    recordFilter: (id) => ({ queryKey: workspaceFilesKeys.workspaceLists(id) }),
    recoveryFilters: (id) => [{ queryKey: workspaceFilesKeys.workspaceLists(id) }],
    invalidationFilters: (id, fileId) => [
      { queryKey: workspaceFilesKeys.contentFile(id, fileId) },
      { queryKey: workspaceFilesKeys.workspaceLists(id) },
    ],
    async reloadRecord(client, id, fileId) {
      await client.cancelQueries({ queryKey: workspaceFilesKeys.workspaceLists(id) })
      const files = await client.fetchQuery({ ...getWorkspaceFilesQueryOptions(id), staleTime: 0 })
      const file = files.find((record) => record.id === fileId)
      if (!file) throw new Error('File no longer exists')
      if (!file.contentUpdatedAt) throw new Error('The latest file version is unavailable')
      return file
    },
    updateContent: (id, fileId, body) =>
      requestJson(updateWorkspaceFileContentContract, { params: { id, fileId }, body }),
    csvKey: workspaceFileTableKeys.preview,
    readCsv: (id, fileId, key, version, signal) =>
      requestJson(getWorkspaceCsvPreviewContract, {
        params: { id, fileId },
        query: version != null ? { key, v: version } : { key },
        signal,
      }),
  },
  project: {
    contentKey: (id, fileId, mode, key, version) => [
      ...projectFilesKeys.content(id, fileId, mode, key),
      ...(mode === 'binary' ? [version] : []),
    ],
    recordFilter: (id, fileId) => ({ queryKey: projectFilesKeys.record(id, fileId), exact: true }),
    recoveryFilters: (id, fileId) => [
      { queryKey: projectFilesKeys.record(id, fileId), exact: true },
      { queryKey: projectFilesKeys.projectLists(id) },
    ],
    invalidationFilters: (id, fileId) => [
      { queryKey: projectFilesKeys.record(id, fileId) },
      { queryKey: projectFilesKeys.projectLists(id) },
    ],
    async reloadRecord(client, id, fileId) {
      const record = await requestJson(getProjectFileContract, { params: { id, fileId } })
      client.setQueryData(projectFilesKeys.record(id, fileId), record)
      return record.file
    },
    updateContent: (id, fileId, body) =>
      requestJson(updateProjectFileContentContract, { params: { id, fileId }, body }),
    csvKey: workspaceFileTableKeys.projectPreview,
    readCsv: (id, fileId, key, version, signal) =>
      requestJson(getProjectCsvPreviewContract, {
        params: { id, fileId },
        query: version != null ? { key, v: version } : { key },
        signal,
      }),
  },
}

/** Explicit owners take precedence; the workspace ID supports callers predating owner metadata. */
export function resolveFileQueryOwner(owner: FileOwner | undefined, workspaceId?: string) {
  const resolved =
    owner ?? (workspaceId ? { entityType: 'workspace' as const, entityId: workspaceId } : undefined)
  if (!resolved) return undefined
  return { id: resolved.entityId, adapter: requireFileOwnerAdapter(FILE_QUERY_ADAPTERS, resolved) }
}
