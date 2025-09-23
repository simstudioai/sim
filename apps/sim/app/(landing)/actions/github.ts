import { createLogger } from '@/lib/logs/console/logger'

const DEFAULT_STARS = '15.4k'

const logger = createLogger('GitHubStars')

export async function getFormattedGitHubStars(): Promise<string> {
  try {
    const response = await fetch('/api/github-stars', {
      headers: {
        'Cache-Control': 'max-age=3600', // Cache for 1 hour
      },
    })

    if (!response.ok) {
      logger.warn('Failed to fetch GitHub stars from API')
      return DEFAULT_STARS
    }

    const data = await response.json()
    return data.stars || DEFAULT_STARS
  } catch (error) {
    logger.warn('Error fetching GitHub stars:', error)
    return DEFAULT_STARS
  }
}
