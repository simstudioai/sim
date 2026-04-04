export type { PaginatedCacheStorageAdapter } from '@/lib/paginated-cache/adapter'
export { RedisPaginatedCache } from '@/lib/paginated-cache/redis-cache'
export {
  autoPaginate,
  cleanupPaginatedCache,
  hydrateCacheReferences,
} from '@/lib/paginated-cache/paginate'
export {
  isPaginatedCacheReference,
  type CachedPage,
  type CacheMetadata,
  type PaginatedCacheReference,
  type ToolPaginationConfig,
} from '@/lib/paginated-cache/types'
