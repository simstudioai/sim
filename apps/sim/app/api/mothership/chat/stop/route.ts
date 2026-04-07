import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { releasePendingChatStream } from '@/lib/copilot/chat-streaming'
import { taskPubSub } from '@/lib/copilot/task-events'
import { generateId } from '@/lib/core/utils/uuid'

const logger = createLogger('MothershipChatStopAPI')

const StoredToolCallSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    state: z.string().optional(),
    params: z.record(z.unknown()).optional(),
    result: z
      .object({
        success: z.boolean(),
        output: z.unknown().optional(),
        error: z.string().optional(),
      })
      .optional(),
    display: z
      .object({
        text: z.string().optional(),
      })
      .optional(),
    calledBy: z.string().optional(),
  })
  .nullable()

const ContentBlockSchema = z.object({
  type: z.string(),
  content: z.string().optional(),
  toolCall: StoredToolCallSchema.optional(),
})

const StopSchema = z.object({
  chatId: z.string(),
  streamId: z.string(),
  content: z.string(),
  contentBlocks: z.array(ContentBlockSchema).optional(),
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

    const { chatId, streamId, content, contentBlocks } = StopSchema.parse(await req.json())

    await releasePendingChatStream(chatId, streamId)

    const setClause: Record<string, unknown> = {
      conversationId: null,
      updatedAt: new Date(),
    }

    const hasContent = content.trim().length > 0
    const hasBlocks = Array.isArray(contentBlocks) && contentBlocks.length > 0

    if (hasContent || hasBlocks) {
      const assistantMessage: Record<string, unknown> = {
        id: generateId(),
        role: 'assistant' as const,
        content,
        timestamp: new Date().toISOString(),
      }
      if (hasBlocks) {
        assistantMessage.contentBlocks = contentBlocks
      }
      setClause.messages = sql`${copilotChats.messages} || ${JSON.stringify([assistantMessage])}::jsonb`
    }

    const [updated] = await db
      .update(copilotChats)
      .set(setClause)
      .where(
        and(
          eq(copilotChats.id, chatId),
          eq(copilotChats.userId, session.user.id),
          eq(copilotChats.conversationId, streamId)
        )
      )
      .returning({ workspaceId: copilotChats.workspaceId })

    if (updated?.workspaceId) {
      taskPubSub?.publishStatusChanged({
        workspaceId: updated.workspaceId,
        chatId,
        type: 'completed',
      })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }
    logger.error('Error stopping chat stream:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
