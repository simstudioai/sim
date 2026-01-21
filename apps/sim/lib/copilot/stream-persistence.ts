import { createLogger } from '@sim/logger'
import { getRedisClient } from '@/lib/core/config/redis'

const logger = createLogger('StreamPersistence')

const STREAM_PREFIX = 'copilot:stream:'
const STREAM_TTL = 60 * 60 * 24 // 24 hours

export type StreamStatus = 'pending' | 'streaming' | 'complete' | 'error' | 'aborted'

export interface StreamMetadata {
  streamId: string
  chatId: string
  userId: string
  workflowId: string
  userMessageId: string
  assistantMessageId?: string
  status: StreamStatus
  isClientSession: boolean
  createdAt: number
  updatedAt: number
  completedAt?: number
  error?: string
}

export interface ToolCallState {
  id: string
  name: string
  args: Record<string, unknown>
  state: 'pending' | 'executing' | 'success' | 'error'
  result?: unknown
  error?: string
}

/**
 * Initialize a new stream in Redis
 */
export async function createStream(params: {
  streamId: string
  chatId: string
  userId: string
  workflowId: string
  userMessageId: string
  isClientSession: boolean
}): Promise<void> {
  const redis = getRedisClient()
  if (!redis) {
    logger.warn('Redis not available, stream will not be resumable')
    return
  }

  const metadata: StreamMetadata = {
    ...params,
    status: 'pending',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }

  const key = `${STREAM_PREFIX}${params.streamId}:meta`
  await redis.set(key, JSON.stringify(metadata), 'EX', STREAM_TTL)

  logger.info('Stream created', { streamId: params.streamId })
}

/**
 * Update stream status
 */
export async function updateStreamStatus(
  streamId: string,
  status: StreamStatus,
  error?: string
): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return

  const key = `${STREAM_PREFIX}${streamId}:meta`
  const data = await redis.get(key)
  if (!data) return

  const metadata: StreamMetadata = JSON.parse(data)
  metadata.status = status
  metadata.updatedAt = Date.now()
  if (status === 'complete' || status === 'error') {
    metadata.completedAt = Date.now()
  }
  if (error) {
    metadata.error = error
  }

  await redis.set(key, JSON.stringify(metadata), 'EX', STREAM_TTL)
}

/**
 * Update stream metadata with additional fields
 */
export async function updateStreamMetadata(
  streamId: string,
  updates: Partial<StreamMetadata>
): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return

  const key = `${STREAM_PREFIX}${streamId}:meta`
  const data = await redis.get(key)
  if (!data) return

  const metadata: StreamMetadata = JSON.parse(data)
  Object.assign(metadata, updates, { updatedAt: Date.now() })

  await redis.set(key, JSON.stringify(metadata), 'EX', STREAM_TTL)
}

/**
 * Append a serialized SSE event chunk to the stream
 */
export async function appendChunk(streamId: string, chunk: string): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return

  const key = `${STREAM_PREFIX}${streamId}:events`
  await redis.rpush(key, chunk)
  await redis.expire(key, STREAM_TTL)
}

/**
 * Append text content (for quick content retrieval without parsing events)
 */
export async function appendContent(streamId: string, content: string): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return

  const key = `${STREAM_PREFIX}${streamId}:content`
  await redis.append(key, content)
  await redis.expire(key, STREAM_TTL)
}

/**
 * Update tool call state
 */
export async function updateToolCall(
  streamId: string,
  toolCallId: string,
  update: Partial<ToolCallState>
): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return

  const key = `${STREAM_PREFIX}${streamId}:tools`
  const existing = await redis.hget(key, toolCallId)
  const current: ToolCallState = existing
    ? JSON.parse(existing)
    : { id: toolCallId, name: '', args: {}, state: 'pending' }

  const updated = { ...current, ...update }
  await redis.hset(key, toolCallId, JSON.stringify(updated))
  await redis.expire(key, STREAM_TTL)
}

/**
 * Mark stream as complete
 */
export async function completeStream(streamId: string, result?: unknown): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return

  await updateStreamStatus(streamId, 'complete')

  if (result !== undefined) {
    const key = `${STREAM_PREFIX}${streamId}:result`
    await redis.set(key, JSON.stringify(result), 'EX', STREAM_TTL)
  }

  logger.info('Stream completed', { streamId })
}

