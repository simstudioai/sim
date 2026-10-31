/**
 * Request header the proxy sets on every `sim/` request to the query exactly as typed, which a
 * page can't recover from its parsed `searchParams` (`?q=` and `?q` both parse to an empty value,
 * and spaces may have been typed as `%20` or `+`). The proxy always overwrites it, so a client
 * can't supply its own.
 */
export const SIM_LINK_QUERY_HEADER = 'x-sim-link-query'

/** A request's `search` as typed, without its `?` or the `_rsc` marker Next adds to its own fetches. */
export function typedQuery(search: string): string {
  return search
    .replace(/^\?/, '')
    .split('&')
    .filter((part) => part && part !== '_rsc' && !part.startsWith('_rsc='))
    .join('&')
}
