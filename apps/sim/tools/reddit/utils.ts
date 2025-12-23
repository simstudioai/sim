const SUBREDDIT_PREFIX = /^r\//

/**
 * Normalizes a subreddit name by removing the 'r/' prefix if present and trimming whitespace.
 * @param subreddit - The subreddit name to normalize
 * @returns The normalized subreddit name without the 'r/' prefix
 */
export function normalizeSubreddit(subreddit: string): string {
  return subreddit.trim().replace(SUBREDDIT_PREFIX, '')
}
