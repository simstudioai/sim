import type { QueryClient } from '@tanstack/react-query'
import { listWorkspacesContract, type WorkspaceHostContext } from '@/lib/api/contracts/workspaces'
import { listMothershipChats } from '@/lib/copilot/chat/list-mothership-chats'
import { listFoldersForWorkspace } from '@/lib/folders/queries'
import { listWorkflowsForUser } from '@/lib/workflows/queries'
import { getWorkspaceHostContextForViewer } from '@/lib/workspaces/host-context'
import { listWorkspacesForViewer } from '@/lib/workspaces/list'
import { getWorkspacePermissionsForAuthorizedViewer } from '@/lib/workspaces/permissions/utils'
import { FOLDER_LIST_STALE_TIME, mapFolder } from '@/hooks/queries/folders'
import {
  MOTHERSHIP_CHAT_LIST_STALE_TIME,
  mapChat,
  mothershipChatKeys,
} from '@/hooks/queries/mothership-chats'
import { folderKeys } from '@/hooks/queries/utils/folder-keys'
import { workflowKeys } from '@/hooks/queries/utils/workflow-keys'
import { mapWorkflow, WORKFLOW_LIST_STALE_TIME } from '@/hooks/queries/utils/workflow-list-query'
import {
  normalizeWorkspacesResponse,
  WORKSPACE_LIST_STALE_TIME,
} from '@/hooks/queries/utils/workspace-list-query'
import { WORKSPACE_PERMISSIONS_STALE_TIME, workspaceKeys } from '@/hooks/queries/workspace'
import {
  WORKSPACE_HOST_CONTEXT_STALE_TIME,
  workspaceHostKeys,
} from '@/hooks/queries/workspace-host'

/**
 * Resolves and caches the route-derived host context before any workspace UI or
 * host branding renders. A `null` result is an explicit access denial.
 */
export function prefetchWorkspaceHostContext(
  queryClient: QueryClient,
  workspaceId: string,
  userId: string
): Promise<WorkspaceHostContext | null> {
  return queryClient.fetchQuery({
    queryKey: workspaceHostKeys.detail(workspaceId),
    queryFn: () => getWorkspaceHostContextForViewer(workspaceId, userId),
    staleTime: WORKSPACE_HOST_CONTEXT_STALE_TIME,
  })
}

/**
 * Prefetches the sidebar's workflow, chat, folder, workspace-permissions, and
 * workspace lists for a workspace and stores them under the same query keys +
 * mappers the client hooks use, so the persistent sidebar (including the
 * workspace switcher header) paints populated on the first server render
 * instead of flashing skeletons on a cold load (e.g. after the browser
 * discards an idle tab). Calls the data layer directly — the same functions
 * the API routes use — with no internal HTTP hop.
 *
 * The host context is the authorization proof for this server-render pass, so
 * permission prefetch can reuse its effective permission without repeating
 * workspace and membership reads. It also proves the viewer has at least one
 * accessible workspace, which is why the workspace-list prefetch can safely
 * skip the route's empty-list default-workspace creation path — and the
 * route's orphaned-workflow repair, which still runs on client refetches.
 */
export async function prefetchWorkspaceSidebar(
  queryClient: QueryClient,
  workspaceId: string,
  userId: string,
  hostContext: WorkspaceHostContext,
  activeOrganizationId: string | null
): Promise<void> {
  if (hostContext.workspace.id !== workspaceId) return
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
      queryKey: mothershipChatKeys.list(workspaceId, 'active'),
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
      queryKey: workspaceKeys.list('active'),
      queryFn: async () => {
        const payload = await listWorkspacesForViewer({
          userId,
          activeOrganizationId,
          scope: 'active',
        })
        // An empty list means GET /api/workspaces' default-workspace creation
        // path must run — throw so prefetchQuery caches nothing and the client
        // fetch reaches the route.
        if (payload.workspaces.length === 0) {
          throw new Error('Empty workspace list requires the route creation path')
        }
        // Parsing through the route contract's response schema strips the same
        // server-only fields `requestJson` strips on the client, guaranteeing the
        // cached shape is identical to a client fetch.
        return normalizeWorkspacesResponse(listWorkspacesContract.response.schema.parse(payload))
      },
      staleTime: WORKSPACE_LIST_STALE_TIME,
    }),
    queryClient.prefetchQuery({
      queryKey: workspaceKeys.permissions(workspaceId),
      queryFn: () =>
        getWorkspacePermissionsForAuthorizedViewer(
          workspaceId,
          userId,
          hostContext.viewer.permission
        ),
      staleTime: WORKSPACE_PERMISSIONS_STALE_TIME,
    }),
  ])
}
