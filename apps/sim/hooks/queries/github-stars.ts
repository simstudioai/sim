import { useQuery } from '@tanstack/react-query'

/**
 * Query key factory for GitHub stars queries
 */
export const githubStarsKeys = {
  all: ['githubStars'] as const,
  count: () => [...githubStarsKeys.all, 'count'] as const,
}

async function fetchGitHubStars(signal?: AbortSignal): Promise<string> {
  const response = await fetch('/api/stars', {
    signal,
    headers: { 'Cache-Control': 'max-age=3600' },
  })
  if (!response.ok) {
    throw new Error('Failed to fetch GitHub stars')
  }
  const data = await response.json()
  return (data?.stars as string) ?? ''
}

/**
 * Loads the formatted GitHub star count for the Sim repository.
 * The `/api/stars` endpoint caches upstream for 1 hour, so a 1-hour
 * staleTime keeps the client cache aligned with the server cache.
 */
export function useGitHubStars() {
  return useQuery({
    queryKey: githubStarsKeys.count(),
    queryFn: ({ signal }) => fetchGitHubStars(signal),
    staleTime: 60 * 60 * 1000,
  })
}
