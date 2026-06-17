import type { QueryClient } from '@tanstack/react-query'
import { listMothershipChats } from '@/lib/copilot/chat/list-mothership-chats'
import { listWorkflowsForUser } from '@/lib/workflows/queries'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'
import {
  MOTHERSHIP_CHAT_LIST_STALE_TIME,
  mapChat,
  mothershipChatKeys,
} from '@/hooks/queries/mothership-chats'
import { workflowKeys } from '@/hooks/queries/utils/workflow-keys'
import { mapWorkflow, WORKFLOW_LIST_STALE_TIME } from '@/hooks/queries/utils/workflow-list-query'

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
 * Prefetches the sidebar's workflow + chat lists for a workspace and stores them
 * under the same query keys + mappers the client hooks use, so the persistent
 * sidebar paints populated on the first server render instead of flashing skeletons
 * on a cold load (e.g. after the browser discards an idle tab). Calls the data layer
 * directly — the same functions the API routes use — with no internal HTTP hop.
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
  ])
}
