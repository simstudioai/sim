import type { QueryClient, QueryKey } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type GetProjectFileShareResponse,
  getProjectFileShareContract,
  updateProjectFileShareContract,
} from '@/lib/api/contracts/project-file-shares'
import {
  type GetFileShareResponse,
  getFileShareContract,
  type ShareRecord,
  type UpsertFileShareBody,
  upsertFileShareContract,
} from '@/lib/api/contracts/public-shares'
import {
  type FileOwnerAdapters,
  requireFileOwnerAdapter,
} from '@/lib/workspace-files/owner-adapters'
import type { EditableFileOwner } from '@/lib/workspace-files/ownership'
import { projectFilesKeys } from '@/hooks/queries/utils/project-file-keys'
import { workspaceFilesKeys } from '@/hooks/queries/utils/workspace-file-query'

type ShareCacheValue = ShareRecord | null | GetProjectFileShareResponse
interface FileShareQueryAdapter {
  ownerKey(id: string): QueryKey
  key(id: string, fileId: string): QueryKey
  read(id: string, fileId: string, signal?: AbortSignal): Promise<ShareCacheValue>
  state(
    value: ShareCacheValue
  ): GetFileShareResponse & Partial<Pick<GetProjectFileShareResponse, 'policy' | 'capabilities'>>
  update(id: string, fileId: string, body: UpsertFileShareBody): Promise<{ share: ShareRecord }>
  store(client: QueryClient, id: string, fileId: string, share: ShareRecord): void
  invalidate(client: QueryClient, id: string, fileId: string): void
}
const shareKeys = {
  all: ['publicShares'] as const,
  details: () => [...shareKeys.all, 'detail'] as const,
  workspaceOwner: (id: string) => [...shareKeys.details(), id] as const,
  workspace: (id: string, fileId: string) => [...shareKeys.workspaceOwner(id), fileId] as const,
  projectOwner: (id: string) => [...shareKeys.details(), 'project', id] as const,
  project: (id: string, fileId: string) => [...shareKeys.projectOwner(id), fileId] as const,
}
const SHARE_QUERY_ADAPTERS: FileOwnerAdapters<FileShareQueryAdapter> = {
  workspace: {
    ownerKey: shareKeys.workspaceOwner,
    key: shareKeys.workspace,
    async read(id, fileId, signal) {
      return (await requestJson(getFileShareContract, { params: { id, fileId }, signal })).share
    },
    state(value) {
      if (value && 'share' in value) throw new Error('Invalid environment share cache')
      return { share: value }
    },
    update: (id, fileId, body) =>
      requestJson(upsertFileShareContract, { params: { id, fileId }, body }),
    store: (client, id, fileId, share) => {
      client.setQueryData(shareKeys.workspace(id, fileId), share)
    },
    invalidate: (client, id, fileId) => {
      void client.invalidateQueries({ queryKey: shareKeys.workspace(id, fileId) })
      void client.invalidateQueries({ queryKey: workspaceFilesKeys.workspaceLists(id) })
    },
  },
  project: {
    ownerKey: shareKeys.projectOwner,
    key: shareKeys.project,
    read: (id, fileId, signal) =>
      requestJson(getProjectFileShareContract, { params: { id, fileId }, signal }),
    state(value) {
      if (!value || !('policy' in value)) throw new Error('Invalid Project share cache')
      return value
    },
    update: (id, fileId, body) =>
      requestJson(updateProjectFileShareContract, { params: { id, fileId }, body }),
    store(client, id, fileId, share) {
      client.setQueryData<GetProjectFileShareResponse>(shareKeys.project(id, fileId), (current) =>
        current ? { ...current, share } : undefined
      )
    },
    invalidate(client, id, fileId) {
      void client.invalidateQueries({ queryKey: shareKeys.project(id, fileId) })
      void client.invalidateQueries({ queryKey: projectFilesKeys.projectLists(id) })
      void client.invalidateQueries({ queryKey: projectFilesKeys.record(id, fileId) })
    },
  },
}

export function getFileShareQueryAdapter(owner: EditableFileOwner): FileShareQueryAdapter {
  return requireFileOwnerAdapter(SHARE_QUERY_ADAPTERS, owner)
}
