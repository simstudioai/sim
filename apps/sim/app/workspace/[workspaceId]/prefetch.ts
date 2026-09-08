import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { QueryClient } from '@tanstack/react-query'
import { listWorkspacesContract, type WorkspaceHostContext } from '@/lib/api/contracts/workspaces'
import { listMothershipChats } from '@/lib/copilot/chat/list-mothership-chats'
import { isChatEnabled } from '@/lib/core/config/env-flags'
import { prefetchUserProfile } from '@/lib/users/prefetch-user-profile'
import { listWorkflowsForUser } from '@/lib/workflows/queries'
import { getWorkspaceHostContextForViewer } from '@/lib/workspaces/host-context'
import { listWorkspacesForViewer } from '@/lib/workspaces/list'
import { getWorkspacePermissionsForAuthorizedViewer } from '@/lib/workspaces/permissions/utils'
import { prefetchResourceFolders } from '@/app/workspace/[workspaceId]/lib/prefetch-resource-folders'
import {
  MOTHERSHIP_CHAT_LIST_STALE_TIME,
  mapChat,
  mothershipChatKeys,
} from '@/hooks/queries/mothership-chats'
import { workflowKeys } from '@/hooks/queries/utils/workflow-keys'
import { mapWorkflow, WORKFLOW_LIST_STALE_TIME } from '@/hooks/queries/utils/workflow-list-query'
import { normalizeWorkspacesResponse } from '@/hooks/queries/utils/workspace-list-query'
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

const logger = createLogger('WorkspacePrefetch')

/**
 * Seeds the viewer's workspace list, which the switcher reads.
 *
 * Seeded rather than prefetched so the empty-list case can decline to create a
 * cache entry at all: the route's default-workspace creation path must run on
 * the client, and an entry — even an empty one — would suppress it. Expressing
 * that as an absent seed also keeps a routine state out of the error channel,
 * where it read as a failure rather than as "nothing to seed".
 */
async function seedWorkspaceList(
  queryClient: QueryClient,
  userId: string,
  activeOrganizationId: string | null
): Promise<void> {
  try {
    const payload = await listWorkspacesForViewer({
      userId,
      activeOrganizationId,
      scope: 'active',
    })
    if (payload.workspaces.length === 0) return
    /**
     * Parsing through the route contract's response schema strips the same
     * server-only fields `requestJson` strips on the client, guaranteeing the
     * seeded shape is identical to a client fetch.
     */
    queryClient.setQueryData(
      workspaceKeys.list('active'),
      normalizeWorkspacesResponse(listWorkspacesContract.response.schema.parse(payload))
    )
  } catch (error) {
    /**
     * Swallowed rather than rethrown — this read is an optimization; the layout
     * renders fine without it and the client fetch reaches the route instead.
     * Logged because contract drift between the read and the response schema
     * would otherwise degrade silently into every viewer waterfalling.
     */
    logger.warn('Workspace list seed failed; client will fetch', {
      error: getErrorMessage(error),
    })
  }
}

/**
 * Prefetches the sidebar's workflow, chat, folder, workspace-permissions,
 * workspace, and viewer-profile reads for a workspace and stores them under the
 * same query keys + mappers the client hooks use, so the persistent sidebar
 * (including the workspace switcher header and the footer's profile row) is
 * populated without a client-side request waterfall on a cold load (e.g. after
 * the browser discards an idle tab). Calls the data layer directly — the same
 * functions the API routes use — with no internal HTTP hop.
 *
 * The host context is the authorization proof for this server-render pass, so
 * permission prefetch can reuse its effective permission without repeating
 * workspace and membership reads. It also proves the viewer has at least one
 * accessible workspace, so this pass skips the route's orphaned-workflow
 * repair, which still runs on client refetches.
 *
 * All reads run concurrently and are awaited together, so every pane is settled
 * in the cache before `dehydrate` and the sidebar still paints populated rather
 * than flashing skeletons that stream in behind the shell.
 *
 * The workspace list is seeded rather than prefetched. An empty or failed read
 * seeds nothing, leaving the client fetch to reach `GET /api/workspaces`'
 * default-workspace creation path — the same outcome a rejecting `queryFn` used
 * to produce, without routing a normal state through the error channel. That
 * matters because only a settled query is dehydrated: an unawaited read would be
 * dropped from the payload entirely, so the switcher would waterfall on every
 * cold load rather than paint populated.
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
    ...(isChatEnabled
      ? [
          queryClient.prefetchQuery({
            queryKey: mothershipChatKeys.list(workspaceId, 'active'),
            queryFn: async () => {
              const data = await listMothershipChats(userId, workspaceId)
              return data.map(mapChat)
            },
            staleTime: MOTHERSHIP_CHAT_LIST_STALE_TIME,
          }),
        ]
      : []),
    prefetchResourceFolders(queryClient, workspaceId, 'workflow', userId),
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
    /**
     * The sidebar footer renders the viewer's name and avatar, so the profile is
     * sidebar data and joins this batch rather than trailing it as a client
     * waterfall.
     */
    prefetchUserProfile(queryClient, userId),
    seedWorkspaceList(queryClient, userId, activeOrganizationId),
  ])
}
