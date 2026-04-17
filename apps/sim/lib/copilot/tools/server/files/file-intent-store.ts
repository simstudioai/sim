import { createLogger } from '@sim/logger'
import { getRedisClient } from '@/lib/core/config/redis'
import { sleep, toError } from '@/lib/core/utils/helpers'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace/workspace-file-manager'

export type PendingFileIntent = {
  operation: 'append' | 'update' | 'patch'
  fileId: string
  workspaceId: string
  userId: string
  chatId?: string
  messageId?: string
  fileRecord: WorkspaceFileRecord
  existingContent?: string
  edit?: {
    strategy: string
    search?: string
    replaceAll?: boolean
    mode?: string
    occurrence?: number
    before_anchor?: string
    after_anchor?: string
    anchor?: string
    start_anchor?: string
    end_anchor?: string
  }
  contentType?: string
  title?: string
  createdAt: number
}

export type FileIntentScope = {
  chatId?: string
  messageId?: string
}

const logger = createLogger('FileIntentStore')

const INTENT_TTL_MS = 60 * 60 * 1000
const INTENT_TTL_SECONDS = INTENT_TTL_MS / 1000
const REDIS_KEY_PREFIX = 'mothership_file_intent:'
const RETRY_DELAYS_MS = [0, 50, 150] as const
const memoryStore = new Map<string, PendingFileIntent>()

function buildKey(workspaceId: string, fileId: string): string {
  return `${workspaceId}:${fileId}`
}

function getWorkspaceRedisKey(workspaceId: string): string {
  return `${REDIS_KEY_PREFIX}${workspaceId}`
}

function scopeMatches(intent: PendingFileIntent, scope?: FileIntentScope): boolean {
  return intent.chatId === scope?.chatId && intent.messageId === scope?.messageId
}

function buildScopedField(fileId: string, scope?: FileIntentScope): string {
  return `${scope?.chatId ?? ''}:${scope?.messageId ?? ''}:${fileId}`
}

function cleanupStale(): void {
  const now = Date.now()
  for (const [key, intent] of memoryStore) {
    if (now - intent.createdAt > INTENT_TTL_MS) {
      memoryStore.delete(key)
    }
  }
}

async function withRedisRetry<T>(
  operation: string,
  workspaceId: string,
  work: (redis: NonNullable<ReturnType<typeof getRedisClient>>) => Promise<T>
): Promise<T> {
  const redis = getRedisClient()
  if (!redis) {
    throw new Error('Redis client unavailable')
  }

  let lastError: unknown
  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
    const delay = RETRY_DELAYS_MS[attempt]
    if (delay > 0) {
      await sleep(delay)
    }

    try {
      return await work(redis)
    } catch (error) {
      lastError = error
      logger.warn('Redis file intent operation failed', {
        operation,
        workspaceId,
        attempt: attempt + 1,
        error: toError(error).message,
      })
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`${operation} failed`)
}

function isStale(intent: PendingFileIntent): boolean {
  return Date.now() - intent.createdAt > INTENT_TTL_MS
}

function parseIntent(raw: string | null | undefined): PendingFileIntent | undefined {
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw) as PendingFileIntent
    return isStale(parsed) ? undefined : parsed
  } catch (error) {
    logger.warn('Failed to parse file intent', {
      error: toError(error).message,
    })
    return undefined
  }
}

export async function storeFileIntent(
  workspaceId: string,
  fileId: string,
  intent: PendingFileIntent
): Promise<void> {
  const redis = getRedisClient()
  if (!redis) {
    cleanupStale()
    memoryStore.set(buildKey(workspaceId, buildScopedField(fileId, intent)), intent)
    return
  }

  await withRedisRetry('store_file_intent', workspaceId, async (client) => {
    const key = getWorkspaceRedisKey(workspaceId)
    const pipeline = client.pipeline()
    pipeline.hset(key, buildScopedField(fileId, intent), JSON.stringify(intent))
    pipeline.expire(key, INTENT_TTL_SECONDS)
    await pipeline.exec()
  })
}

