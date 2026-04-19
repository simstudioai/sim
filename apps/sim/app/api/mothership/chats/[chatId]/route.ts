import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { and, eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getLatestRunForStream } from '@/lib/copilot/async-runs/repository'
import { buildEffectiveChatTranscript } from '@/lib/copilot/chat/effective-transcript'
import { getAccessibleCopilotChat } from '@/lib/copilot/chat/lifecycle'
import { normalizeMessage } from '@/lib/copilot/chat/persisted-message'
import {
  authenticateCopilotRequestSessionOnly,
  createBadRequestResponse,
  createInternalServerErrorResponse,
  createUnauthorizedResponse,
} from '@/lib/copilot/request/http'
import type { FilePreviewSession } from '@/lib/copilot/request/session'
import { readEvents } from '@/lib/copilot/request/session/buffer'
import { readFilePreviewSessions } from '@/lib/copilot/request/session/file-preview-session'
import { type StreamBatchEvent, toStreamBatchEvent } from '@/lib/copilot/request/session/types'
import { taskPubSub } from '@/lib/copilot/tasks'
import { captureServerEvent } from '@/lib/posthog/server'

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
      events: StreamBatchEvent[]
      previewSessions: FilePreviewSession[]
      status: string
    } | null = null

    if (chat.conversationId) {
      try {
        const [events, previewSessions] = await Promise.all([
          readEvents(chat.conversationId, '0'),
          readFilePreviewSessions(chat.conversationId).catch((error) => {
            logger.warn('Failed to read preview sessions for mothership chat', {
              chatId,
              conversationId: chat.conversationId,
              error: toError(error).message,
            })
            return []
          }),
        ])
        const run = await getLatestRunForStream(chat.conversationId, userId).catch((error) => {
          logger.warn('Failed to fetch latest run for mothership chat snapshot', {
            chatId,
            conversationId: chat.conversationId,
            error: toError(error).message,
          })
          return null
        })

        streamSnapshot = {
          events: events.map(toStreamBatchEvent),
          previewSessions,
          status:
            typeof run?.status === 'string' ? run.status : events.length > 0 ? 'active' : 'unknown',
        }
      } catch (error) {
        logger.warn('Failed to read stream snapshot for mothership chat', {
          chatId,
          conversationId: chat.conversationId,
          error: toError(error).message,
        })
      }
    }

    const normalizedMessages = Array.isArray(chat.messages)
      ? chat.messages
          .filter((message): message is Record<string, unknown> => Boolean(message))
          .map(normalizeMessage)
      : []
    const effectiveMessages = buildEffectiveChatTranscript({
      messages: normalizedMessages,
      activeStreamId: chat.conversationId || null,
      ...(streamSnapshot ? { streamSnapshot } : {}),
    })

    return NextResponse.json({
      success: true,
      chat: {
        id: chat.id,
        title: chat.title,
        messages: effectiveMessages,
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

    if (updatedChat.workspaceId) {
      if (title !== undefined) {
        taskPubSub?.publishStatusChanged({
          workspaceId: updatedChat.workspaceId,
          chatId,
          type: 'renamed',
        })
        captureServerEvent(
          userId,
          'task_renamed',
          { workspace_id: updatedChat.workspaceId },
          {
            groups: { workspace: updatedChat.workspaceId },
          }
        )
      }
      if (isUnread === true) {
        captureServerEvent(
          userId,
          'task_marked_unread',
          { workspace_id: updatedChat.workspaceId },
          {
            groups: { workspace: updatedChat.workspaceId },
          }
        )
      }
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
      captureServerEvent(
        userId,
        'task_deleted',
        { workspace_id: deletedChat.workspaceId },
        {
          groups: { workspace: deletedChat.workspaceId },
        }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Error deleting mothership chat:', error)
    return createInternalServerErrorResponse('Failed to delete chat')
  }
}
