import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { and, eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import {
  deleteMothershipChatContract,
  getMothershipChatContract,
  updateMothershipChatContract,
} from '@/lib/api/contracts/mothership-tasks'
import { parseRequest } from '@/lib/api/server'
import { getLatestRunForStream } from '@/lib/copilot/async-runs/repository'
import { buildEffectiveChatTranscript } from '@/lib/copilot/chat/effective-transcript'
import {
  getAccessibleCopilotChat,
  getAccessibleCopilotChatAuth,
} from '@/lib/copilot/chat/lifecycle'
import { normalizeMessage } from '@/lib/copilot/chat/persisted-message'
import { reconcileChatStreamMarkers } from '@/lib/copilot/chat/stream-liveness'
import {
  authenticateCopilotRequestSessionOnly,
  createInternalServerErrorResponse,
  createUnauthorizedResponse,
} from '@/lib/copilot/request/http'
import type { FilePreviewSession } from '@/lib/copilot/request/session'
import { readEvents } from '@/lib/copilot/request/session/buffer'
import { readFilePreviewSessions } from '@/lib/copilot/request/session/file-preview-session'
import { type StreamBatchEvent, toStreamBatchEvent } from '@/lib/copilot/request/session/types'
import { taskPubSub } from '@/lib/copilot/tasks'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'

const logger = createLogger('MothershipChatAPI')

export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ chatId: string }> }) => {
    try {
      const { userId, isAuthenticated } = await authenticateCopilotRequestSessionOnly()
      if (!isAuthenticated || !userId) {
        return createUnauthorizedResponse()
      }

      const paramsResult = await parseRequest(getMothershipChatContract, request, context)
      if (!paramsResult.success) return paramsResult.response
      const { chatId } = paramsResult.data.params

      const chat = await getAccessibleCopilotChat(chatId, userId)
      if (!chat || chat.type !== 'mothership') {
        return NextResponse.json({ success: false, error: 'Chat not found' }, { status: 404 })
      }

      let streamSnapshot: {
        events: StreamBatchEvent[]
        previewSessions: FilePreviewSession[]
        status: string
      } | null = null

      const reconciledMarkers = await reconcileChatStreamMarkers(
        [{ chatId: chat.id, streamId: chat.conversationId }],
        { repairVerifiedStaleMarkers: true }
      )
      const liveStreamId = reconciledMarkers.get(chat.id)?.streamId ?? null

      if (liveStreamId) {
        try {
          const [events, previewSessions] = await Promise.all([
            readEvents(liveStreamId, '0'),
            readFilePreviewSessions(liveStreamId).catch((error) => {
              logger.warn('Failed to read preview sessions for mothership chat', {
                chatId,
                streamId: liveStreamId,
                error: toError(error).message,
              })
              return []
            }),
          ])
          const run = await getLatestRunForStream(liveStreamId, userId).catch((error) => {
            logger.warn('Failed to fetch latest run for mothership chat snapshot', {
              chatId,
              streamId: liveStreamId,
              error: toError(error).message,
            })
            return null
          })

          streamSnapshot = {
            events: events.map(toStreamBatchEvent),
            previewSessions,
            status:
              typeof run?.status === 'string'
                ? run.status
                : events.length > 0
                  ? 'active'
                  : 'unknown',
          }
        } catch (error) {
          logger.warn('Failed to read stream snapshot for mothership chat', {
            chatId,
            streamId: liveStreamId,
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
        activeStreamId: liveStreamId,
        ...(streamSnapshot ? { streamSnapshot } : {}),
      })

      return NextResponse.json({
        success: true,
        chat: {
          id: chat.id,
          title: chat.title,
          messages: effectiveMessages,
          activeStreamId: liveStreamId,
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
)

export const PATCH = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ chatId: string }> }) => {
    try {
      const { userId, isAuthenticated } = await authenticateCopilotRequestSessionOnly()
      if (!isAuthenticated || !userId) {
        return createUnauthorizedResponse()
      }

      const parsed = await parseRequest(updateMothershipChatContract, request, context)
      if (!parsed.success) return parsed.response
      const { chatId } = parsed.data.params
      const { title, isUnread, pinned } = parsed.data.body

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
      if (pinned !== undefined) {
        updates.pinned = pinned
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
        if (pinned !== undefined) {
          captureServerEvent(
            userId,
            pinned ? 'task_pinned' : 'task_unpinned',
            { workspace_id: updatedChat.workspaceId },
            {
              groups: { workspace: updatedChat.workspaceId },
            }
          )
        }
      }

      return NextResponse.json({ success: true })
    } catch (error) {
      logger.error('Error updating mothership chat:', error)
      return createInternalServerErrorResponse('Failed to update chat')
    }
  }
)

export const DELETE = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ chatId: string }> }) => {
    try {
      const { userId, isAuthenticated } = await authenticateCopilotRequestSessionOnly()
      if (!isAuthenticated || !userId) {
        return createUnauthorizedResponse()
      }

      const parsed = await parseRequest(deleteMothershipChatContract, request, context)
      if (!parsed.success) return parsed.response
      const { chatId } = parsed.data.params

      const chat = await getAccessibleCopilotChatAuth(chatId, userId)
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
)
