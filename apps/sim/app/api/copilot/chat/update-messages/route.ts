import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { db } from '@/db'
import { copilotChats } from '@/db/schema'

const logger = createLogger('CopilotChatUpdateAPI')

const UpdateMessagesSchema = z.object({
  chatId: z.string(),
  messages: z.array(
    z.object({
      id: z.string(),
      role: z.enum(['user', 'assistant']),
      content: z.string(),
      timestamp: z.string(),
      toolCalls: z.array(z.any()).optional(),
      contentBlocks: z.array(z.any()).optional(),
    })
  ),
})

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { chatId, messages } = UpdateMessagesSchema.parse(body)

    logger.info(`[${requestId}] Updating chat messages`, {
      userId: session.user.id,
      chatId,
      messageCount: messages.length,
    })

    // Verify that the chat belongs to the user
    const [chat] = await db
      .select()
      .from(copilotChats)
      .where(and(eq(copilotChats.id, chatId), eq(copilotChats.userId, session.user.id)))
      .limit(1)

    if (!chat) {
      return NextResponse.json({ error: 'Chat not found or unauthorized' }, { status: 404 })
    }

    // Update chat with new messages
    await db
      .update(copilotChats)
      .set({
        messages: messages,
        updatedAt: new Date(),
      })
      .where(eq(copilotChats.id, chatId))

    logger.info(`[${requestId}] Successfully updated chat messages`, {
      chatId,
      newMessageCount: messages.length,
    })

    return NextResponse.json({
      success: true,
      messageCount: messages.length,
    })
  } catch (error) {
    logger.error(`[${requestId}] Error updating chat messages:`, error)
    return NextResponse.json({ error: 'Failed to update chat messages' }, { status: 500 })
  }
}
