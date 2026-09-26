/** Personal history stays bounded even when a member searches frequently. */
export const SEARCH_HISTORY_LIMIT = 20
export const SEARCH_HISTORY_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

/** History links may navigate to a provider, but never carry URL credentials or executable schemes. */
export function isSearchHistoryUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password
  } catch {
    return false
  }
}
