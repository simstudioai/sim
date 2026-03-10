import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'

const logger = createLogger('MothershipChatStopAPI')

const StopSchema = z.object({
  chatId: z.string(),
  streamId: z.string(),
  content: z.string(),
})

/**
 * POST /api/mothership/chat/stop
 * Persists partial assistant content when the user stops a stream mid-response.
 * Clears conversationId so the server-side onComplete won't duplicate the message.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { chatId, streamId, content } = StopSchema.parse(await req.json())

    const setClause: Record<string, unknown> = {
      conversationId: null,
      updatedAt: new Date(),
    }

    if (content.trim()) {
      const assistantMessage = {
        id: crypto.randomUUID(),
        role: 'assistant' as const,
        content,
        timestamp: new Date().toISOString(),
      }
      setClause.messages = sql`${copilotChats.messages} || ${JSON.stringify([assistantMessage])}::jsonb`
    }

    await db
      .update(copilotChats)
      .set(setClause)
      .where(
        and(
          eq(copilotChats.id, chatId),
          eq(copilotChats.userId, session.user.id),
          eq(copilotChats.conversationId, streamId)
        )
      )

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }
    logger.error('Error stopping chat stream:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
