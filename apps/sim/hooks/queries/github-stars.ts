import { useQuery } from '@tanstack/react-query'

/**
 * Query key factory for GitHub stars queries
 */
export const githubStarsKeys = {
  all: ['githubStars'] as const,
  count: () => [...githubStarsKeys.all, 'count'] as const,
}

/**
 * Fallback star count shown before the first fetch resolves. Centralized here
 * so every consumer of `useGitHubStars` renders the same placeholder.
 */
export const GITHUB_STARS_FALLBACK = '27.8k'

async function fetchGitHubStars(signal?: AbortSignal): Promise<string> {
  const response = await fetch('/api/stars', {
    signal,
    headers: { 'Cache-Control': 'max-age=3600' },
  })
  if (!response.ok) {
    throw new Error('Failed to fetch GitHub stars')
  }
  const data = await response.json()
  const value = data?.stars
  return typeof value === 'string' && value.length > 0 ? value : GITHUB_STARS_FALLBACK
}

/**
 * Loads the formatted GitHub star count for the Sim repository.
 * The `/api/stars` endpoint caches upstream for 1 hour, so a 1-hour
 * staleTime keeps the client cache aligned with the server cache.
 * `initialData` + `initialDataUpdatedAt: 0` gives `data` a narrowed
 * `string` type from the first render while still triggering a refetch
 * on mount, so consumers never need a fallback or undefined check.
 */
export function useGitHubStars() {
  return useQuery({
    queryKey: githubStarsKeys.count(),
    queryFn: ({ signal }) => fetchGitHubStars(signal),
    staleTime: 60 * 60 * 1000,
    initialData: GITHUB_STARS_FALLBACK,
    initialDataUpdatedAt: 0,
  })
}
