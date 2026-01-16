import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { COPILOT_MODES } from '@/lib/copilot/models'
import {
  authenticateCopilotRequestSessionOnly,
  createInternalServerErrorResponse,
  createNotFoundResponse,
  createRequestTracker,
  createUnauthorizedResponse,
} from '@/lib/copilot/request-helpers'

const logger = createLogger('CopilotChatUpdateAPI')

const UpdateMessagesSchema = z.object({
  chatId: z.string(),
  messages: z.array(
    z
      .object({
        id: z.string(),
        role: z.enum(['user', 'assistant', 'system']),
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
        contexts: z.array(z.any()).optional(),
        citations: z.array(z.any()).optional(),
        errorType: z.string().optional(),
      })
      .passthrough() // Preserve any additional fields for future compatibility
  ),
  planArtifact: z.string().nullable().optional(),
  config: z
    .object({
      mode: z.enum(COPILOT_MODES).optional(),
      model: z.string().optional(),
    })
    .nullable()
    .optional(),
})

export async function POST(req: NextRequest) {
  const tracker = createRequestTracker()

  try {
    const { userId, isAuthenticated } = await authenticateCopilotRequestSessionOnly()
    if (!isAuthenticated || !userId) {
      return createUnauthorizedResponse()
    }

    const body = await req.json()

    // Debug: Log what we received
    const lastMsg = body.messages?.[body.messages.length - 1]
    if (lastMsg?.role === 'assistant') {
      logger.info(`[${tracker.requestId}] Received messages to save`, {
        messageCount: body.messages?.length,
        lastMsgId: lastMsg.id,
        lastMsgContentLength: lastMsg.content?.length || 0,
        lastMsgContentBlockCount: lastMsg.contentBlocks?.length || 0,
        lastMsgContentBlockTypes: lastMsg.contentBlocks?.map((b: any) => b?.type) || [],
      })
    }

    const { chatId, messages, planArtifact, config } = UpdateMessagesSchema.parse(body)

    // Debug: Log what we're about to save
    const lastMsgParsed = messages[messages.length - 1]
    if (lastMsgParsed?.role === 'assistant') {
      logger.info(`[${tracker.requestId}] Parsed messages to save`, {
        messageCount: messages.length,
        lastMsgId: lastMsgParsed.id,
        lastMsgContentLength: lastMsgParsed.content?.length || 0,
        lastMsgContentBlockCount: lastMsgParsed.contentBlocks?.length || 0,
        lastMsgContentBlockTypes: lastMsgParsed.contentBlocks?.map((b: any) => b?.type) || [],
      })
    }

    // Verify that the chat belongs to the user
    const [chat] = await db
      .select()
      .from(copilotChats)
      .where(and(eq(copilotChats.id, chatId), eq(copilotChats.userId, userId)))
      .limit(1)

    if (!chat) {
      return createNotFoundResponse('Chat not found or unauthorized')
    }

    // Update chat with new messages, plan artifact, and config
    const updateData: Record<string, any> = {
      messages: messages,
      updatedAt: new Date(),
    }

    if (planArtifact !== undefined) {
      updateData.planArtifact = planArtifact
    }

    if (config !== undefined) {
      updateData.config = config
    }

    await db.update(copilotChats).set(updateData).where(eq(copilotChats.id, chatId))

    logger.info(`[${tracker.requestId}] Successfully updated chat`, {
      chatId,
      newMessageCount: messages.length,
      hasPlanArtifact: !!planArtifact,
      hasConfig: !!config,
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
