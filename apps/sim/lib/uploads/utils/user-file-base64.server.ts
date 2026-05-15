import type { Logger } from '@sim/logger'
import { createLogger } from '@sim/logger'
import { getRedisClient } from '@/lib/core/config/redis'
import { isUserFileWithMetadata } from '@/lib/core/utils/user-file'
import { LARGE_VALUE_THRESHOLD_BYTES } from '@/lib/execution/payloads/large-value-ref'
import {
  assertUserFileContentAccess,
  readUserFileContent,
} from '@/lib/execution/payloads/materialization.server'
import {
  type ExecutionRedisBudgetReservation,
  getExecutionRedisBudgetKeys,
  getExecutionRedisBudgetLimits,
} from '@/lib/execution/redis-budget.server'
import {
  ExecutionResourceLimitError,
  isExecutionResourceLimitError,
} from '@/lib/execution/resource-errors'
import type { UserFile } from '@/executor/types'

const INLINE_BASE64_JSON_OVERHEAD_BYTES = 512 * 1024
const DEFAULT_MAX_BASE64_BYTES = Math.floor(
  (LARGE_VALUE_THRESHOLD_BYTES - INLINE_BASE64_JSON_OVERHEAD_BYTES) * 0.75
)
const DEFAULT_CACHE_TTL_SECONDS = 300
const REDIS_KEY_PREFIX = 'user-file:base64:'
const REDIS_BUDGET_KEY_PREFIX = 'user-file:base64-budget:'
const CLEANUP_BASE64_CACHE_ENTRY_SCRIPT = `
local file_key = ARGV[1]
local expected_entry = ARGV[2]
local bytes = tonumber(ARGV[3])
local budget_ttl_seconds = tonumber(ARGV[4])
local current_entry = redis.call('HGET', KEYS[1], file_key)
if not current_entry or current_entry ~= expected_entry then
  return {0, 0}
end
local deleted = redis.call('DEL', KEYS[2])
redis.call('HDEL', KEYS[1], file_key)
if bytes and bytes > 0 then
  local execution_next = redis.call('DECRBY', KEYS[3], bytes)
  if execution_next <= 0 then
    redis.call('DEL', KEYS[3])
  else
    redis.call('EXPIRE', KEYS[3], budget_ttl_seconds)
  end
  if #KEYS >= 4 then
    local user_next = redis.call('DECRBY', KEYS[4], bytes)
    if user_next <= 0 then
      redis.call('DEL', KEYS[4])
    else
      redis.call('EXPIRE', KEYS[4], budget_ttl_seconds)
    end
  end
end
if redis.call('HLEN', KEYS[1]) == 0 then
  redis.call('DEL', KEYS[1])
end
return {1, deleted}
`
const SET_BASE64_CACHE_SCRIPT = `
local value = ARGV[1]
local cache_ttl_seconds = tonumber(ARGV[2])
local file_key = ARGV[3]
local next_entry = ARGV[4]
local next_bytes = tonumber(ARGV[5])
local execution_limit = tonumber(ARGV[6])
local user_limit = tonumber(ARGV[7])
local budget_ttl_seconds = tonumber(ARGV[8])
local previous_entry = redis.call('HGET', KEYS[2], file_key)
local previous_bytes = 0
if previous_entry then
  local parsed_previous_bytes = string.match(previous_entry, '"bytes"%s*:%s*(%d+)')
  if parsed_previous_bytes then
    previous_bytes = tonumber(parsed_previous_bytes)
  end
end
local execution_current_raw = redis.call('GET', KEYS[3])
local execution_current = tonumber(execution_current_raw or '0')
local execution_delta = next_bytes - previous_bytes
if not execution_current_raw then
  execution_delta = next_bytes
end
if execution_delta > 0 and execution_limit > 0 and execution_current + execution_delta > execution_limit then
  return {0, 'execution_redis_bytes', execution_current}
end
local user_delta = 0
local user_current = 0
local user_current_raw = nil
if #KEYS >= 4 then
  user_current_raw = redis.call('GET', KEYS[4])
  user_current = tonumber(user_current_raw or '0')
  user_delta = next_bytes - previous_bytes
  if not user_current_raw then
    user_delta = next_bytes
  end
  if user_delta > 0 and user_limit > 0 and user_current + user_delta > user_limit then
    return {0, 'user_redis_bytes', user_current}
  end
end
if execution_delta > 0 then
  redis.call('INCRBY', KEYS[3], execution_delta)
elseif execution_delta < 0 and execution_current_raw then
  local execution_next = redis.call('DECRBY', KEYS[3], -execution_delta)
  if execution_next <= 0 then
    redis.call('DEL', KEYS[3])
  end
end
if redis.call('EXISTS', KEYS[3]) == 1 then
  redis.call('EXPIRE', KEYS[3], budget_ttl_seconds)
end
if #KEYS >= 4 then
  if user_delta > 0 then
    redis.call('INCRBY', KEYS[4], user_delta)
  elseif user_delta < 0 and user_current_raw then
    local user_next = redis.call('DECRBY', KEYS[4], -user_delta)
    if user_next <= 0 then
      redis.call('DEL', KEYS[4])
    end
  end
  if redis.call('EXISTS', KEYS[4]) == 1 then
    redis.call('EXPIRE', KEYS[4], budget_ttl_seconds)
  end
end
redis.call('SET', KEYS[1], value, 'EX', cache_ttl_seconds)
redis.call('HSET', KEYS[2], file_key, next_entry)
redis.call('EXPIRE', KEYS[2], cache_ttl_seconds)
return {1, 'ok', execution_delta, user_delta}
`

