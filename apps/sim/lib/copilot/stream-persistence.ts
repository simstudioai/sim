/**
 * Stream Persistence Service for Copilot
 *
 * Handles persisting copilot stream state to Redis (ephemeral) and database (permanent).
 * Uses Redis LIST for chunk history and Pub/Sub for live updates (no polling).
 *
 * Redis Key Structure:
 * - copilot:stream:{streamId}:meta    → StreamMeta JSON (TTL: 10 min)
 * - copilot:stream:{streamId}:chunks  → LIST of chunks (for replay)
 * - copilot:stream:{streamId}         → Pub/Sub CHANNEL (for live updates)
 * - copilot:active:{chatId}           → streamId lookup
 * - copilot:abort:{streamId}          → abort signal flag
 */

import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import type Redis from 'ioredis'
import { getRedisClient } from '@/lib/core/config/redis'

const logger = createLogger('CopilotStreamPersistence')

const STREAM_TTL = 60 * 10 // 10 minutes

/**
 * Tool call record stored in stream state
 */
export interface ToolCallRecord {
  id: string
  name: string
  args: Record<string, unknown>
  state: 'pending' | 'executing' | 'success' | 'error' | 'skipped'
  result?: unknown
  error?: string
}

/**
 * Pending diff state for edit_workflow tool calls
 */
export interface PendingDiffState {
  toolCallId: string
  baselineWorkflow: unknown
  proposedWorkflow: unknown
  diffAnalysis: unknown
}

/**
 * Stream metadata stored in Redis
 */
export interface StreamMeta {
  id: string
  status: 'streaming' | 'completed' | 'error'
  chatId: string
  userId: string
  workflowId: string
  userMessageId: string
  isClientSession: boolean
  toolCalls: ToolCallRecord[]
  assistantContent: string
  conversationId?: string
  createdAt: number
  updatedAt: number
  /** Pending diff state if edit_workflow tool has changes waiting for review */
  pendingDiff?: PendingDiffState
}

/**
 * Parameters for creating a new stream
 */
export interface CreateStreamParams {
  streamId: string
  chatId: string
  userId: string
  workflowId: string
  userMessageId: string
  isClientSession: boolean
}

// ============ WRITE OPERATIONS (used by original request handler) ============

/**
 * Create a new stream state in Redis
 */
export async function createStream(params: CreateStreamParams): Promise<void> {
  const redis = getRedisClient()
  if (!redis) {
    logger.warn('Redis not available, stream persistence disabled')
    return
  }

  const meta: StreamMeta = {
    id: params.streamId,
    status: 'streaming',
    chatId: params.chatId,
    userId: params.userId,
    workflowId: params.workflowId,
    userMessageId: params.userMessageId,
    isClientSession: params.isClientSession,
    toolCalls: [],
    assistantContent: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }

  const metaKey = `copilot:stream:${params.streamId}:meta`
  const activeKey = `copilot:active:${params.chatId}`

  await redis.setex(metaKey, STREAM_TTL, JSON.stringify(meta))
  await redis.setex(activeKey, STREAM_TTL, params.streamId)

  logger.info('Created stream state', { streamId: params.streamId, chatId: params.chatId })
}

/**
 * Append a chunk to the stream buffer and publish for live subscribers
 */
export async function appendChunk(streamId: string, chunk: string): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return

  const listKey = `copilot:stream:${streamId}:chunks`
  const channel = `copilot:stream:${streamId}`

  // Push to list for replay, publish for live subscribers
  await redis.rpush(listKey, chunk)
  await redis.expire(listKey, STREAM_TTL)
  await redis.publish(channel, chunk)
}

/**
 * Append content to the accumulated assistant content
 */
export async function appendContent(streamId: string, content: string): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return

  const metaKey = `copilot:stream:${streamId}:meta`
  const raw = await redis.get(metaKey)
  if (!raw) return

  const meta: StreamMeta = JSON.parse(raw)
  meta.assistantContent += content
  meta.updatedAt = Date.now()

  await redis.setex(metaKey, STREAM_TTL, JSON.stringify(meta))
}

/**
 * Update stream metadata
 */
export async function updateMeta(streamId: string, update: Partial<StreamMeta>): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return

  const metaKey = `copilot:stream:${streamId}:meta`
  const raw = await redis.get(metaKey)
  if (!raw) return

  const meta: StreamMeta = { ...JSON.parse(raw), ...update, updatedAt: Date.now() }
  await redis.setex(metaKey, STREAM_TTL, JSON.stringify(meta))
}

/**
 * Update a specific tool call in the stream state
 */
export async function updateToolCall(
  streamId: string,
  toolCallId: string,
  update: Partial<ToolCallRecord>
): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return

  const metaKey = `copilot:stream:${streamId}:meta`
  const raw = await redis.get(metaKey)
  if (!raw) return

  const meta: StreamMeta = JSON.parse(raw)
  const toolCallIndex = meta.toolCalls.findIndex((tc) => tc.id === toolCallId)

  if (toolCallIndex >= 0) {
    meta.toolCalls[toolCallIndex] = { ...meta.toolCalls[toolCallIndex], ...update }
  } else {
    // Add new tool call
    meta.toolCalls.push({
      id: toolCallId,
      name: update.name || 'unknown',
      args: update.args || {},
      state: update.state || 'pending',
      result: update.result,
      error: update.error,
    })
  }

  meta.updatedAt = Date.now()
  await redis.setex(metaKey, STREAM_TTL, JSON.stringify(meta))
}

