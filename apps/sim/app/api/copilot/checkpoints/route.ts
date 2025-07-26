import { and, desc, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { db } from '@/db'
import { copilotCheckpoints } from '@/db/schema'

const logger = createLogger('CopilotCheckpointsAPI')

/**
 * GET /api/copilot/checkpoints
 * List checkpoints for a specific chat
 */
export async function GET(request: NextRequest) {
  const requestId = crypto.randomUUID()

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const chatId = searchParams.get('chatId')
    const limit = Number(searchParams.get('limit')) || 10
    const offset = Number(searchParams.get('offset')) || 0

    if (!chatId) {
      return NextResponse.json({ error: 'chatId is required' }, { status: 400 })
    }

    logger.info(`[${requestId}] Listing checkpoints for chat: ${chatId}`, {
      userId: session.user.id,
      limit,
      offset,
    })

    const checkpoints = await db
      .select()
      .from(copilotCheckpoints)
      .where(
        and(eq(copilotCheckpoints.userId, session.user.id), eq(copilotCheckpoints.chatId, chatId))
      )
      .orderBy(desc(copilotCheckpoints.createdAt))
      .limit(limit)
      .offset(offset)

    // Format timestamps to ISO strings for consistent timezone handling
    const formattedCheckpoints = checkpoints.map((checkpoint) => ({
      id: checkpoint.id,
      userId: checkpoint.userId,
      workflowId: checkpoint.workflowId,
      chatId: checkpoint.chatId,
      yaml: checkpoint.yaml,
      createdAt: checkpoint.createdAt.toISOString(),
      updatedAt: checkpoint.updatedAt.toISOString(),
    }))

    return NextResponse.json({ checkpoints: formattedCheckpoints })
  } catch (error) {
    logger.error(`[${requestId}] Error listing checkpoints:`, error)
    return NextResponse.json({ error: 'Failed to list checkpoints' }, { status: 500 })
  }
}
