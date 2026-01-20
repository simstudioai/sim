import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import {
  clearPendingDiff,
  getPendingDiff,
  getStreamMeta,
  setPendingDiff,
} from '@/lib/copilot/stream-persistence'

const logger = createLogger('CopilotPendingDiffAPI')

/**
 * GET /api/copilot/stream/[streamId]/pending-diff
 * Retrieve pending diff state for a stream (used for resumption after page refresh)
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ streamId: string }> }
) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { streamId } = await params
    if (!streamId) {
      return NextResponse.json({ error: 'Stream ID required' }, { status: 400 })
    }

    // Verify user owns this stream
    const meta = await getStreamMeta(streamId)
    if (!meta) {
      return NextResponse.json({ error: 'Stream not found' }, { status: 404 })
    }

    if (meta.userId !== session.user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    // Get pending diff
    const pendingDiff = await getPendingDiff(streamId)

    if (!pendingDiff) {
      return NextResponse.json({ pendingDiff: null })
    }

    logger.info('Retrieved pending diff', {
      streamId,
      toolCallId: pendingDiff.toolCallId,
    })

    return NextResponse.json({ pendingDiff })
  } catch (error) {
    logger.error('Failed to get pending diff', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/copilot/stream/[streamId]/pending-diff
 * Store pending diff state for a stream
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ streamId: string }> }
) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { streamId } = await params
    if (!streamId) {
      return NextResponse.json({ error: 'Stream ID required' }, { status: 400 })
    }

    // Verify user owns this stream
    const meta = await getStreamMeta(streamId)
    if (!meta) {
      return NextResponse.json({ error: 'Stream not found' }, { status: 404 })
    }

    if (meta.userId !== session.user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const body = await request.json()
    const { pendingDiff } = body

    if (!pendingDiff || !pendingDiff.toolCallId) {
      return NextResponse.json({ error: 'Invalid pending diff data' }, { status: 400 })
    }

    await setPendingDiff(streamId, pendingDiff)

    logger.info('Stored pending diff', {
      streamId,
      toolCallId: pendingDiff.toolCallId,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Failed to store pending diff', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/copilot/stream/[streamId]/pending-diff
 * Clear pending diff state for a stream
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ streamId: string }> }
) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { streamId } = await params
    if (!streamId) {
      return NextResponse.json({ error: 'Stream ID required' }, { status: 400 })
    }

    // Verify user owns this stream (if it exists - might already be cleaned up)
    const meta = await getStreamMeta(streamId)
    if (meta && meta.userId !== session.user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    await clearPendingDiff(streamId)

    logger.info('Cleared pending diff', { streamId })

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Failed to clear pending diff', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

