import type { Logger } from '@sim/logger'
import { createLogger } from '@sim/logger'
import { getRedisClient } from '@/lib/core/config/redis'
import { isUserFileWithMetadata } from '@/lib/core/utils/user-file'
import { bufferToBase64 } from '@/lib/uploads/utils/file-utils'
import { downloadFileFromStorage, downloadFileFromUrl } from '@/lib/uploads/utils/file-utils.server'
import type { UserFile } from '@/executor/types'

const DEFAULT_MAX_BASE64_BYTES = 10 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 180000
const DEFAULT_CACHE_TTL_SECONDS = 300
const REDIS_KEY_PREFIX = 'user-file:base64:'

interface Base64Cache {
  get(file: UserFile): Promise<string | null>
  set(file: UserFile, value: string, ttlSeconds: number): Promise<void>
}

interface HydrationState {
  seen: WeakSet<object>
  cache: Base64Cache
  cacheTtlSeconds: number
}

export interface Base64HydrationOptions {
  requestId?: string
  executionId?: string
  logger?: Logger
  maxBytes?: number
  allowUnknownSize?: boolean
  timeoutMs?: number
  cacheTtlSeconds?: number
}

class InMemoryBase64Cache implements Base64Cache {
  private entries = new Map<string, { value: string; expiresAt: number }>()

  async get(file: UserFile): Promise<string | null> {
    const key = getFileCacheKey(file)
    const entry = this.entries.get(key)
    if (!entry) {
      return null
    }
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key)
      return null
    }
    return entry.value
  }

  async set(file: UserFile, value: string, ttlSeconds: number): Promise<void> {
    const key = getFileCacheKey(file)
    const expiresAt = Date.now() + ttlSeconds * 1000
    this.entries.set(key, { value, expiresAt })
  }
}

function createBase64Cache(options: Base64HydrationOptions, logger: Logger): Base64Cache {
  const redis = getRedisClient()
  const { executionId } = options

  if (!redis) {
    logger.warn(
      `[${options.requestId}] Redis unavailable for base64 cache, using in-memory fallback`
    )
    return new InMemoryBase64Cache()
  }

  return {
    async get(file: UserFile) {
      try {
        const key = getFullCacheKey(executionId, file)
        return await redis.get(key)
      } catch (error) {
        logger.warn(`[${options.requestId}] Redis get failed, skipping cache`, error)
        return null
      }
    },
    async set(file: UserFile, value: string, ttlSeconds: number) {
      try {
        const key = getFullCacheKey(executionId, file)
        await redis.set(key, value, 'EX', ttlSeconds)
      } catch (error) {
        logger.warn(`[${options.requestId}] Redis set failed, skipping cache`, error)
      }
    },
  }
}

function createHydrationState(options: Base64HydrationOptions, logger: Logger): HydrationState {
  return {
    seen: new WeakSet<object>(),
    cache: createBase64Cache(options, logger),
    cacheTtlSeconds: options.cacheTtlSeconds ?? DEFAULT_CACHE_TTL_SECONDS,
  }
}

function getHydrationLogger(options: Base64HydrationOptions): Logger {
  return options.logger ?? createLogger('UserFileBase64')
}

function getFileCacheKey(file: UserFile): string {
  if (file.key) {
    return `key:${file.key}`
  }
  if (file.url) {
    return `url:${file.url}`
  }
  return `id:${file.id}`
}

function getFullCacheKey(executionId: string | undefined, file: UserFile): string {
  const fileKey = getFileCacheKey(file)
  if (executionId) {
    return `${REDIS_KEY_PREFIX}exec:${executionId}:${fileKey}`
  }
  return `${REDIS_KEY_PREFIX}${fileKey}`
}

