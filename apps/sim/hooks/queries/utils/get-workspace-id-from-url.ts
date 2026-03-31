/**
 * Extracts the workspace ID from the current URL pathname.
 * Returns `null` on the server or when the URL doesn't match `/workspace/{id}/...`.
 * Used as a fallback for synchronous cache-read helpers that can't access React hooks.
 */
export function getWorkspaceIdFromUrl(): string | null {
  if (typeof window === 'undefined') return null
  const match = window.location.pathname.match(/^\/workspace\/([^/]+)/)
  return match?.[1] ?? null
}
