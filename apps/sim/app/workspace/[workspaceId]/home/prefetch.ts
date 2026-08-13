import type { QueryClient } from '@tanstack/react-query'
import { listWorkspaceFilesWithShares } from '@/lib/workspace-files/queries'
import { getWorkspaceHostContextForViewer } from '@/lib/workspaces/host-context'
import {
  WORKSPACE_FILES_LIST_STALE_TIME,
  workspaceFilesKeys,
} from '@/hooks/queries/workspace-files'

/**
 * Prefetches the workspace files the home view lists, under the same query key
 * its client hook (`useWorkspaceFiles`) uses, so the view paints populated on
 * first render.
 *
 * Reads the data layer rather than the route, which drops a server-to-server
 * request and its duplicate auth. It also fixes the shape this key was seeded
 * with: `listWorkspaceFilesContract` declares the date fields as
 * `z.coerce.date()`, so every consumer of `workspaceFilesKeys.list` holds
 * `Date`s, and `files/prefetch.ts` already seeds them that way from this same
 * function. Caching the raw route JSON here put ISO strings under that key
 * instead, so a file record's type depended on which page the viewer landed on.
 *
 * The read carries no authorization of its own, so the viewer is proved first.
 * `getWorkspaceHostContextForViewer` is `cache`d and the layout has already
 * resolved it for this request, so this costs no additional queries; a viewer
 * without access caches nothing and the client fetch reaches the route for the
 * real 403.
 *
 * Folders (`folderKeys.list(ws, 'active', 'workflow')`) and the workflow list
 * are both already hydrated by the workspace sidebar prefetch and are
 * intentionally not repeated here.
 */
export async function prefetchHomeLists(
  queryClient: QueryClient,
  workspaceId: string,
  userId: string
): Promise<void> {
  const hostContext = await getWorkspaceHostContextForViewer(workspaceId, userId)
  if (!hostContext) return

  await queryClient.prefetchQuery({
    queryKey: workspaceFilesKeys.list(workspaceId, 'active'),
    queryFn: () => listWorkspaceFilesWithShares(workspaceId, 'active'),
    staleTime: WORKSPACE_FILES_LIST_STALE_TIME,
  })
}
