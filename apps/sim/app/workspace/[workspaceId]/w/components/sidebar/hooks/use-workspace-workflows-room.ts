'use client'

import { ROOM_TYPES } from '@sim/realtime-protocol/rooms'
import { useQueryClient } from '@tanstack/react-query'
import { useWorkspaceInvalidationRoom } from '@/app/workspace/[workspaceId]/hooks/use-workspace-invalidation-room'
import { folderKeys } from '@/hooks/queries/utils/folder-keys'
import { invalidateWorkflowLists } from '@/hooks/queries/utils/invalidate-workflow-lists'

/**
 * Keeps the sidebar's workflow registry live: joins the workspace-workflows room so a
 * `workspace-workflows-changed` broadcast (fanned out by the workflow application use cases and the
 * folder mutation services on every surface — UI, CLI, copilot, API) invalidates this workspace's
 * workflow lists AND the workflow folders so every viewer refetches without waiting for staleness.
 * A created/renamed/moved/deleted/duplicated/imported/restored/reordered workflow changes the list
 * result; a folder create/rename/delete/restore changes the folder tree — the sidebar renders both,
 * so both are invalidated — each scoped to this workspace, in both scopes, so one workspace's
 * broadcast never touches another workspace's cache. Lists go through
 * {@link invalidateWorkflowLists} (which also covers the workflow selectors) so a remote change
 * refreshes exactly what a local mutation would. Thin binding over
 * {@link useWorkspaceInvalidationRoom}, mirroring `useWorkspaceTablesRoom`.
 */
export function useWorkspaceWorkflowsRoom(workspaceId: string): void {
  const queryClient = useQueryClient()
  useWorkspaceInvalidationRoom(workspaceId, ROOM_TYPES.WORKSPACE_WORKFLOWS, () => {
    invalidateWorkflowLists(queryClient, workspaceId, ['active', 'archived'])
    queryClient.invalidateQueries({ queryKey: folderKeys.list(workspaceId, 'active') })
    queryClient.invalidateQueries({ queryKey: folderKeys.list(workspaceId, 'archived') })
  })
}
