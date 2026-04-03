import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAccessibleCopilotChat } from '@/lib/copilot/chat-lifecycle'
import { getStreamMeta, readStreamEvents } from '@/lib/copilot/orchestrator/stream/buffer'
import {
  authenticateCopilotRequestSessionOnly,
  createBadRequestResponse,
  createInternalServerErrorResponse,
  createUnauthorizedResponse,
} from '@/lib/copilot/request-helpers'
import { taskPubSub } from '@/lib/copilot/task-events'

const logger = createLogger('MothershipChatAPI')

const UpdateChatSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    isUnread: z.boolean().optional(),
  })
  .refine((data) => data.title !== undefined || data.isUnread !== undefined, {
    message: 'At least one field must be provided',
  })

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ chatId: string }> }
) {
  try {
    const { userId, isAuthenticated } = await authenticateCopilotRequestSessionOnly()
    if (!isAuthenticated || !userId) {
      return createUnauthorizedResponse()
    }

    const { chatId } = await params
    if (!chatId) {
      return createBadRequestResponse('chatId is required')
    }

    const chat = await getAccessibleCopilotChat(chatId, userId)
    if (!chat || chat.type !== 'mothership') {
      return NextResponse.json({ success: false, error: 'Chat not found' }, { status: 404 })
    }

    let streamSnapshot: {
      events: Array<{ eventId: number; streamId: string; event: Record<string, unknown> }>
      status: string
    } | null = null

    if (chat.conversationId) {
      try {
        const [meta, events] = await Promise.all([
          getStreamMeta(chat.conversationId),
          readStreamEvents(chat.conversationId, 0),
        ])

        streamSnapshot = {
          events: events || [],
          status: meta?.status || 'unknown',
        }
      } catch (error) {
        logger
          .withMetadata({ messageId: chat.conversationId || undefined })
          .warn('Failed to read stream snapshot for mothership chat', {
            chatId,
            conversationId: chat.conversationId,
            error: error instanceof Error ? error.message : String(error),
          })
      }
    }

    return NextResponse.json({
      success: true,
      chat: {
        id: chat.id,
        title: chat.title,
        messages: Array.isArray(chat.messages) ? chat.messages : [],
        conversationId: chat.conversationId || null,
        resources: Array.isArray(chat.resources) ? chat.resources : [],
        createdAt: chat.createdAt,
        updatedAt: chat.updatedAt,
        ...(streamSnapshot ? { streamSnapshot } : {}),
      },
    })
  } catch (error) {
    logger.error('Error fetching mothership chat:', error)
    return createInternalServerErrorResponse('Failed to fetch chat')
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ chatId: string }> }
) {
  try {
    const { userId, isAuthenticated } = await authenticateCopilotRequestSessionOnly()
    if (!isAuthenticated || !userId) {
      return createUnauthorizedResponse()
    }

    const { chatId } = await params
    if (!chatId) {
      return createBadRequestResponse('chatId is required')
    }

    const body = await request.json()
    const { title, isUnread } = UpdateChatSchema.parse(body)

    const updates: Record<string, unknown> = {}

    if (title !== undefined) {
      const now = new Date()
      updates.title = title
      updates.updatedAt = now
      if (isUnread === undefined) {
        updates.lastSeenAt = now
      }
    }
    if (isUnread !== undefined) {
      updates.lastSeenAt = isUnread ? null : sql`GREATEST(${copilotChats.updatedAt}, NOW())`
    }

    const [updatedChat] = await db
      .update(copilotChats)
      .set(updates)
      .where(
        and(
          eq(copilotChats.id, chatId),
          eq(copilotChats.userId, userId),
          eq(copilotChats.type, 'mothership')
        )
      )
      .returning({
        id: copilotChats.id,
        workspaceId: copilotChats.workspaceId,
      })

    if (!updatedChat) {
      return NextResponse.json({ success: false, error: 'Chat not found' }, { status: 404 })
    }

    if (title !== undefined && updatedChat.workspaceId) {
      taskPubSub?.publishStatusChanged({
        workspaceId: updatedChat.workspaceId,
        chatId,
        type: 'renamed',
      })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return createBadRequestResponse('Invalid request data')
    }
    logger.error('Error updating mothership chat:', error)
    return createInternalServerErrorResponse('Failed to update chat')
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ chatId: string }> }
) {
  try {
    const { userId, isAuthenticated } = await authenticateCopilotRequestSessionOnly()
    if (!isAuthenticated || !userId) {
      return createUnauthorizedResponse()
    }

    const { chatId } = await params
    if (!chatId) {
      return createBadRequestResponse('chatId is required')
    }

    const chat = await getAccessibleCopilotChat(chatId, userId)
    if (!chat || chat.type !== 'mothership') {
      return NextResponse.json({ success: true })
    }

    const [deletedChat] = await db
      .delete(copilotChats)
      .where(
        and(
          eq(copilotChats.id, chatId),
          eq(copilotChats.userId, userId),
          eq(copilotChats.type, 'mothership')
        )
      )
      .returning({
        workspaceId: copilotChats.workspaceId,
      })

    if (!deletedChat) {
      return NextResponse.json({ success: false, error: 'Chat not found' }, { status: 404 })
    }

    if (deletedChat.workspaceId) {
      taskPubSub?.publishStatusChanged({
        workspaceId: deletedChat.workspaceId,
        chatId,
        type: 'deleted',
      })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Error deleting mothership chat:', error)
    return createInternalServerErrorResponse('Failed to delete chat')
  }
}
