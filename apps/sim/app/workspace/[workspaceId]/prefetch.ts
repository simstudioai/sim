import type { QueryClient } from '@tanstack/react-query'
import { listMothershipChats } from '@/lib/copilot/chat/list-mothership-chats'
import { listFoldersForWorkspace } from '@/lib/folders/queries'
import { listWorkflowsForUser } from '@/lib/workflows/queries'
import {
  checkWorkspaceAccess,
  getWorkspacePermissionsForViewer,
} from '@/lib/workspaces/permissions/utils'
import { FOLDER_LIST_STALE_TIME, mapFolder } from '@/hooks/queries/folders'
import {
  MOTHERSHIP_CHAT_LIST_STALE_TIME,
  mapChat,
  mothershipChatKeys,
} from '@/hooks/queries/mothership-chats'
import { folderKeys } from '@/hooks/queries/utils/folder-keys'
import { workflowKeys } from '@/hooks/queries/utils/workflow-keys'
import { mapWorkflow, WORKFLOW_LIST_STALE_TIME } from '@/hooks/queries/utils/workflow-list-query'
import { WORKSPACE_PERMISSIONS_STALE_TIME, workspaceKeys } from '@/hooks/queries/workspace'

/** Resolves whether the user may access the workspace, swallowing errors to a `false`. */
async function userCanAccessWorkspace(workspaceId: string, userId: string): Promise<boolean> {
  try {
    const access = await checkWorkspaceAccess(workspaceId, userId)
    return access.exists && access.hasAccess
  } catch {
    return false
  }
}

/**
 * Prefetches the sidebar's workflow, chat, folder, and workspace-permissions lists for
 * a workspace and stores them under the same query keys + mappers the client hooks use,
 * so the persistent sidebar paints populated on the first server render instead of
 * flashing skeletons on a cold load (e.g. after the browser discards an idle tab). Calls
 * the data layer directly — the same functions the API routes use — with no internal
 * HTTP hop.
 *
 * Skips silently when the user can't access the workspace, leaving the client to
 * fetch and surface the real error instead of caching an empty list.
 */
export async function prefetchWorkspaceSidebar(
  queryClient: QueryClient,
  workspaceId: string,
  userId: string
): Promise<void> {
  if (!(await userCanAccessWorkspace(workspaceId, userId))) return
  await Promise.all([
    queryClient.prefetchQuery({
      queryKey: workflowKeys.list(workspaceId, 'active'),
      queryFn: async () => {
        const rows = await listWorkflowsForUser({ userId, workspaceId, scope: 'active' })
        return rows.map(mapWorkflow)
      },
      staleTime: WORKFLOW_LIST_STALE_TIME,
    }),
    queryClient.prefetchQuery({
      queryKey: mothershipChatKeys.list(workspaceId),
      queryFn: async () => {
        const data = await listMothershipChats(userId, workspaceId)
        return data.map(mapChat)
      },
      staleTime: MOTHERSHIP_CHAT_LIST_STALE_TIME,
    }),
    queryClient.prefetchQuery({
      queryKey: folderKeys.list(workspaceId, 'active'),
      queryFn: async () => {
        const rows = await listFoldersForWorkspace(workspaceId, 'active')
        return rows.map(mapFolder)
      },
      staleTime: FOLDER_LIST_STALE_TIME,
    }),
    queryClient.prefetchQuery({
      queryKey: workspaceKeys.permissions(workspaceId),
      queryFn: async () => {
        const result = await getWorkspacePermissionsForViewer(workspaceId, userId)
        if (!result) throw new Error('Workspace not found or access denied')
        return result
      },
      staleTime: WORKSPACE_PERMISSIONS_STALE_TIME,
    }),
  ])
}
