'use client'

import { ROOM_TYPES } from '@sim/realtime-protocol/rooms'
import { useQueryClient } from '@tanstack/react-query'
import { useWorkspaceInvalidationRoom } from '@/app/workspace/[workspaceId]/hooks/use-workspace-invalidation-room'
import { invalidateWorkspaceFileBrowsers } from '@/hooks/queries/workspace-file-folders'

/**
 * Keeps the file browser live: joins the workspace-files room so a `workspace-files-changed`
 * broadcast (fanned out by the file mutation API) invalidates the browser queries and every viewer
 * refetches without waiting for staleness. Thin binding over {@link useWorkspaceInvalidationRoom}.
 */
export function useWorkspaceFilesRoom(workspaceId: string): void {
  const queryClient = useQueryClient()
  useWorkspaceInvalidationRoom(workspaceId, ROOM_TYPES.WORKSPACE_FILES, () =>
    invalidateWorkspaceFileBrowsers(queryClient, workspaceId)
  )
}
