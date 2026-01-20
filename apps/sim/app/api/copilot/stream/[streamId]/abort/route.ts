/**
 * POST /api/copilot/stream/[streamId]/abort
 *
 * Signal the server to abort an active stream.
 * The original request handler will check for this signal and cancel the stream.
 */

import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getStreamMeta, setAbortSignal } from '@/lib/copilot/stream-persistence'

const logger = createLogger('CopilotStreamAbortAPI')

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ streamId: string }> }
) {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { streamId } = await params

  logger.info('Stream abort request', { streamId, userId: session.user.id })

  const meta = await getStreamMeta(streamId)

  if (!meta) {
    logger.info('Stream not found for abort', { streamId })
    return NextResponse.json({ error: 'Stream not found' }, { status: 404 })
  }

  // Verify ownership
  if (meta.userId !== session.user.id) {
    logger.warn('Unauthorized abort attempt', {
      streamId,
      requesterId: session.user.id,
      ownerId: meta.userId,
    })
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Stream already finished
  if (meta.status !== 'streaming') {
    logger.info('Stream already finished, nothing to abort', {
      streamId,
      status: meta.status,
    })
    return NextResponse.json({
      success: true,
      message: 'Stream already finished',
    })
  }

  // Set abort signal in Redis
  await setAbortSignal(streamId)

  logger.info('Abort signal set for stream', { streamId })

  return NextResponse.json({ success: true })
}

