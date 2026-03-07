import { validatePathSegment } from '@/lib/core/security/input-validation'

const SUBREDDIT_PREFIX = /^r\//

/**
 * Normalizes a subreddit name by removing the 'r/' prefix if present and trimming whitespace.
 * Validates the result to prevent path traversal attacks.
 * @param subreddit - The subreddit name to normalize
 * @returns The normalized subreddit name without the 'r/' prefix
 * @throws Error if the subreddit name contains invalid characters
 */
export function normalizeSubreddit(subreddit: string): string {
  const normalized = subreddit.trim().replace(SUBREDDIT_PREFIX, '')
  const validation = validatePathSegment(normalized, { paramName: 'subreddit' })
  if (!validation.isValid) {
    throw new Error(validation.error)
  }
  return normalized
}
