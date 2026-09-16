'use client'

import { ROOM_TYPES } from '@sim/realtime-protocol/rooms'
import { useQueryClient } from '@tanstack/react-query'
import { useWorkspaceInvalidationRoom } from '@/app/workspace/[workspaceId]/hooks/use-workspace-invalidation-room'
import { folderKeys } from '@/hooks/queries/utils/folder-keys'
import { tableKeys } from '@/hooks/queries/utils/table-keys'

/**
 * Table and table-folder mutations share this room because the browser renders both the table
 * list and folder tree. Broadcast invalidation keeps every viewer current without waiting for
 * query staleness.
 */
export function useWorkspaceTablesRoom(workspaceId: string): void {
  const queryClient = useQueryClient()
  useWorkspaceInvalidationRoom(workspaceId, ROOM_TYPES.WORKSPACE_TABLES, () => {
    queryClient.invalidateQueries({ queryKey: tableKeys.lists() })
    queryClient.invalidateQueries({ queryKey: tableKeys.namesRoot() })
    queryClient.invalidateQueries({ queryKey: tableKeys.referencePreviews() })
    queryClient.invalidateQueries({ queryKey: folderKeys.resource('table') })
  })
}