async function resolveBase64(
  file: UserFile,
  options: Base64HydrationOptions,
  logger: Logger
): Promise<string | null> {
  if (file.base64) {
    return file.base64
  }

  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BASE64_BYTES
  const allowUnknownSize = options.allowUnknownSize ?? false
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const hasStableStorageKey = Boolean(file.key)

  if (Number.isFinite(file.size) && file.size > maxBytes) {
    logger.warn(
      `[${options.requestId}] Skipping base64 for ${file.name} (size ${file.size} exceeds ${maxBytes})`
    )
    return null
  }

  if (
    (!Number.isFinite(file.size) || file.size <= 0) &&
    !allowUnknownSize &&
    !hasStableStorageKey
  ) {
    logger.warn(`[${options.requestId}] Skipping base64 for ${file.name} (unknown file size)`)
    return null
  }

  let buffer: Buffer | null = null
  const requestId = options.requestId ?? 'unknown'

  if (file.key) {
    try {
      buffer = await downloadFileFromStorage(file, requestId, logger)
    } catch (error) {
      logger.warn(
        `[${requestId}] Failed to download ${file.name} from storage, trying URL fallback`,
        error
      )
    }
  }

  if (!buffer && file.url) {
    try {
      buffer = await downloadFileFromUrl(file.url, timeoutMs)
    } catch (error) {
      logger.warn(`[${requestId}] Failed to download ${file.name} from URL`, error)
    }
  }

  if (!buffer) {
    return null
  }

  if (buffer.length > maxBytes) {
    logger.warn(
      `[${options.requestId}] Skipping base64 for ${file.name} (downloaded ${buffer.length} exceeds ${maxBytes})`
    )
    return null
  }

  return bufferToBase64(buffer)
}

async function hydrateUserFile(
  file: UserFile,
  options: Base64HydrationOptions,
  state: HydrationState,
  logger: Logger
): Promise<UserFile> {
  const cached = await state.cache.get(file)
  if (cached) {
    return { ...file, base64: cached }
  }

  const base64 = await resolveBase64(file, options, logger)
  if (!base64) {
    return file
  }

  await state.cache.set(file, base64, state.cacheTtlSeconds)
  return { ...file, base64 }
}

async function hydrateValue(
  value: unknown,
  options: Base64HydrationOptions,
  state: HydrationState,
  logger: Logger
): Promise<unknown> {
  if (!value || typeof value !== 'object') {
    return value
  }

  if (isUserFileWithMetadata(value)) {
    return hydrateUserFile(value, options, state, logger)
  }

  if (state.seen.has(value)) {
    return value
  }
  state.seen.add(value)

  if (Array.isArray(value)) {
    const hydratedItems = await Promise.all(
      value.map((item) => hydrateValue(item, options, state, logger))
    )
    return hydratedItems
  }

  const entries = await Promise.all(
    Object.entries(value).map(async ([key, entryValue]) => {
      const hydratedEntry = await hydrateValue(entryValue, options, state, logger)
      return [key, hydratedEntry] as const
    })
  )

  return Object.fromEntries(entries)
}

/**
 * Hydrates UserFile objects within a value to include base64 content.
 * Returns the original structure with UserFile.base64 set where available.
 */
export async function hydrateUserFilesWithBase64(
  value: unknown,
  options: Base64HydrationOptions
): Promise<unknown> {
  const logger = getHydrationLogger(options)
  const state = createHydrationState(options, logger)
  return hydrateValue(value, options, state, logger)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    return false
  }
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/**
 * Checks if a value contains any UserFile objects with metadata.
 */
export function containsUserFileWithMetadata(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false
  }

  if (isUserFileWithMetadata(value)) {
    return true
  }

  if (Array.isArray(value)) {
    return value.some((item) => containsUserFileWithMetadata(item))
  }

  if (!isPlainObject(value)) {
    return false
  }

  return Object.values(value).some((entry) => containsUserFileWithMetadata(entry))
}

/**
 * Cleans up base64 cache entries for a specific execution.
 * Should be called at the end of workflow execution.
 */
export async function cleanupExecutionBase64Cache(executionId: string): Promise<void> {
  const redis = getRedisClient()
  if (!redis) {
    return
  }

  const pattern = `${REDIS_KEY_PREFIX}exec:${executionId}:*`
  const logger = createLogger('UserFileBase64')

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
      logger.info(`Cleaned up ${deletedCount} base64 cache entries for execution ${executionId}`)
    }
  } catch (error) {
    logger.warn(`Failed to cleanup base64 cache for execution ${executionId}`, error)
  }
}
