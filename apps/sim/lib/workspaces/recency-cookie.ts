/**
 * Mirrors the viewer's most recent workspace visits into a cookie so the server
 * can render the workspace list in the order the browser's visit history will
 * produce. Visit history itself stays in localStorage; this is only the head of
 * it, capped because the cookie rides along on every request.
 */
export const WORKSPACE_RECENCY_COOKIE = 'workspace_recency'

const MAX_RECENT_WORKSPACES = 20
const SEPARATOR = '.'
const WORKSPACE_ID_PATTERN = /^[\w-]{1,64}$/

/** Most-recent-first workspace ids from a visit-time map, ready for `document.cookie`. */
export function serializeWorkspaceRecency(visits: Record<string, number>): string {
  return Object.entries(visits)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_RECENT_WORKSPACES)
    .map(([id]) => id)
    .filter((id) => WORKSPACE_ID_PATTERN.test(id))
    .join(SEPARATOR)
}

/** Parses the cookie defensively: it is client-written, so malformed ids are dropped. */
export function parseWorkspaceRecency(value: string | undefined): string[] {
  if (!value) return []
  return value
    .split(SEPARATOR)
    .filter((id) => WORKSPACE_ID_PATTERN.test(id))
    .slice(0, MAX_RECENT_WORKSPACES)
}

/**
 * Orders items by their position in `recentIds`, leaving untracked items after
 * them in their incoming order — the same result `sortByRecency` gives for
 * the ids the cookie holds.
 */
export function sortByRecentIds<T extends { id: string }>(
  items: T[],
  recentIds: readonly string[]
): T[] {
  if (recentIds.length === 0) return items
  const rank = new Map(recentIds.map((id, index) => [id, index]))
  const untracked = recentIds.length
  return [...items].sort((a, b) => (rank.get(a.id) ?? untracked) - (rank.get(b.id) ?? untracked))
}