interface Base64BudgetEntry {
  bytes: number
  userId?: string
}

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
  workspaceId?: string
  workflowId?: string
  executionId?: string
  largeValueExecutionIds?: string[]
  allowLargeValueWorkflowScope?: boolean
  userId?: string
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
      const key = getFullCacheKey(executionId, file)
      const valueBytes = Buffer.byteLength(value, 'utf8')
      try {
        if (!executionId) {
          await redis.set(key, value, 'EX', ttlSeconds)
          return
        }

        const limits = getExecutionRedisBudgetLimits()
        if (valueBytes > limits.maxSingleWriteBytes) {
          throw new ExecutionResourceLimitError({
            resource: 'redis_key_bytes',
            attemptedBytes: valueBytes,
            limitBytes: limits.maxSingleWriteBytes,
          })
        }
        const cacheTtlSeconds = Math.max(ttlSeconds, limits.ttlSeconds)
        const budgetReservation: ExecutionRedisBudgetReservation = {
          executionId,
          userId: options.userId,
          category: 'base64_cache',
          operation: 'set_base64_cache',
          bytes: valueBytes,
          logger,
        }
        const budgetKeys = getExecutionRedisBudgetKeys(budgetReservation)
        const result = (await redis.eval(
          SET_BASE64_CACHE_SCRIPT,
          2 + budgetKeys.length,
          key,
          getBudgetIndexKey(executionId),
          ...budgetKeys,
          value,
          cacheTtlSeconds,
          getFileCacheKey(file),
          serializeBudgetEntry({ bytes: valueBytes, userId: options.userId }),
          valueBytes,
          limits.maxExecutionBytes,
          limits.maxUserBytes,
          limits.ttlSeconds
        )) as [number, string, number | string | null]
        const [allowed, resource, current] = result
        if (allowed !== 1) {
          throw new ExecutionResourceLimitError({
            resource:
              resource === 'user_redis_bytes' ? 'user_redis_bytes' : 'execution_redis_bytes',
            attemptedBytes: valueBytes,
            currentBytes: Number(current ?? 0),
            limitBytes:
              resource === 'user_redis_bytes' ? limits.maxUserBytes : limits.maxExecutionBytes,
          })
        }
      } catch (error) {
        if (isExecutionResourceLimitError(error)) {
          throw error
        }
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

function getBudgetIndexKey(executionId: string): string {
  return `${REDIS_BUDGET_KEY_PREFIX}exec:${executionId}`
}

function serializeBudgetEntry(entry: Base64BudgetEntry): string {
  return JSON.stringify(entry)
}

function parseBudgetEntry(value: unknown): Base64BudgetEntry | null {
  if (typeof value !== 'string') {
    return null
  }
  try {
    const parsed = JSON.parse(value) as Partial<Base64BudgetEntry>
    if (typeof parsed.bytes !== 'number' || !Number.isFinite(parsed.bytes) || parsed.bytes <= 0) {
      return null
    }
    return {
      bytes: parsed.bytes,
      userId: typeof parsed.userId === 'string' ? parsed.userId : undefined,
    }
  } catch {
    return null
  }
}

async function cleanupBudgetEntry(
  redis: NonNullable<ReturnType<typeof getRedisClient>>,
  executionId: string,
  fileKey: string,
  rawEntry: string,
  entry: Base64BudgetEntry
): Promise<{ claimed: boolean; deletedCount: number }> {
  const limits = getExecutionRedisBudgetLimits()
  const budgetReservation: ExecutionRedisBudgetReservation = {
    executionId,
    userId: entry.userId,
    category: 'base64_cache',
    operation: 'cleanup_base64_cache',
    bytes: entry.bytes,
  }
  const budgetKeys = getExecutionRedisBudgetKeys(budgetReservation)
  const result = (await redis.eval(
    CLEANUP_BASE64_CACHE_ENTRY_SCRIPT,
    2 + budgetKeys.length,
    getBudgetIndexKey(executionId),
    `${REDIS_KEY_PREFIX}exec:${executionId}:${fileKey}`,
    ...budgetKeys,
    fileKey,
    rawEntry,
    entry.bytes,
    limits.ttlSeconds
  )) as [number, number]
  return { claimed: Number(result[0]) === 1, deletedCount: Number(result[1] ?? 0) }
}

function stripBase64(file: UserFile): UserFile {
  const { base64: _base64, ...rest } = file
  return rest
}

async function resolveBase64(
  file: UserFile,
  options: Base64HydrationOptions,
  logger: Logger
): Promise<string | null> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BASE64_BYTES

  if (file.base64) {
    const base64Bytes = Buffer.byteLength(file.base64, 'base64')
    if (base64Bytes > maxBytes) {
      logger.warn(
        `[${options.requestId}] Skipping existing base64 for ${file.name} (decoded ${base64Bytes} exceeds ${maxBytes})`
      )
      return null
    }
    return file.base64
  }

  const allowUnknownSize = options.allowUnknownSize ?? false
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

  const requestId = options.requestId ?? 'unknown'
  try {
    return await readUserFileContent(file, {
      requestId,
      workspaceId: options.workspaceId,
      workflowId: options.workflowId,
      executionId: options.executionId,
      largeValueExecutionIds: options.largeValueExecutionIds,
      allowLargeValueWorkflowScope: options.allowLargeValueWorkflowScope,
      userId: options.userId,
      encoding: 'base64',
      maxBytes,
      maxSourceBytes: maxBytes,
    })
  } catch (error) {
    logger.warn(`[${requestId}] Failed to hydrate base64 for ${file.name}`, error)
    return null
  }
}

