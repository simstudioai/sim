/** Renders an ISO date as "Jul 1, 2026". Pinned to UTC so the day matches the frontmatter date in every reader's timezone. */
export function formatPostDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}
