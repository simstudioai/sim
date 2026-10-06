'use client'

import { type InvalidationRoomType, ROOM_TYPES } from '@sim/realtime-protocol/rooms'
import { type QueryClient, useQueryClient } from '@tanstack/react-query'
import {
  type FileOwnerAdapters,
  requireFileOwnerAdapter,
} from '@/lib/workspace-files/owner-adapters'
import type { EditableFileOwner } from '@/lib/workspace-files/ownership'
import { dashboardKeys } from '@/hooks/queries/dashboards'
import { fileCopyKeys } from '@/hooks/queries/file-copy'
import { fileHistoryKeys } from '@/hooks/queries/file-history'
import { getFileShareQueryAdapter } from '@/hooks/queries/utils/file-share-query-adapters'
import { workspaceFileTableKeys } from '@/hooks/queries/utils/file-table-keys'
import { projectFilesKeys } from '@/hooks/queries/utils/project-file-keys'
import {
  invalidateWorkspaceFileBrowsers,
  WORKSPACE_FILE_BROWSER_INVALIDATION_KEY,
} from '@/hooks/queries/workspace-file-folders'
import { useInvalidationRoom } from '@/hooks/use-invalidation-room'

interface FileListRoomAdapter {
  roomType: InvalidationRoomType
  dedupeKey: string
  refreshOnJoin?: boolean
  invalidate: (queryClient: QueryClient, ownerId: string) => void
  deny?: (queryClient: QueryClient, ownerId: string) => Promise<void>
}

const FILE_LIST_ROOMS = {
  workspace: {
    roomType: ROOM_TYPES.WORKSPACE_FILES,
    dedupeKey: WORKSPACE_FILE_BROWSER_INVALIDATION_KEY,
    invalidate(queryClient, workspaceId) {
      invalidateWorkspaceFileBrowsers(queryClient, workspaceId)
      void queryClient.invalidateQueries({
        queryKey: fileCopyKeys.destination({ entityType: 'workspace', entityId: workspaceId }),
      })
      void queryClient.invalidateQueries({ queryKey: dashboardKeys.workspace(workspaceId) })
    },
  },
  project: {
    roomType: ROOM_TYPES.PROJECT_FILES,
    dedupeKey: 'project-file-browser',
    refreshOnJoin: true,
    invalidate(queryClient, projectId) {
      const owner = { entityType: 'project', entityId: projectId } as const
      for (const queryKey of [
        projectFilesKeys.project(projectId),
        workspaceFileTableKeys.projectPreviews(projectId),
        fileCopyKeys.destination(owner),
        fileHistoryKeys.owner(owner),
        getFileShareQueryAdapter(owner).ownerKey(projectId),
      ])
        void queryClient.invalidateQueries({ queryKey })
    },
    async deny(queryClient, projectId) {
      const owner = { entityType: 'project', entityId: projectId } as const
      const keys = [
        fileCopyKeys.destination(owner),
        fileHistoryKeys.owner(owner),
        projectFilesKeys.project(projectId),
        workspaceFileTableKeys.projectPreviews(projectId),
        getFileShareQueryAdapter(owner).ownerKey(projectId),
      ]
      await Promise.all(keys.map((queryKey) => queryClient.cancelQueries({ queryKey })))
      // Reset notifies mounted observers too, so revoked rows disappear before the fresh HTTP denial.
      await Promise.all(keys.map((queryKey) => queryClient.resetQueries({ queryKey })))
    },
  },
} satisfies FileOwnerAdapters<FileListRoomAdapter>

/** Invalidates the explicit owner's list pages and clears Project data when current access is lost. */
export function useFileListRoom(owner: EditableFileOwner | null): void {
  const queryClient = useQueryClient()
  const adapter = owner
    ? requireFileOwnerAdapter<FileListRoomAdapter>(FILE_LIST_ROOMS, owner)
    : null
  useInvalidationRoom(
    owner?.entityId ?? '',
    adapter?.roomType ?? null,
    () => {
      if (owner) adapter?.invalidate(queryClient, owner.entityId)
    },
    {
      dedupeKey: adapter?.dedupeKey,
      refreshOnJoin: adapter?.refreshOnJoin,
      onAccessDenied: () => {
        if (owner) void adapter?.deny?.(queryClient, owner.entityId)
      },
    }
  )
}
