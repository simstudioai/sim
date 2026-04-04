import type { CachedPage, CacheMetadata } from '@/lib/paginated-cache/types'

/**
 * Storage-agnostic interface for paginated cache operations.
 * TTL and other storage-specific concerns belong in implementations.
 */
export interface PaginatedCacheStorageAdapter {
  /** Store a single page of items */
  storePage(cacheId: string, pageIndex: number, items: unknown[]): Promise<void>
  /** Store cache metadata */
  storeMetadata(cacheId: string, metadata: CacheMetadata): Promise<void>
  /** Retrieve a single page. Returns null if not found or expired. */
  getPage(cacheId: string, pageIndex: number): Promise<CachedPage | null>
  /** Retrieve cache metadata. Returns null if not found or expired. */
  getMetadata(cacheId: string): Promise<CacheMetadata | null>
  /** Retrieve all pages in order. Throws if any page is missing. */
  getAllPages(cacheId: string, totalPages: number): Promise<CachedPage[]>
  /** Delete all data for a cache entry */
  delete(cacheId: string): Promise<void>
}