async function hydrateUserFile(
  file: UserFile,
  options: Base64HydrationOptions,
  state: HydrationState,
  logger: Logger
): Promise<UserFile> {
  if (!file.base64) {
    try {
      await assertUserFileContentAccess(file, {
        requestId: options.requestId,
        workspaceId: options.workspaceId,
        workflowId: options.workflowId,
        executionId: options.executionId,
        largeValueExecutionIds: options.largeValueExecutionIds,
        allowLargeValueWorkflowScope: options.allowLargeValueWorkflowScope,
        userId: options.userId,
        logger,
      })
    } catch (error) {
      logger.warn(`[${options.requestId ?? 'unknown'}] Skipping unauthorized file base64`, error)
      return stripBase64(file)
    }
  }

  const cached = await state.cache.get(file)
  if (cached) {
    const maxBytes = options.maxBytes ?? DEFAULT_MAX_BASE64_BYTES
    if (Buffer.byteLength(cached, 'base64') > maxBytes) {
      return stripBase64(file)
    }
    return { ...file, base64: cached }
  }

  const base64 = await resolveBase64(file, options, logger)
  if (!base64) {
    return stripBase64(file)
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
export async function hydrateUserFilesWithBase64<T>(
  value: T,
  options: Base64HydrationOptions
): Promise<T> {
  const logger = getHydrationLogger(options)
  const state = createHydrationState(options, logger)
  return (await hydrateValue(value, options, state, logger)) as T
}

/**
 * Hydrates a single UserFile object when a resolver explicitly asks for base64.
 */
export async function hydrateUserFileWithBase64(
  file: UserFile,
  options: Base64HydrationOptions
): Promise<UserFile> {
  const logger = getHydrationLogger(options)
  const state = createHydrationState(options, logger)
  return hydrateUserFile(file, options, state, logger)
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

  const logger = createLogger('UserFileBase64')

  try {
    const budgetEntries = await redis.hgetall(getBudgetIndexKey(executionId))
    let deletedCount = 0
    for (const [fileKey, rawEntry] of Object.entries(budgetEntries ?? {})) {
      const budgetEntry = parseBudgetEntry(rawEntry)
      if (!budgetEntry) continue
      const cleanupResult = await cleanupBudgetEntry(
        redis,
        executionId,
        fileKey,
        rawEntry,
        budgetEntry
      )
      if (cleanupResult.claimed) {
        deletedCount += cleanupResult.deletedCount
      }
    }

    if (deletedCount > 0) {
      logger.info(`Cleaned up ${deletedCount} base64 cache entries for execution ${executionId}`)
    }
  } catch (error) {
    logger.warn(`Failed to cleanup base64 cache for execution ${executionId}`, error)
  }
}
