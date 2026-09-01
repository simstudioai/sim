import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { QueryClient } from '@tanstack/react-query'
import { listWorkspaceFilesWithShares } from '@/lib/workspace-files/queries'
import { workspaceFilesKeys } from '@/hooks/queries/workspace-files'

const logger = createLogger('SeedWorkspaceFiles')

/**
 * How many files a page is willing to inline into its document. At ~500 bytes of JSON per
 * file this budgets the entry at ~150 KB.
 *
 * A workspace above the budget seeds NOTHING rather than a prefix: the Files browser
 * renders this list as the workspace's files, so a truncated seed would silently hide some.
 */
export const WORKSPACE_FILE_SEED_MAX = 300

/**
 * Seeds the workspace's file list for the pages that render it.
 *
 * Seeded rather than prefetched so it can decline to create an entry at all above
 * {@link WORKSPACE_FILE_SEED_MAX} — `prefetchQuery` always creates one, and a partial
 * entry would be read as the whole list. Parsed through the route's response contract, so
 * a seeded entry matches what a client fetch caches.
 */
export async function seedWorkspaceFiles(
  queryClient: QueryClient,
  workspaceId: string
): Promise<void> {
  try {
    const files = await listWorkspaceFilesWithShares(workspaceId, 'active', {
      maxRows: WORKSPACE_FILE_SEED_MAX,
      /**
       * A failed read must reach the catch below, not degrade to an empty list: seeding
       * `[]` would cache "this workspace has no files" as authoritative for the entry's
       * lifetime, which is worse than seeding nothing and letting the client fetch.
       */
      throwOnError: true,
    })
    if (!files) return
    queryClient.setQueryData(workspaceFilesKeys.list(workspaceId, 'active'), files)
  } catch (error) {
    /** Optimization only: the client fetch reaches the route instead. */
    logger.warn('Workspace file list seed failed; client will fetch', {
      error: getErrorMessage(error),
    })
  }
}
