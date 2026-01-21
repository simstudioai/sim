'use client'

import { createLogger } from '@sim/logger'

const logger = createLogger('StreamClient')

export interface StreamMetadata {
  streamId: string
  chatId: string
  userId: string
  workflowId: string
  userMessageId: string
  assistantMessageId?: string
  status: 'pending' | 'streaming' | 'complete' | 'error' | 'aborted'
  isClientSession: boolean
  createdAt: number
  updatedAt: number
  completedAt?: number
  error?: string
}

export interface StreamResumeResponse {
  metadata: StreamMetadata
  events: string[]
  toolCalls: Record<string, unknown>
  totalEvents: number
  nextOffset: number
}

const STREAM_ID_STORAGE_KEY = 'copilot:activeStream'
const RECONNECT_DELAY_MS = 1000
const MAX_RECONNECT_ATTEMPTS = 5

/**
 * Store active stream info for potential resumption
 */
export function storeActiveStream(
  chatId: string,
  streamId: string,
  messageId: string
): void {
  try {
    const data = { chatId, streamId, messageId, storedAt: Date.now() }
    sessionStorage.setItem(STREAM_ID_STORAGE_KEY, JSON.stringify(data))
    logger.info('Stored active stream for potential resumption', { streamId, chatId })
  } catch {
    // Session storage not available
  }
}

/**
 * Get stored active stream if one exists
 */
export function getStoredActiveStream(): {
  chatId: string
  streamId: string
  messageId: string
  storedAt: number
} | null {
  try {
    const data = sessionStorage.getItem(STREAM_ID_STORAGE_KEY)
    if (!data) return null
    return JSON.parse(data)
  } catch {
    return null
  }
}

/**
 * Clear stored active stream
 */
export function clearStoredActiveStream(): void {
  try {
    sessionStorage.removeItem(STREAM_ID_STORAGE_KEY)
  } catch {
    // Session storage not available
  }
}

/**
 * Check if a stream is still active
 */
export async function checkStreamStatus(streamId: string): Promise<StreamMetadata | null> {
  try {
    const response = await fetch(`/api/copilot/stream/${streamId}?mode=poll&offset=0`)
    if (!response.ok) {
      if (response.status === 404) {
        // Stream not found or expired
        return null
      }
      throw new Error(`Failed to check stream status: ${response.statusText}`)
    }
    const data: StreamResumeResponse = await response.json()
    return data.metadata
  } catch (error) {
    logger.error('Failed to check stream status', { streamId, error })
    return null
  }
}

/**
 * Resume a stream from a given offset using SSE
 */
export async function resumeStream(
  streamId: string,
  offset: number = 0
): Promise<ReadableStream<Uint8Array> | null> {
  try {
    const response = await fetch(`/api/copilot/stream/${streamId}?mode=sse&offset=${offset}`)
    if (!response.ok || !response.body) {
      if (response.status === 404) {
        logger.info('Stream not found for resumption', { streamId })
        clearStoredActiveStream()
        return null
      }
      throw new Error(`Failed to resume stream: ${response.statusText}`)
    }

    logger.info('Stream resumption started', { streamId, offset })
    return response.body
  } catch (error) {
    logger.error('Failed to resume stream', { streamId, error })
    return null
  }
}

/**
 * Abort a stream
 */
export async function abortStream(streamId: string): Promise<boolean> {
  try {
    const response = await fetch(`/api/copilot/stream/${streamId}`, {
      method: 'DELETE',
    })
    if (!response.ok && response.status !== 404) {
      throw new Error(`Failed to abort stream: ${response.statusText}`)
    }
    clearStoredActiveStream()
    return true
  } catch (error) {
    logger.error('Failed to abort stream', { streamId, error })
    return false
  }
}

export interface StreamSubscription {
  unsubscribe: () => void
  getStreamId: () => string
}

export interface StreamEventHandler {
  onEvent: (event: { type: string; data: Record<string, unknown> }) => void
  onError?: (error: Error) => void
  onComplete?: () => void
}

/**
 * Subscribe to a stream (new or resumed) and process events
 * This provides a unified interface for both initial streams and resumed streams
 */
export function subscribeToStream(
  streamBody: ReadableStream<Uint8Array>,
  handlers: StreamEventHandler
): StreamSubscription {
  const reader = streamBody.getReader()
  const decoder = new TextDecoder()
  let cancelled = false
  let buffer = ''
  let streamId = ''

  const processEvents = async () => {
    try {
      while (!cancelled) {
        const { done, value } = await reader.read()
        if (done || cancelled) break

        buffer += decoder.decode(value, { stream: true })

        // Process complete SSE messages
        const messages = buffer.split('\n\n')
        buffer = messages.pop() || ''

        for (const message of messages) {
          if (!message.trim()) continue
          if (message.startsWith(':')) continue // SSE comment (ping)

          // Parse SSE format
          const lines = message.split('\n')
          let eventType = 'message'
          let data: Record<string, unknown> = {}

          for (const line of lines) {
            if (line.startsWith('event: ')) {
              eventType = line.slice(7)
            } else if (line.startsWith('data: ')) {
              try {
                data = JSON.parse(line.slice(6))
              } catch {
                data = { raw: line.slice(6) }
              }
            }
          }

          // Track stream ID if provided in metadata
          if (eventType === 'metadata' && data.streamId) {
            streamId = data.streamId as string
          }

          handlers.onEvent({ type: eventType, data })

          // Check for terminal events
          if (eventType === 'stream_status') {
            const status = data.status as string
            if (status === 'complete' || status === 'error' || status === 'aborted') {
              if (status === 'error' && handlers.onError) {
                handlers.onError(new Error(data.error as string || 'Stream error'))
              }
              if (handlers.onComplete) {
                handlers.onComplete()
              }
              clearStoredActiveStream()
              return
            }
          }
        }
      }

      // Stream ended without explicit status
      if (handlers.onComplete) {
        handlers.onComplete()
      }
    } catch (error) {
      if (!cancelled && handlers.onError) {
        handlers.onError(error instanceof Error ? error : new Error(String(error)))
      }
    } finally {
      reader.releaseLock()
    }
  }

  // Start processing
  processEvents()

  return {
    unsubscribe: () => {
      cancelled = true
      reader.cancel().catch(() => {})
      clearStoredActiveStream()
    },
    getStreamId: () => streamId,
  }
}

/**
 * Attempt to resume any active stream from session storage
 * Returns handlers if resumption is possible, null otherwise
 */
export async function attemptStreamResumption(): Promise<{
  stream: ReadableStream<Uint8Array>
  metadata: StreamMetadata
  offset: number
} | null> {
  const stored = getStoredActiveStream()
  if (!stored) return null

  // Check if stream is still valid (not too old)
  const maxAge = 5 * 60 * 1000 // 5 minutes
  if (Date.now() - stored.storedAt > maxAge) {
    clearStoredActiveStream()
    return null
  }

  // Check stream status
  const metadata = await checkStreamStatus(stored.streamId)
  if (!metadata) {
    clearStoredActiveStream()
    return null
  }

  // Only resume if stream is still active
  if (metadata.status !== 'streaming' && metadata.status !== 'pending') {
    clearStoredActiveStream()
    return null
  }

  // Get the stream
  const stream = await resumeStream(stored.streamId, 0)
  if (!stream) {
    return null
  }

  logger.info('Stream resumption possible', {
    streamId: stored.streamId,
    status: metadata.status,
  })

  return { stream, metadata, offset: 0 }
}

