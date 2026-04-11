export type { PaginatedCacheStorageAdapter } from '@/lib/paginated-cache/adapter'
export {
  autoPaginate,
  cleanupPaginatedCache,
  hydrateCacheReferences,
} from '@/lib/paginated-cache/paginate'
export { RedisPaginatedCache } from '@/lib/paginated-cache/redis-cache'
export {
  type CachedPage,
  type CacheMetadata,
  isPaginatedCacheReference,
  type PaginatedCacheReference,
  type ToolPaginationConfig,
} from '@/lib/paginated-cache/types'
