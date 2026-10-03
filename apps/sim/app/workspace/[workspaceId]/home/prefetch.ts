import type { QueryClient } from '@tanstack/react-query'
import { getWorkspaceHostContextForViewer } from '@/lib/workspaces/host-context'
import { seedWorkspaceFiles } from '@/app/workspace/[workspaceId]/lib/seed-workspace-files'

/**
 * Prefetches what the Home surface needs on top of the workspace layout's own prefetch.
 *
 * Home reads the workspace file list on mount (resource tabs, mentions, the resource picker), so
 * the list is seeded by the routes that render Home rather than by the layout: seeding it in the
 * layout would pay for it on every workspace route, including the ones that never read it.
 *
 * The seed carries no authorization of its own, so the viewer is proved first. This reuses the
 * layout's `cache`d host-context lookup rather than re-deriving the permission, so it costs no
 * additional queries; a viewer without access caches nothing and the client fetch reaches the
 * route for the real 403.
 */
export async function prefetchHomeSurface(
  queryClient: QueryClient,
  workspaceId: string,
  userId: string | undefined
): Promise<void> {
  if (!userId) return
  const hostContext = await getWorkspaceHostContextForViewer(workspaceId, userId)
  if (!hostContext) return

  await seedWorkspaceFiles(queryClient, workspaceId)
}
