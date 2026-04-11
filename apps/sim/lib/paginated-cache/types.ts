/**
 * Pure pagination semantics — storage-agnostic.
 */
export interface ToolPaginationConfig<O = Record<string, unknown>> {
  /** The field in the tool output containing the page of data (e.g. 'tickets') */
  pageField: string
  /** Extract the items array from a single page response */
  getItems: (output: O) => unknown[]
  /** Extract the next page token, or null if no more pages */
  getNextPageToken: (output: O) => string | number | null
  /** Build params for fetching the next page */
  buildNextPageParams: (
    currentParams: Record<string, unknown>,
    token: string | number
  ) => Record<string, unknown>
  /** Maximum pages to fetch. Default: 10,000 */
  maxPages?: number
}

/** Lightweight reference stored in blockStates instead of full data */
export interface PaginatedCacheReference {
  _type: 'paginated_cache_ref'
  cacheId: string
  totalPages: number
  totalItems: number
  pageField: string
}

/** A single cached page */
export interface CachedPage {
  pageIndex: number
  itemCount: number
  items: unknown[]
  storedAt: number
}

/** Summary metadata for a paginated cache entry */
export interface CacheMetadata {
  cacheId: string
  totalPages: number
  totalItems: number
  pageField: string
}

/** Type guard for PaginatedCacheReference */
export function isPaginatedCacheReference(value: unknown): value is PaginatedCacheReference {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  return (
    obj._type === 'paginated_cache_ref' &&
    typeof obj.cacheId === 'string' &&
    typeof obj.totalPages === 'number' &&
    typeof obj.totalItems === 'number' &&
    typeof obj.pageField === 'string'
  )
}
