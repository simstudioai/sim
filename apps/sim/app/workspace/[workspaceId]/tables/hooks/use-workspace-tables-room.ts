'use client'

import { ROOM_TYPES } from '@sim/realtime-protocol/rooms'
import { useQueryClient } from '@tanstack/react-query'
import { useWorkspaceInvalidationRoom } from '@/app/workspace/[workspaceId]/hooks/use-workspace-invalidation-room'
import { folderKeys } from '@/hooks/queries/utils/folder-keys'
import { tableKeys } from '@/hooks/queries/utils/table-keys'

/**
 * Keeps the tables browser live: joins the workspace-tables room so a `workspace-tables-changed`
 * broadcast (fanned out by the table + table-folder mutation services) invalidates the tables list
 * AND the table folders so every viewer refetches without waiting for staleness. A created/renamed/
 * moved/deleted/restored table changes the list result (including folder placement); a folder
 * create/rename/delete/restore changes the folder tree — the page renders both, so both are
 * invalidated. Thin binding over {@link useWorkspaceInvalidationRoom}.
 */
export function useWorkspaceTablesRoom(workspaceId: string): void {
  const queryClient = useQueryClient()
  useWorkspaceInvalidationRoom(workspaceId, ROOM_TYPES.WORKSPACE_TABLES, () => {
    queryClient.invalidateQueries({ queryKey: tableKeys.lists() })
    queryClient.invalidateQueries({ queryKey: folderKeys.resource('table') })
  })
}
