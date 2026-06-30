'use client'

import { useInfiniteQuery } from '@tanstack/react-query'
import type { ChangelogEntry, GitHubRelease } from '@/app/(landing)/changelog/types'
import { mapReleases, releasesEndpoint } from '@/app/(landing)/changelog/utils'

/**
 * React Query keys for the changelog release feed. Co-located with its sole
 * consumer ({@link useChangelogReleases}) rather than in `hooks/queries/`
 * because the feed is landing-specific and depends on the changelog feature's
 * own mapper/types; keeping it here avoids a shared-hook → feature backward
 * import.
 */
export const changelogKeys = {
  all: ['changelog'] as const,
  releases: () => [...changelogKeys.all, 'releases'] as const,
}

async function fetchReleasesPage(page: number, signal?: AbortSignal): Promise<ChangelogEntry[]> {
  // boundary-raw-fetch: external GitHub Releases API (cross-origin), not a same-origin contract
  const res = await fetch(releasesEndpoint(page), {
    headers: { Accept: 'application/vnd.github+json' },
    signal,
  })
  const releases = (await res.json()) as GitHubRelease[]
  return mapReleases(releases ?? [])
}

/**
 * Paginates GitHub releases for the changelog timeline. The server page fetches
 * page 1 and passes it as `initialEntries`, seeded here via `initialData` so the
 * first page stays server-rendered (no client refetch within `staleTime`); the
 * "Show more" control drives `fetchNextPage`. A page that maps to zero entries
 * ends pagination, except the server-seeded page 1 alone — so a failed or empty
 * initial fetch still surfaces "Show more" and can load page 2, matching the
 * prior client pagination.
 */
export function useChangelogReleases(initialEntries: ChangelogEntry[]) {
  return useInfiniteQuery({
    queryKey: changelogKeys.releases(),
    queryFn: ({ pageParam, signal }) => fetchReleasesPage(pageParam, signal),
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === 0 && allPages.length > 1 ? undefined : allPages.length + 1,
    initialData: { pages: [initialEntries], pageParams: [1] },
    staleTime: 60 * 60 * 1000,
  })
}
