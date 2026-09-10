import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { QueryClient } from '@tanstack/react-query'
import { listWorkspacesContract } from '@/lib/api/contracts/workspaces'
import { listWorkspacesForViewer } from '@/lib/workspaces/list'
import { normalizeWorkspacesResponse } from '@/hooks/queries/utils/workspace-list-query'
import { workspaceKeys } from '@/hooks/queries/workspace'

const logger = createLogger('WorkspaceListPrefetch')

/**
 * Leaves empty workspace lists uncached so the client reaches the route's
 * default-workspace creation path.
 */
export async function seedWorkspaceList(
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
    /** Strip server-only fields to match the client response. */
    queryClient.setQueryData(
      workspaceKeys.list('active'),
      normalizeWorkspacesResponse(listWorkspacesContract.response.schema.parse(payload))
    )
  } catch (error) {
    /** Keep optional prefetch failures from blocking the layout. */
    logger.warn('Workspace list seed failed; client will fetch', {
      error: getErrorMessage(error),
    })
  }
}
