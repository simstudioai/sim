import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { updateCopilotMessagesContract } from '@/lib/api/contracts/copilot'
import { parseRequest } from '@/lib/api/server'
import { getAccessibleCopilotChatAuth } from '@/lib/copilot/chat/lifecycle'
import { normalizeMessage, type PersistedMessage } from '@/lib/copilot/chat/persisted-message'
import {
  authenticateCopilotRequestSessionOnly,
  createInternalServerErrorResponse,
  createNotFoundResponse,
  createRequestTracker,
  createUnauthorizedResponse,
} from '@/lib/copilot/request/http'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('CopilotChatUpdateAPI')

export const POST = withRouteHandler(async (req: NextRequest) => {
  const tracker = createRequestTracker()

  try {
    const { userId, isAuthenticated } = await authenticateCopilotRequestSessionOnly()
    if (!isAuthenticated || !userId) {
      return createUnauthorizedResponse()
    }

    const parsed = await parseRequest(
      updateCopilotMessagesContract,
      req,
      {},
      {
        invalidJson: 'throw',
      }
    )
    if (!parsed.success) return parsed.response
    const { chatId, messages, planArtifact, config } = parsed.data.body

    const lastMsg = messages[messages.length - 1]
    if (lastMsg?.role === 'assistant') {
      logger.info(`[${tracker.requestId}] Received messages to save`, {
        messageCount: messages.length,
        lastMsgId: lastMsg.id,
        lastMsgContentLength: lastMsg.content?.length || 0,
        lastMsgContentBlockCount: lastMsg.contentBlocks?.length || 0,
        lastMsgContentBlockTypes: lastMsg.contentBlocks?.map((b: any) => b?.type) || [],
      })
    }

    const normalizedMessages: PersistedMessage[] = messages.map((message) =>
      normalizeMessage(message as Record<string, unknown>)
    )

    // Debug: Log what we're about to save
    const lastMsgParsed = normalizedMessages[normalizedMessages.length - 1]
    if (lastMsgParsed?.role === 'assistant') {
      logger.info(`[${tracker.requestId}] Parsed messages to save`, {
        messageCount: normalizedMessages.length,
        lastMsgId: lastMsgParsed.id,
        lastMsgContentLength: lastMsgParsed.content?.length || 0,
        lastMsgContentBlockCount: lastMsgParsed.contentBlocks?.length || 0,
        lastMsgContentBlockTypes: lastMsgParsed.contentBlocks?.map((b: any) => b?.type) || [],
      })
    }

    // Verify that the chat belongs to the user
    const chat = await getAccessibleCopilotChatAuth(chatId, userId)

    if (!chat) {
      return createNotFoundResponse('Chat not found or unauthorized')
    }

    // Update chat with new messages, plan artifact, and config
    const updateData: Record<string, unknown> = {
      messages: normalizedMessages,
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
      newMessageCount: normalizedMessages.length,
      hasPlanArtifact: !!planArtifact,
      hasConfig: !!config,
    })

    return NextResponse.json({
      success: true,
      messageCount: normalizedMessages.length,
    })
  } catch (error) {
    logger.error(`[${tracker.requestId}] Error updating chat messages:`, error)
    return createInternalServerErrorResponse('Failed to update chat messages')
  }
})
