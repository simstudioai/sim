import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import {
  getStreamMetadata,
  getStreamEvents,
  getStreamEventCount,
  getToolCallStates,
  refreshStreamTTL,
  checkAbortSignal,
  abortStream,
} from '@/lib/copilot/stream-persistence'

const logger = createLogger('StreamResumeAPI')

interface RouteParams {
  streamId: string
}

/**
 * GET /api/copilot/stream/{streamId}
 * Subscribe to or resume a stream
 *
 * Query params:
 * - offset: Start from this event index (for resumption)
 * - mode: 'sse' (default) or 'poll'
 */
export async function GET(req: NextRequest, { params }: { params: Promise<RouteParams> }) {
  const { streamId } = await params
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const metadata = await getStreamMetadata(streamId)
  if (!metadata) {
    return NextResponse.json({ error: 'Stream not found' }, { status: 404 })
  }

  // Verify user owns this stream
  if (metadata.userId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const offset = parseInt(req.nextUrl.searchParams.get('offset') || '0', 10)
  const mode = req.nextUrl.searchParams.get('mode') || 'sse'

  // Refresh TTL since someone is actively consuming
  await refreshStreamTTL(streamId)

  // Poll mode: return current state as JSON
  if (mode === 'poll') {
    const events = await getStreamEvents(streamId, offset)
    const toolCalls = await getToolCallStates(streamId)
    const eventCount = await getStreamEventCount(streamId)

    return NextResponse.json({
      metadata,
      events,
      toolCalls,
      totalEvents: eventCount,
      nextOffset: offset + events.length,
    })
  }

  // SSE mode: stream events
  const encoder = new TextEncoder()

  const readable = new ReadableStream({
    async start(controller) {
      let closed = false

      const safeEnqueue = (data: string) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(data))
        } catch {
          closed = true
        }
      }

      const safeClose = () => {
        if (closed) return
        closed = true
        try {
          controller.close()
        } catch {
          // Already closed
        }
      }

      // Send initial connection event
      safeEnqueue(`: connected\n\n`)

      // Send metadata
      safeEnqueue(`event: metadata\ndata: ${JSON.stringify(metadata)}\n\n`)

      // Send tool call states
      const toolCalls = await getToolCallStates(streamId)
      if (Object.keys(toolCalls).length > 0) {
        safeEnqueue(`event: tool_states\ndata: ${JSON.stringify(toolCalls)}\n\n`)
      }

      // Replay missed events
      const missedEvents = await getStreamEvents(streamId, offset)
      for (const event of missedEvents) {
        safeEnqueue(event)
      }

      // If stream is complete, send done and close
      if (metadata.status === 'complete' || metadata.status === 'error' || metadata.status === 'aborted') {
        safeEnqueue(
          `event: stream_status\ndata: ${JSON.stringify({
            status: metadata.status,
            error: metadata.error,
          })}\n\n`
        )
        safeClose()
        return
      }

      // Stream is still active - poll for new events
      let lastOffset = offset + missedEvents.length
      const pollInterval = 100 // 100ms
      const maxPollTime = 5 * 60 * 1000 // 5 minutes max
      const startTime = Date.now()

      const poll = async () => {
        if (closed) return

        try {
          // Check for timeout
          if (Date.now() - startTime > maxPollTime) {
            logger.info('Stream poll timeout', { streamId })
            safeEnqueue(
              `event: stream_status\ndata: ${JSON.stringify({ status: 'timeout' })}\n\n`
            )
            safeClose()
            return
          }

          // Check if client disconnected
          if (await checkAbortSignal(streamId)) {
            safeEnqueue(
              `event: stream_status\ndata: ${JSON.stringify({ status: 'aborted' })}\n\n`
            )
            safeClose()
            return
          }

          // Get current metadata to check status
          const currentMeta = await getStreamMetadata(streamId)
          if (!currentMeta) {
            safeClose()
            return
          }

          // Get new events
          const newEvents = await getStreamEvents(streamId, lastOffset)
          for (const event of newEvents) {
            safeEnqueue(event)
          }
          lastOffset += newEvents.length

          // Refresh TTL
          await refreshStreamTTL(streamId)

          // If complete, send status and close
          if (
            currentMeta.status === 'complete' ||
            currentMeta.status === 'error' ||
            currentMeta.status === 'aborted'
          ) {
            safeEnqueue(
              `event: stream_status\ndata: ${JSON.stringify({
                status: currentMeta.status,
                error: currentMeta.error,
              })}\n\n`
            )
            safeClose()
            return
          }

          // Continue polling
          setTimeout(poll, pollInterval)
        } catch (error) {
          logger.error('Stream poll error', { streamId, error })
          safeClose()
        }
      }

      // Start polling
      setTimeout(poll, pollInterval)
    },
  })

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Stream-Id': streamId,
    },
  })
}

/**
 * DELETE /api/copilot/stream/{streamId}
 * Abort a stream
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<RouteParams> }) {
  const { streamId } = await params
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const metadata = await getStreamMetadata(streamId)
  if (!metadata) {
    return NextResponse.json({ error: 'Stream not found' }, { status: 404 })
  }

  // Verify user owns this stream
  if (metadata.userId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  await abortStream(streamId)

  logger.info('Stream aborted by user', { streamId, userId: session.user.id })

  return NextResponse.json({ success: true, streamId })
}

