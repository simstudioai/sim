/**
 * GET /api/copilot/stream/[streamId]
 *
 * Resume an active copilot stream.
 * - If stream is still active: returns SSE with replay of missed chunks + live updates via Redis Pub/Sub
 * - If stream is completed: returns JSON indicating to load from database
 * - If stream not found: returns 404
 */

import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import {
  getChunks,
  getStreamMeta,
  subscribeToStream,
} from '@/lib/copilot/stream-persistence'

const logger = createLogger('CopilotStreamResumeAPI')

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ streamId: string }> }
) {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { streamId } = await params
  const fromChunk = parseInt(req.nextUrl.searchParams.get('from') || '0')

  logger.info('Stream resume request', { streamId, fromChunk, userId: session.user.id })

  const meta = await getStreamMeta(streamId)

  if (!meta) {
    logger.info('Stream not found or expired', { streamId })
    return NextResponse.json(
      {
        status: 'not_found',
        message: 'Stream not found or expired. Reload chat from database.',
      },
      { status: 404 }
    )
  }

  // Verify ownership
  if (meta.userId !== session.user.id) {
    logger.warn('Unauthorized stream access attempt', {
      streamId,
      requesterId: session.user.id,
      ownerId: meta.userId,
    })
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Stream completed - tell client to load from database
  if (meta.status === 'completed') {
    logger.info('Stream already completed', { streamId, chatId: meta.chatId })
    return NextResponse.json({
      status: 'completed',
      chatId: meta.chatId,
      message: 'Stream completed. Messages saved to database.',
    })
  }

  // Stream errored
  if (meta.status === 'error') {
    logger.info('Stream encountered error', { streamId, chatId: meta.chatId })
    return NextResponse.json({
      status: 'error',
      chatId: meta.chatId,
      message: 'Stream encountered an error.',
    })
  }

  // Stream still active - return SSE with replay + live updates
  logger.info('Resuming active stream', { streamId, chatId: meta.chatId })

  const encoder = new TextEncoder()
  const abortController = new AbortController()

  // Handle client disconnect
  req.signal.addEventListener('abort', () => {
    logger.info('Client disconnected from resumed stream', { streamId })
    abortController.abort()
  })

  const responseStream = new ReadableStream({
    async start(controller) {
      try {
        // 1. Replay missed chunks (single read from Redis LIST)
        const missedChunks = await getChunks(streamId, fromChunk)
        logger.info('Replaying missed chunks', {
          streamId,
          fromChunk,
          missedChunkCount: missedChunks.length,
        })

        for (const chunk of missedChunks) {
          // Chunks are already in SSE format, just re-encode
          controller.enqueue(encoder.encode(chunk))
        }

        // 2. Subscribe to live chunks via Redis Pub/Sub (blocking, no polling)
        await subscribeToStream(
          streamId,
          (chunk) => {
            try {
              controller.enqueue(encoder.encode(chunk))
            } catch {
              // Client disconnected
              abortController.abort()
            }
          },
          () => {
            // Stream complete - close connection
            logger.info('Stream completed during resume', { streamId })
            try {
              controller.close()
            } catch {
              // Already closed
            }
          },
          abortController.signal
        )
      } catch (error) {
        logger.error('Error in stream resume', {
          streamId,
          error: error instanceof Error ? error.message : String(error),
        })
        try {
          controller.close()
        } catch {
          // Already closed
        }
      }
    },
    cancel() {
      abortController.abort()
    },
  })

  return new Response(responseStream, {
    headers: {
      ...SSE_HEADERS,
      'X-Stream-Id': streamId,
      'X-Chat-Id': meta.chatId,
    },
  })
}

