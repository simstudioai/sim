/**
 * Shared debounce window for search-param URL writes across list surfaces.
 * The input is always controlled by the instant nuqs value; only the URL
 * write (and any query/filter consumer via `useDebounce`) waits this long.
 */
export const SEARCH_DEBOUNCE_MS = 300 as const
