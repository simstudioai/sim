import type { QueryClient } from '@tanstack/react-query'
import { requestJson, requestRaw } from '@/lib/api/client/request'
import { extractProjectFileContract } from '@/lib/api/contracts/project-file-extraction'
import { listProjectFileFoldersContract } from '@/lib/api/contracts/project-file-folders'
import {
  listProjectFileVersionsContract,
  readProjectFileVersionContentContract,
  revertProjectFileVersionContract,
} from '@/lib/api/contracts/project-file-versions'
import { listWorkspaceFileFoldersContract } from '@/lib/api/contracts/workspace-file-folders'
import {
  downloadWorkspaceFileVersionContract,
  type ListWorkspaceFileVersionsResponse,
  listWorkspaceFileVersionsContract,
  type RevertWorkspaceFileVersionBody,
  revertWorkspaceFileVersionContract,
} from '@/lib/api/contracts/workspace-file-versions'
import {
  type ExtractWorkspaceFileResponse,
  extractWorkspaceFileContract,
} from '@/lib/api/contracts/workspace-files'
import { getWorkspacePermissionsContract } from '@/lib/api/contracts/workspaces'
import {
  type FileOwnerAdapters,
  requireFileOwnerAdapter,
} from '@/lib/workspace-files/owner-adapters'
import type { EditableFileOwner } from '@/lib/workspace-files/ownership'
import { projectFilesKeys } from '@/hooks/queries/utils/project-file-keys'
import { workspaceFilesKeys } from '@/hooks/queries/utils/workspace-file-query'
import { workspaceFileFolderKeys } from '@/hooks/queries/workspace-file-folders'

interface FileDestinationFolders {
  folders: { id: string; name: string; path: string }[]
  canWrite: boolean
}

interface FileBrowserOwnerAdapter {
  extract(id: string, fileId: string): Promise<ExtractWorkspaceFileResponse>
  history(
    id: string,
    fileId: string,
    cursor?: string,
    signal?: AbortSignal
  ): Promise<ListWorkspaceFileVersionsResponse>
  downloadVersion(
    id: string,
    fileId: string,
    version: number,
    signal?: AbortSignal
  ): Promise<Response>
  revert(
    id: string,
    fileId: string,
    version: number,
    body: RevertWorkspaceFileVersionBody
  ): Promise<{ reverted: boolean }>
  destinationFolders(id: string, signal?: AbortSignal): Promise<FileDestinationFolders>
  invalidate(client: QueryClient, id: string, fileId?: string): Promise<void>
}

const FILE_BROWSER_ADAPTERS: FileOwnerAdapters<FileBrowserOwnerAdapter> = {
  workspace: {
    extract: (id, fileId) => requestJson(extractWorkspaceFileContract, { params: { id, fileId } }),
    history: (id, fileId, cursor, signal) =>
      requestJson(listWorkspaceFileVersionsContract, {
        params: { id, fileId },
        query: { cursor, limit: 30, sortOrder: 'desc' },
        signal,
      }),
    downloadVersion: (id, fileId, version, signal) =>
      requestRaw(
        downloadWorkspaceFileVersionContract,
        {
          params: { id, fileId, version },
          query: {},
          signal,
        },
        { cache: 'no-store' }
      ),
    revert: (id, fileId, version, body) =>
      requestJson(revertWorkspaceFileVersionContract, {
        params: { id, fileId, version },
        query: {},
        body,
      }),
    async destinationFolders(id, signal) {
      const [result, permissions] = await Promise.all([
        requestJson(listWorkspaceFileFoldersContract, {
          params: { id },
          query: { scope: 'active' },
          signal,
        }),
        requestJson(getWorkspacePermissionsContract, { params: { id }, signal }),
      ])
      const role = permissions.viewer?.permissionType
      return { folders: result.folders, canWrite: role === 'write' || role === 'admin' }
    },
    async invalidate(client, id, fileId) {
      await Promise.all([
        client.invalidateQueries({ queryKey: workspaceFilesKeys.workspaceLists(id) }),
        client.invalidateQueries({ queryKey: workspaceFileFolderKeys.workspaceLists(id) }),
        client.invalidateQueries({ queryKey: workspaceFilesKeys.storageInfo() }),
        ...(fileId
          ? [
              client.invalidateQueries({ queryKey: workspaceFilesKeys.contentFile(id, fileId) }),
              client.invalidateQueries({ queryKey: workspaceFilesKeys.record(id, fileId) }),
            ]
          : []),
      ])
    },
  },
  project: {
    extract: (id, fileId) => requestJson(extractProjectFileContract, { params: { id, fileId } }),
    history: (id, fileId, cursor, signal) =>
      requestJson(listProjectFileVersionsContract, {
        params: { id, fileId },
        query: { cursor, limit: 30, sortOrder: 'desc' },
        signal,
      }),
    downloadVersion: (id, fileId, version, signal) =>
      requestRaw(
        readProjectFileVersionContentContract,
        {
          params: { id, fileId, version },
          query: {},
          signal,
        },
        { cache: 'no-store' }
      ),
    revert: (id, fileId, version, body) =>
      requestJson(revertProjectFileVersionContract, {
        params: { id, fileId, version },
        query: {},
        body,
      }),
    async destinationFolders(id, signal) {
      const result = await requestJson(listProjectFileFoldersContract, {
        params: { id },
        query: { scope: 'active' },
        signal,
      })
      return { folders: result.folders, canWrite: result.capabilities.canWrite }
    },
    async invalidate(client, id, fileId) {
      await Promise.all([
        client.invalidateQueries({ queryKey: projectFilesKeys.projectLists(id) }),
        client.invalidateQueries({ queryKey: projectFilesKeys.projectFolders(id) }),
        ...(fileId
          ? [
              client.invalidateQueries({ queryKey: projectFilesKeys.record(id, fileId) }),
              client.invalidateQueries({ queryKey: projectFilesKeys.contentFile(id, fileId) }),
            ]
          : []),
      ])
    },
  },
}

/** Browser controls share behavior while each owner retains its authenticated transport and cache. */
export function getFileBrowserOwnerAdapter(owner: EditableFileOwner): FileBrowserOwnerAdapter {
  return requireFileOwnerAdapter(FILE_BROWSER_ADAPTERS, owner)
}
