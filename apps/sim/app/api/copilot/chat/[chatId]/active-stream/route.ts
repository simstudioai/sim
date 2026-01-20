/**
 * GET /api/copilot/chat/[chatId]/active-stream
 *
 * Check if a chat has an active stream that can be resumed.
 * Used by the client on page load to detect if there's an in-progress stream.
 */

import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import {
  getActiveStreamForChat,
  getChunkCount,
  getStreamMeta,
} from '@/lib/copilot/stream-persistence'

const logger = createLogger('CopilotActiveStreamAPI')

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ chatId: string }> }
) {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { chatId } = await params

  logger.info('Active stream check', { chatId, userId: session.user.id })

  // Look up active stream ID from Redis
  const streamId = await getActiveStreamForChat(chatId)

  if (!streamId) {
    logger.debug('No active stream found', { chatId })
    return NextResponse.json({ hasActiveStream: false })
  }

  // Get stream metadata
  const meta = await getStreamMeta(streamId)

  if (!meta) {
    logger.debug('Stream metadata not found', { streamId, chatId })
    return NextResponse.json({ hasActiveStream: false })
  }

  // Verify the stream is still active
  if (meta.status !== 'streaming') {
    logger.debug('Stream not active', { streamId, chatId, status: meta.status })
    return NextResponse.json({ hasActiveStream: false })
  }

  // Verify ownership
  if (meta.userId !== session.user.id) {
    logger.warn('Stream belongs to different user', {
      streamId,
      chatId,
      requesterId: session.user.id,
      ownerId: meta.userId,
    })
    return NextResponse.json({ hasActiveStream: false })
  }

  // Get current chunk count for client to track progress
  const chunkCount = await getChunkCount(streamId)

  logger.info('Active stream found', {
    streamId,
    chatId,
    chunkCount,
    toolCallsCount: meta.toolCalls.length,
  })

  return NextResponse.json({
    hasActiveStream: true,
    streamId,
    chunkCount,
    toolCalls: meta.toolCalls.filter(
      (tc) => tc.state === 'pending' || tc.state === 'executing'
    ),
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
  })
}

