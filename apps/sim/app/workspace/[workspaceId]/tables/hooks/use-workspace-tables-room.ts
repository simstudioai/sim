'use client'

import { ROOM_TYPES } from '@sim/realtime-protocol/rooms'
import { useQueryClient } from '@tanstack/react-query'
import { useWorkspaceInvalidationRoom } from '@/app/workspace/[workspaceId]/hooks/use-workspace-invalidation-room'
import { tableKeys } from '@/hooks/queries/utils/table-keys'

/**
 * Keeps the tables browser live: joins the workspace-tables room so a `workspace-tables-changed`
 * broadcast (fanned out by the table mutation service) invalidates the tables list and every viewer
 * refetches without waiting for staleness. A created/renamed/moved/deleted/restored table changes the
 * list result (including a table's folder placement), so invalidating the list prefix is sufficient.
 * Thin binding over {@link useWorkspaceInvalidationRoom}.
 */
export function useWorkspaceTablesRoom(workspaceId: string): void {
  const queryClient = useQueryClient()
  useWorkspaceInvalidationRoom(workspaceId, ROOM_TYPES.WORKSPACE_TABLES, () =>
    queryClient.invalidateQueries({ queryKey: tableKeys.lists() })
  )
}
