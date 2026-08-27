import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { getRedisClient } from '@/lib/core/config/redis'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace/workspace-file-manager'

export type PendingFileIntent = {
  operation: 'append' | 'update' | 'patch'
  fileId: string
  workspaceId: string
  userId: string
  chatId?: string
  messageId?: string
  // The invoking file subagent's channel id (its outer tool_use id). Lets
  // apply_file_edit consume the intent for ITS OWN file subagent instead of the
  // latest in the message, so two file agents writing concurrently never cross
  // their content into each other's file.
  channelId?: string
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
  // When set, consumeLatestFileIntent only considers intents from this subagent
  // channel — the key to isolating concurrent file subagents. Omitted by callers
  // that intentionally span the whole message.
  channelId?: string
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

// Channel filter for consume: when a scope carries a channelId, only the
// matching file subagent's intent qualifies. No channelId => message-wide
// (legacy / main-agent) behavior. Deliberately separate from scopeMatches, which
// spans every channel in a message.
function channelMatches(intent: PendingFileIntent, scope?: FileIntentScope): boolean {
  return !scope?.channelId || intent.channelId === scope.channelId
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

const INTENT_WAIT_TIMEOUT_MS = 10_000
const INTENT_WAIT_INTERVAL_MS = 300

/**
 * Bounded wait for the paired prepare_file_edit to stage its intent. The model
 * may batch prepare_file_edit and apply_file_edit into one round, and the Go
 * loop executes same-round tools concurrently — so apply_file_edit can reach
 * this executor before its prepare has run. Failing instantly turns that
 * ordinary race into a model-visible error, a wasted retry round, and a
 * transient "Failed …" state on the chat's shared file row. Polling briefly
 * lets the prepare land and the pair succeed first try; a truly missing
 * prepare still returns undefined once the deadline passes.
 */
export async function waitForLatestFileIntent(
  workspaceId: string,
  scope?: FileIntentScope,
  options?: { timeoutMs?: number; intervalMs?: number }
): Promise<PendingFileIntent | undefined> {
  const timeoutMs = options?.timeoutMs ?? INTENT_WAIT_TIMEOUT_MS
  const intervalMs = options?.intervalMs ?? INTENT_WAIT_INTERVAL_MS
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const intent = await consumeLatestFileIntent(workspaceId, scope)
    if (intent) return intent
    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0) return undefined
    await sleep(Math.min(intervalMs, remainingMs))
  }
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
      if (
        intent.workspaceId === workspaceId &&
        scopeMatches(intent, scope) &&
        channelMatches(intent, scope)
      ) {
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
    if (!scopeMatches(parsed, scope) || !channelMatches(parsed, scope)) {
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
