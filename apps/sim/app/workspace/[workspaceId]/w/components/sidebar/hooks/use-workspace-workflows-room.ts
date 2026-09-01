'use client'

import { ROOM_TYPES } from '@sim/realtime-protocol/rooms'
import { useQueryClient } from '@tanstack/react-query'
import { useWorkspaceInvalidationRoom } from '@/app/workspace/[workspaceId]/hooks/use-workspace-invalidation-room'
import { folderKeys } from '@/hooks/queries/utils/folder-keys'
import { invalidateWorkflowLists } from '@/hooks/queries/utils/invalidate-workflow-lists'

/** Keeps the persistent workflow sidebar and its folder tree live across external mutations. */
export function useWorkspaceWorkflowsRoom(workspaceId: string): void {
  const queryClient = useQueryClient()

  useWorkspaceInvalidationRoom(workspaceId, ROOM_TYPES.WORKSPACE_WORKFLOWS, () => {
    void invalidateWorkflowLists(queryClient, workspaceId, ['active', 'archived', 'all'])
    void queryClient.invalidateQueries({
      queryKey: folderKeys.list(workspaceId, 'active', 'workflow'),
    })
    void queryClient.invalidateQueries({
      queryKey: folderKeys.list(workspaceId, 'archived', 'workflow'),
    })
  })
}
