import { createLogger } from '@sim/logger'
import { getRedisClient } from '@/lib/core/config/redis'
import { RedisPaginatedCache } from '@/lib/paginated-cache/redis-cache'
import { isPaginatedCacheReference } from '@/lib/paginated-cache/types'
import type { PaginatedCacheReference, ToolPaginationConfig } from '@/lib/paginated-cache/types'
import type { ToolResponse } from '@/tools/types'

const logger = createLogger('Paginator')

const DEFAULT_MAX_PAGES = 100

interface AutoPaginateOptions {
  initialResult: ToolResponse
  params: Record<string, unknown>
  paginationConfig: ToolPaginationConfig
  executeTool: (
    toolId: string,
    params: Record<string, unknown>,
    skipPostProcess?: boolean
  ) => Promise<ToolResponse>
  toolId: string
  executionId: string
}

export async function autoPaginate(options: AutoPaginateOptions): Promise<ToolResponse> {
  const { initialResult, params, paginationConfig: config, executeTool, toolId, executionId } =
    options
  const maxPages = config.maxPages ?? DEFAULT_MAX_PAGES

  const redis = getRedisClient()
  if (!redis) {
    throw new Error('Redis is required for auto-pagination but is not available')
  }

  const cache = new RedisPaginatedCache(redis)
  const cacheId = `${executionId}:${toolId}:${config.pageField}:${Date.now()}`

  let totalItems = 0
  let pageIndex = 0
  let lastOutput = initialResult.output

  const initialItems = config.getItems(initialResult.output)
  await cache.storePage(cacheId, pageIndex, initialItems)
  totalItems += initialItems.length
  pageIndex++

  let nextToken = config.getNextPageToken(initialResult.output)
  while (nextToken !== null && pageIndex < maxPages) {
    const nextParams = config.buildNextPageParams(params, nextToken)
    const pageResult = await executeTool(toolId, nextParams, true)

    if (!pageResult.success) {
      throw new Error(
        `Auto-pagination failed on page ${pageIndex}: ${pageResult.error ?? 'Unknown error'}`
      )
    }

    const pageItems = config.getItems(pageResult.output)
    await cache.storePage(cacheId, pageIndex, pageItems)
    totalItems += pageItems.length
    lastOutput = pageResult.output
    pageIndex++

    nextToken = config.getNextPageToken(pageResult.output)
  }

  const totalPages = pageIndex
  const metadata = { cacheId, totalPages, totalItems, pageField: config.pageField }
  await cache.storeMetadata(cacheId, metadata)

  const reference: PaginatedCacheReference = {
    _type: 'paginated_cache_ref',
    cacheId,
    totalPages,
    totalItems,
    pageField: config.pageField,
  }

  logger.info('Auto-pagination complete', { cacheId, totalPages, totalItems, toolId })

  return {
    ...initialResult,
    output: {
      ...lastOutput,
      [config.pageField]: reference,
    },
  }
}

/**
 * Deep-walk inputs and replace any PaginatedCacheReference with hydrated data.
 * No-op if no references found. Throws on any failure.
 */
export async function hydrateCacheReferences(
  inputs: Record<string, unknown>
): Promise<Record<string, unknown>> {
  if (!containsCacheReference(inputs)) {
    return inputs
  }
  return (await deepHydrate(inputs)) as Record<string, unknown>
}

function containsCacheReference(value: unknown): boolean {
  if (isPaginatedCacheReference(value)) return true
  if (Array.isArray(value)) return value.some(containsCacheReference)
  if (typeof value === 'object' && value !== null) {
    return Object.values(value as Record<string, unknown>).some(containsCacheReference)
  }
  return false
}

async function deepHydrate(value: unknown): Promise<unknown> {
  if (isPaginatedCacheReference(value)) {
    return hydrateReference(value)
  }

  if (Array.isArray(value)) {
    return Promise.all(value.map(deepHydrate))
  }

  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
    const hydrated: Record<string, unknown> = {}
    for (const [key, val] of entries) {
      hydrated[key] = await deepHydrate(val)
    }
    return hydrated
  }

  return value
}

async function hydrateReference(ref: PaginatedCacheReference): Promise<unknown[]> {
  const redis = getRedisClient()
  if (!redis) {
    throw new Error(
      `Redis is required to hydrate paginated cache reference (cacheId: ${ref.cacheId}) but is not available`
    )
  }

  const cache = new RedisPaginatedCache(redis)
  const pages = await cache.getAllPages(ref.cacheId, ref.totalPages)

  const items: unknown[] = []
  for (const page of pages) {
    items.push(...page.items)
  }

  logger.info('Hydrated cache reference', {
    cacheId: ref.cacheId,
    totalPages: ref.totalPages,
    totalItems: items.length,
  })

  return items
}

/**
 * Cleans up paginated cache entries for a specific execution.
 * Should be called at the end of workflow execution.
 */
export async function cleanupPaginatedCache(executionId: string): Promise<void> {
  const redis = getRedisClient()
  if (!redis) {
    return
  }

  const pattern = `pagcache:*${executionId}:*`

  try {
    let cursor = '0'
    let deletedCount = 0

    do {
      const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100)
      cursor = nextCursor

      if (keys.length > 0) {
        await redis.del(...keys)
        deletedCount += keys.length
      }
    } while (cursor !== '0')

    if (deletedCount > 0) {
      logger.info(`Cleaned up ${deletedCount} paginated cache entries for execution ${executionId}`)
    }
  } catch (error) {
    logger.warn(`Failed to cleanup paginated cache for execution ${executionId}`, {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
