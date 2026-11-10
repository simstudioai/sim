import type { SessionPrincipal } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { QueryClient } from '@tanstack/react-query'
import { listWorkspacesContract } from '@/lib/api/contracts/workspaces'
import { listViewerWorkspaces } from '@/lib/workspaces/application/viewer-workspaces'
import { workspaceKeys } from '@/hooks/queries/utils/workspace-keys'
import { normalizeWorkspacesResponse } from '@/hooks/queries/utils/workspace-list-query'

const logger = createLogger('WorkspaceListPrefetch')

/**
 * Seeds the viewer's active workspace list for the shell's organization, creating their default
 * workspace first when they have none, through the same use case and organization the client's
 * list read sends (`listViewerWorkspaces`), so first paint and the client agree on it. `withinBudget`
 * bounds the read the way the caller bounds its other first-paint reads; a read that runs out gives
 * up its seat and the client fetches the list.
 */
export async function seedWorkspaceList(
  queryClient: QueryClient,
  viewer: { principal: SessionPrincipal; organizationId: string },
  withinBudget: <T>(read: () => Promise<T>) => Promise<T>
): Promise<void> {
  try {
    const payload = await withinBudget(() =>
      listViewerWorkspaces.execute({
        principal: viewer.principal,
        input: { scope: 'active', organizationId: viewer.organizationId },
      })
    )
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