export async function consumeFileIntent(
  workspaceId: string,
  fileId: string,
  scope?: FileIntentScope
): Promise<PendingFileIntent | undefined> {
  const redis = getRedisClient()
  if (!redis) {
    const key = buildKey(workspaceId, buildScopedField(fileId, scope))
    const intent = memoryStore.get(key)
    if (intent) {
      memoryStore.delete(key)
    }
    return intent
  }

  const raw = await withRedisRetry('consume_file_intent', workspaceId, async (client) => {
    const key = getWorkspaceRedisKey(workspaceId)
    const field = buildScopedField(fileId, scope)
    const value = await client.hget(key, field)
    if (value !== null) {
      await client.hdel(key, field)
    }
    return value
  })
  return parseIntent(raw)
}

export async function peekFileIntent(
  workspaceId: string,
  fileId: string,
  scope?: FileIntentScope
): Promise<PendingFileIntent | undefined> {
  const redis = getRedisClient()
  if (!redis) {
    cleanupStale()
    return memoryStore.get(buildKey(workspaceId, buildScopedField(fileId, scope)))
  }

  const raw = await withRedisRetry('peek_file_intent', workspaceId, async (client) => {
    const key = getWorkspaceRedisKey(workspaceId)
    return client.hget(key, buildScopedField(fileId, scope))
  })
  const intent = parseIntent(raw)
  if (!intent && raw !== null) {
    await withRedisRetry('clear_stale_file_intent', workspaceId, async (client) => {
      await client.hdel(getWorkspaceRedisKey(workspaceId), buildScopedField(fileId, scope))
    })
  }
  return intent
}

export async function consumeLatestFileIntent(
  workspaceId: string,
  scope?: FileIntentScope
): Promise<PendingFileIntent | undefined> {
  const redis = getRedisClient()
  if (!redis) {
    cleanupStale()
    let latest: PendingFileIntent | undefined
    let latestKey: string | undefined
    for (const [key, intent] of memoryStore) {
      if (intent.workspaceId === workspaceId && scopeMatches(intent, scope)) {
        if (!latest || intent.createdAt > latest.createdAt) {
          latest = intent
          latestKey = key
        }
      }
    }
    if (latestKey) {
      memoryStore.delete(latestKey)
    }
    return latest
  }

  const entries = await withRedisRetry('read_workspace_file_intents', workspaceId, async (client) =>
    client.hgetall(getWorkspaceRedisKey(workspaceId))
  )
  let latest: PendingFileIntent | undefined
  let latestField: string | undefined
  const staleFields: string[] = []
  for (const [field, raw] of Object.entries(entries)) {
    const parsed = parseIntent(raw)
    if (!parsed) {
      staleFields.push(field)
      continue
    }
    if (!scopeMatches(parsed, scope)) {
      continue
    }
    if (!latest || parsed.createdAt > latest.createdAt) {
      latest = parsed
      latestField = field
    }
  }

  const fieldsToDelete = latestField ? [...staleFields, latestField] : staleFields
  if (fieldsToDelete.length > 0) {
    await withRedisRetry('delete_workspace_file_intents', workspaceId, async (client) => {
      await client.hdel(getWorkspaceRedisKey(workspaceId), ...fieldsToDelete)
    })
  }
  return latest
}

export async function clearIntentsForWorkspace(
  workspaceId: string,
  scope?: FileIntentScope
): Promise<number> {
  const redis = getRedisClient()
  if (!redis) {
    let cleared = 0
    for (const [key, intent] of memoryStore) {
      if (intent.workspaceId === workspaceId && (!scope || scopeMatches(intent, scope))) {
        memoryStore.delete(key)
        cleared++
      }
    }
    return cleared
  }

  const key = getWorkspaceRedisKey(workspaceId)
  if (!scope) {
    const count = await withRedisRetry(
      'count_workspace_file_intents',
      workspaceId,
      async (client) => client.hlen(key)
    )
    await withRedisRetry('clear_workspace_file_intents', workspaceId, async (client) => {
      await client.del(key)
    })
    return count
  }

  const entries = await withRedisRetry('read_workspace_file_intents', workspaceId, async (client) =>
    client.hgetall(key)
  )
  const fieldsToDelete: string[] = []
  for (const [field, raw] of Object.entries(entries)) {
    const parsed = parseIntent(raw)
    if (parsed && scopeMatches(parsed, scope)) {
      fieldsToDelete.push(field)
    }
  }
  if (fieldsToDelete.length > 0) {
    await withRedisRetry('clear_scoped_file_intents', workspaceId, async (client) => {
      await client.hdel(key, ...fieldsToDelete)
    })
  }
  return fieldsToDelete.length
}