/**
 * Store pending diff state for a stream (called when edit_workflow creates a diff)
 */
export async function setPendingDiff(
  streamId: string,
  pendingDiff: PendingDiffState
): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return

  const metaKey = `copilot:stream:${streamId}:meta`
  const raw = await redis.get(metaKey)
  if (!raw) return

  const meta: StreamMeta = JSON.parse(raw)
  meta.pendingDiff = pendingDiff
  meta.updatedAt = Date.now()
  await redis.setex(metaKey, STREAM_TTL, JSON.stringify(meta))
  logger.info('Stored pending diff for stream', { streamId, toolCallId: pendingDiff.toolCallId })
}

/**
 * Clear pending diff state (called when user accepts/rejects the diff)
 */
export async function clearPendingDiff(streamId: string): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return

  const metaKey = `copilot:stream:${streamId}:meta`
  const raw = await redis.get(metaKey)
  if (!raw) return

  const meta: StreamMeta = JSON.parse(raw)
  delete meta.pendingDiff
  meta.updatedAt = Date.now()
  await redis.setex(metaKey, STREAM_TTL, JSON.stringify(meta))
  logger.info('Cleared pending diff for stream', { streamId })
}

/**
 * Get pending diff state for a stream
 */
export async function getPendingDiff(streamId: string): Promise<PendingDiffState | null> {
  const redis = getRedisClient()
  if (!redis) return null

  const meta = await getStreamMeta(streamId)
  return meta?.pendingDiff || null
}

/**
 * Complete the stream - save to database and cleanup Redis
 */
export async function completeStream(streamId: string, conversationId?: string): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return

  const meta = await getStreamMeta(streamId)
  if (!meta) return

  // Publish completion event for subscribers
  await redis.publish(`copilot:stream:${streamId}`, JSON.stringify({ type: 'stream_complete' }))

  // Save to database
  await saveToDatabase(meta, conversationId)

  // Cleanup Redis
  await redis.del(`copilot:stream:${streamId}:meta`)
  await redis.del(`copilot:stream:${streamId}:chunks`)
  await redis.del(`copilot:active:${meta.chatId}`)
  await redis.del(`copilot:abort:${streamId}`)

  logger.info('Completed stream', { streamId, chatId: meta.chatId })
}

/**
 * Mark stream as errored and save partial content
 */
export async function errorStream(streamId: string, error: string): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return

  const meta = await getStreamMeta(streamId)
  if (!meta) return

  // Update status
  meta.status = 'error'

  // Publish error event for subscribers
  await redis.publish(
    `copilot:stream:${streamId}`,
    JSON.stringify({ type: 'stream_error', error })
  )

  // Still save what we have to database
  await saveToDatabase(meta)

  // Cleanup Redis
  await redis.del(`copilot:stream:${streamId}:meta`)
  await redis.del(`copilot:stream:${streamId}:chunks`)
  await redis.del(`copilot:active:${meta.chatId}`)
  await redis.del(`copilot:abort:${streamId}`)

  logger.info('Errored stream', { streamId, error })
}

/**
 * Save stream content to database as assistant message
 */
async function saveToDatabase(meta: StreamMeta, conversationId?: string): Promise<void> {
  try {
    const [chat] = await db
      .select()
      .from(copilotChats)
      .where(eq(copilotChats.id, meta.chatId))
      .limit(1)

    if (!chat) {
      logger.warn('Chat not found for stream save', { chatId: meta.chatId })
      return
    }

    const existingMessages = Array.isArray(chat.messages) ? chat.messages : []

    // Check if there's already an assistant message after the user message
    // This can happen if the client already saved it before disconnecting
    const userMessageIndex = existingMessages.findIndex(
      (m: any) => m.id === meta.userMessageId && m.role === 'user'
    )

    // If there's already an assistant message right after the user message,
    // the client may have already saved it - check if it's incomplete
    if (userMessageIndex >= 0 && userMessageIndex < existingMessages.length - 1) {
      const nextMessage = existingMessages[userMessageIndex + 1] as any
      if (nextMessage?.role === 'assistant' && !nextMessage?.serverCompleted) {
        // Client saved a partial message, update it with the complete content
        const updatedMessages = existingMessages.map((m: any, idx: number) => {
          if (idx === userMessageIndex + 1) {
            return {
              ...m,
              content: meta.assistantContent,
              toolCalls: meta.toolCalls,
              serverCompleted: true,
            }
          }
          return m
        })

        await db
          .update(copilotChats)
          .set({
            messages: updatedMessages,
            conversationId: conversationId || (chat.conversationId as string | undefined),
            updatedAt: new Date(),
          })
          .where(eq(copilotChats.id, meta.chatId))

        logger.info('Updated existing assistant message in database', {
          streamId: meta.id,
          chatId: meta.chatId,
        })
        return
      }
    }

    // Build the assistant message
    const assistantMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: meta.assistantContent,
      toolCalls: meta.toolCalls,
      timestamp: new Date().toISOString(),
      serverCompleted: true, // Mark that this was completed server-side
    }

    const updatedMessages = [...existingMessages, assistantMessage]

    await db
      .update(copilotChats)
      .set({
        messages: updatedMessages,
        conversationId: conversationId || (chat.conversationId as string | undefined),
        updatedAt: new Date(),
      })
      .where(eq(copilotChats.id, meta.chatId))

    logger.info('Saved stream to database', {
      streamId: meta.id,
      chatId: meta.chatId,
      contentLength: meta.assistantContent.length,
      toolCallsCount: meta.toolCalls.length,
    })
  } catch (error) {
    logger.error('Failed to save stream to database', { streamId: meta.id, error })
  }
}

