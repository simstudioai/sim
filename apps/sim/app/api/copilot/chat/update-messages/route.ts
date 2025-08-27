import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  authenticateCopilotRequestSessionOnly,
  createInternalServerErrorResponse,
  createNotFoundResponse,
  createRequestTracker,
  createUnauthorizedResponse,
} from '@/lib/copilot/auth'
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
      fileAttachments: z
        .array(
          z.object({
            id: z.string(),
            key: z.string(),
            filename: z.string(),
            media_type: z.string(),
            size: z.number(),
          })
        )
        .optional(),
    })
  ),
})

export async function POST(req: NextRequest) {
  const tracker = createRequestTracker()

  try {
    const { userId, isAuthenticated } = await authenticateCopilotRequestSessionOnly()
    if (!isAuthenticated || !userId) {
      return createUnauthorizedResponse()
    }

    const body = await req.json()
    const { chatId, messages } = UpdateMessagesSchema.parse(body)

    // Verify that the chat belongs to the user
    const [chat] = await db
      .select()
      .from(copilotChats)
      .where(and(eq(copilotChats.id, chatId), eq(copilotChats.userId, userId)))
      .limit(1)

    if (!chat) {
      return createNotFoundResponse('Chat not found or unauthorized')
    }

    // Update chat with new messages
    await db
      .update(copilotChats)
      .set({
        messages: messages,
        updatedAt: new Date(),
      })
      .where(eq(copilotChats.id, chatId))

    logger.info(`[${tracker.requestId}] Successfully updated chat messages`, {
      chatId,
      newMessageCount: messages.length,
    })

    return NextResponse.json({
      success: true,
      messageCount: messages.length,
    })
  } catch (error) {
    logger.error(`[${tracker.requestId}] Error updating chat messages:`, error)
    return createInternalServerErrorResponse('Failed to update chat messages')
  }
}
