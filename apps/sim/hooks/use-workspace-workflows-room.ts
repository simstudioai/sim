'use client'

import { ROOM_TYPES } from '@sim/realtime-protocol/rooms'
import { useQueryClient } from '@tanstack/react-query'
import { folderKeys } from '@/hooks/queries/utils/folder-keys'
import { invalidateWorkflowLists } from '@/hooks/queries/utils/invalidate-workflow-lists'
import { useWorkspaceInvalidationRoom } from '@/hooks/use-workspace-invalidation-room'

/**
 * Keeps the workflows list live: joins the workspace-workflows room so a
 * `workspace-workflows-changed` broadcast (fanned out by the workflow use cases and folder
 * mutations on every surface: UI, CLI, Chat, API) refetches this workspace's workflow lists and
 * workflow folders, in both scopes, without waiting for staleness. Thin binding over
 * {@link useWorkspaceInvalidationRoom}, mirroring `useWorkspaceTablesRoom`.
 */
export function useWorkspaceWorkflowsRoom(workspaceId: string): void {
  const queryClient = useQueryClient()
  useWorkspaceInvalidationRoom(workspaceId, ROOM_TYPES.WORKSPACE_WORKFLOWS, () =>
    Promise.all([
      invalidateWorkflowLists(queryClient, workspaceId, ['active', 'archived']),
      queryClient.invalidateQueries({ queryKey: folderKeys.list(workspaceId, 'active') }),
      queryClient.invalidateQueries({ queryKey: folderKeys.list(workspaceId, 'archived') }),
    ])
  )
}
