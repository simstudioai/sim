import { createLogger } from '@sim/logger'
import { env } from '@/lib/core/config/env'

const logger = createLogger('GitHubStars')

/**
 * Floor shown only when the live GitHub count can't be fetched. Kept a touch
 * below the real count (~28.9k as of 2026-06) so it never overstates, and
 * bumped periodically.
 */
const FALLBACK_STAR_COUNT = 28900

/**
 * Formats a raw star count for display (e.g. 28900 → "28.9k").
 */
export function formatStarCount(num: number): string {
  if (num < 1000) return String(num)
  const formatted = (Math.round(num / 100) / 10).toFixed(1)
  return formatted.endsWith('.0') ? `${formatted.slice(0, -2)}k` : `${formatted}k`
}

/**
 * Fetches the Sim repository's GitHub star count, formatted for display.
 *
 * Server-only. The upstream fetch is cached for 1 hour via Next.js fetch
 * caching, so statically rendered pages (landing) and the `/api/stars`
 * route share one cached value. Falls back to a static count on failure —
 * never throws.
 */
export async function getGitHubStars(): Promise<string> {
  try {
    const token = env.GITHUB_TOKEN
    const response = await fetch('https://api.github.com/repos/simstudioai/sim', {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'Sim/1.0',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      next: { revalidate: 3600 },
      cache: 'force-cache',
    })

    if (!response.ok) {
      logger.warn('GitHub API request failed:', response.status)
      return formatStarCount(FALLBACK_STAR_COUNT)
    }

    const data = await response.json()
    return formatStarCount(Number(data?.stargazers_count ?? FALLBACK_STAR_COUNT))
  } catch (error) {
    logger.warn('Error fetching GitHub stars:', error)
    return formatStarCount(FALLBACK_STAR_COUNT)
  }
}