// ============ READ OPERATIONS (used by resume handler) ============

/**
 * Get stream metadata
 */
export async function getStreamMeta(streamId: string): Promise<StreamMeta | null> {
  const redis = getRedisClient()
  if (!redis) return null

  const raw = await redis.get(`copilot:stream:${streamId}:meta`)
  return raw ? JSON.parse(raw) : null
}

/**
 * Get chunks from stream history (for replay)
 */
export async function getChunks(streamId: string, fromIndex: number = 0): Promise<string[]> {
  const redis = getRedisClient()
  if (!redis) return []

  const listKey = `copilot:stream:${streamId}:chunks`
  return redis.lrange(listKey, fromIndex, -1)
}

/**
 * Get the number of chunks in the stream
 */
export async function getChunkCount(streamId: string): Promise<number> {
  const redis = getRedisClient()
  if (!redis) return 0

  const listKey = `copilot:stream:${streamId}:chunks`
  return redis.llen(listKey)
}

/**
 * Get active stream ID for a chat (if any)
 */
export async function getActiveStreamForChat(chatId: string): Promise<string | null> {
  const redis = getRedisClient()
  if (!redis) return null

  return redis.get(`copilot:active:${chatId}`)
}

// ============ SUBSCRIPTION (for resume handler) ============

/**
 * Subscribe to live stream updates.
 * Uses Redis Pub/Sub - no polling, fully event-driven.
 *
 * @param streamId - Stream to subscribe to
 * @param onChunk - Callback for each new chunk
 * @param onComplete - Callback when stream completes
 * @param signal - Optional AbortSignal to cancel subscription
 */
export async function subscribeToStream(
  streamId: string,
  onChunk: (chunk: string) => void,
  onComplete: () => void,
  signal?: AbortSignal
): Promise<void> {
  const redis = getRedisClient()
  if (!redis) {
    onComplete()
    return
  }

  // Create a separate Redis connection for subscription
  const subscriber = redis.duplicate()
  const channel = `copilot:stream:${streamId}`

  let isComplete = false

  const cleanup = () => {
    if (!isComplete) {
      isComplete = true
      subscriber.unsubscribe(channel).catch(() => {})
      subscriber.quit().catch(() => {})
    }
  }

  signal?.addEventListener('abort', cleanup)

  await subscriber.subscribe(channel)

  subscriber.on('message', (ch, message) => {
    if (ch !== channel) return

    try {
      const parsed = JSON.parse(message)
      if (parsed.type === 'stream_complete' || parsed.type === 'stream_error') {
        cleanup()
        onComplete()
        return
      }
    } catch {
      // Not a control message, just a chunk
    }

    onChunk(message)
  })

  subscriber.on('error', (err) => {
    logger.error('Subscriber error', { streamId, error: err })
    cleanup()
    onComplete()
  })
}

// ============ ABORT HANDLING ============

/**
 * Set abort signal for a stream.
 * The original request handler should check this and cancel if set.
 */
export async function setAbortSignal(streamId: string): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return

  await redis.setex(`copilot:abort:${streamId}`, 60, '1')
  // Also publish to channel so handler sees it immediately
  await redis.publish(`copilot:stream:${streamId}`, JSON.stringify({ type: 'abort' }))

  logger.info('Set abort signal', { streamId })
}

/**
 * Check if abort signal is set for a stream
 */
export async function checkAbortSignal(streamId: string): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) return false

  const val = await redis.get(`copilot:abort:${streamId}`)
  return val === '1'
}

/**
 * Clear abort signal for a stream
 */
export async function clearAbortSignal(streamId: string): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return

  await redis.del(`copilot:abort:${streamId}`)
}

/**
 * Refresh TTL on all stream keys (call periodically during long streams)
 */
export async function refreshStreamTTL(streamId: string, chatId: string): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return

  await redis.expire(`copilot:stream:${streamId}:meta`, STREAM_TTL)
  await redis.expire(`copilot:stream:${streamId}:chunks`, STREAM_TTL)
  await redis.expire(`copilot:active:${chatId}`, STREAM_TTL)
}