/**
 * Mark stream as errored
 */
export async function errorStream(streamId: string, error: string): Promise<void> {
  await updateStreamStatus(streamId, 'error', error)
  logger.error('Stream errored', { streamId, error })
}

/**
 * Check if stream was aborted (client requested abort)
 */
export async function checkAbortSignal(streamId: string): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) return false

  const key = `${STREAM_PREFIX}${streamId}:abort`
  const aborted = await redis.exists(key)
  return aborted === 1
}

/**
 * Signal stream abort
 */
export async function abortStream(streamId: string): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return

  await redis.set(`${STREAM_PREFIX}${streamId}:abort`, '1', 'EX', STREAM_TTL)
  await updateStreamStatus(streamId, 'aborted')
  logger.info('Stream aborted', { streamId })
}

/**
 * Refresh TTL on all stream keys
 */
export async function refreshStreamTTL(streamId: string): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return

  const keys = [
    `${STREAM_PREFIX}${streamId}:meta`,
    `${STREAM_PREFIX}${streamId}:events`,
    `${STREAM_PREFIX}${streamId}:content`,
    `${STREAM_PREFIX}${streamId}:tools`,
    `${STREAM_PREFIX}${streamId}:result`,
  ]

  for (const key of keys) {
    await redis.expire(key, STREAM_TTL)
  }
}

/**
 * Get stream metadata
 */
export async function getStreamMetadata(streamId: string): Promise<StreamMetadata | null> {
  const redis = getRedisClient()
  if (!redis) return null

  const data = await redis.get(`${STREAM_PREFIX}${streamId}:meta`)
  return data ? JSON.parse(data) : null
}

/**
 * Get stream events from offset (for resumption)
 */
export async function getStreamEvents(streamId: string, fromOffset: number = 0): Promise<string[]> {
  const redis = getRedisClient()
  if (!redis) return []

  const key = `${STREAM_PREFIX}${streamId}:events`
  return redis.lrange(key, fromOffset, -1)
}

/**
 * Get current event count (for client to know where it is)
 */
export async function getStreamEventCount(streamId: string): Promise<number> {
  const redis = getRedisClient()
  if (!redis) return 0

  const key = `${STREAM_PREFIX}${streamId}:events`
  return redis.llen(key)
}

/**
 * Get all tool call states
 */
export async function getToolCallStates(streamId: string): Promise<Record<string, ToolCallState>> {
  const redis = getRedisClient()
  if (!redis) return {}

  const key = `${STREAM_PREFIX}${streamId}:tools`
  const data = await redis.hgetall(key)

  const result: Record<string, ToolCallState> = {}
  for (const [id, json] of Object.entries(data)) {
    result[id] = JSON.parse(json)
  }
  return result
}

/**
 * Get accumulated content
 */
export async function getStreamContent(streamId: string): Promise<string> {
  const redis = getRedisClient()
  if (!redis) return ''

  const key = `${STREAM_PREFIX}${streamId}:content`
  return (await redis.get(key)) || ''
}

/**
 * Get final result (if complete)
 */
export async function getStreamResult(streamId: string): Promise<unknown | null> {
  const redis = getRedisClient()
  if (!redis) return null

  const key = `${STREAM_PREFIX}${streamId}:result`
  const data = await redis.get(key)
  return data ? JSON.parse(data) : null
}

/**
 * Check if Redis is available for stream persistence
 */
export function isStreamPersistenceEnabled(): boolean {
  return getRedisClient() !== null
}

/**
 * Delete all stream data (cleanup)
 */
export async function deleteStream(streamId: string): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return

  const keys = [
    `${STREAM_PREFIX}${streamId}:meta`,
    `${STREAM_PREFIX}${streamId}:events`,
    `${STREAM_PREFIX}${streamId}:content`,
    `${STREAM_PREFIX}${streamId}:tools`,
    `${STREAM_PREFIX}${streamId}:result`,
    `${STREAM_PREFIX}${streamId}:abort`,
  ]

  await redis.del(...keys)
  logger.info('Stream deleted', { streamId })
}

