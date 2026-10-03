import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import {
  deleteMothershipChatContract,
  getMothershipChatContract,
  updateMothershipChatContract,
} from '@/lib/api/contracts/mothership-chats'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { buildEffectiveChatTranscript } from '@/lib/mothership/chat/effective-transcript'
import {
  getAccessibleCopilotChatAuth,
  getAccessibleCopilotChatWithMessages,
} from '@/lib/mothership/chat/lifecycle'
import {
  type LiveTurnSnapshot,
  readLiveTurnSnapshot,
} from '@/lib/mothership/chat/live-turn-snapshot'
import { normalizeMessage } from '@/lib/mothership/chat/persisted-message'
import { reconcileChatStreamMarkers } from '@/lib/mothership/chat/stream-liveness'
import { publishChatStatusChanged } from '@/lib/mothership/chat-status'
import {
  authenticateCopilotRequestSessionOnly,
  createInternalServerErrorResponse,
  createUnauthorizedResponse,
} from '@/lib/mothership/request/http'
import { captureServerEvent } from '@/lib/posthog/server'

const logger = createLogger('MothershipChatAPI')

export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ chatId: string }> }) => {
    try {
      const { userId, isAuthenticated, principal } = await authenticateCopilotRequestSessionOnly()
      if (!isAuthenticated || !userId) {
        return createUnauthorizedResponse()
      }

      const paramsResult = await parseRequest(getMothershipChatContract, request, context)
      if (!paramsResult.success) return paramsResult.response
      const { chatId } = paramsResult.data.params

      const chat = await getAccessibleCopilotChatWithMessages(chatId, userId, { principal })
      if (!chat || chat.type !== 'mothership') {
        return NextResponse.json({ success: false, error: 'Chat not found' }, { status: 404 })
      }

      // The Redis replay buffer is read here only to synthesize the in-flight
      // assistant turn for the initial paint. The raw events are NOT shipped
      // to the client: when `activeStreamId` is set, the client reconnects to
      // the replay buffer (from seq 0) via the stream resume endpoint, which
      // is the source of truth for streaming state.
      let liveTurnSnapshot: LiveTurnSnapshot | null = null

      const reconciledMarkers = await reconcileChatStreamMarkers(
        [{ chatId: chat.id, streamId: chat.conversationId }],
        { repairVerifiedStaleMarkers: true }
      )
      const liveStreamId = reconciledMarkers.get(chat.id)?.streamId ?? null

      if (liveStreamId) {
        try {
          liveTurnSnapshot = await readLiveTurnSnapshot(liveStreamId, userId)
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
        ...(liveTurnSnapshot ? { streamSnapshot: liveTurnSnapshot } : {}),
      })

      return NextResponse.json({
        success: true,
        chat: {
          id: chat.id,
          title: chat.title,
          mode: chat.mode,
          messages: effectiveMessages,
          activeStreamId: liveStreamId,
          resources: Array.isArray(chat.resources) ? chat.resources : [],
          createdAt: chat.createdAt,
          updatedAt: chat.updatedAt,
          // Events stay out of the payload (the resume endpoint replays them),
          // but the client still needs the run status to skip reconnecting to
          // an already-terminal stream, and the preview sessions to seed the
          // file preview panel before the reconnect lands.
          ...(liveTurnSnapshot
            ? {
                streamSnapshot: {
                  events: [],
                  previewSessions: liveTurnSnapshot.previewSessions,
                  status: liveTurnSnapshot.status,
                },
              }
            : {}),
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
      const { userId, isAuthenticated, principal } = await authenticateCopilotRequestSessionOnly()
      if (!isAuthenticated || !userId) {
        return createUnauthorizedResponse()
      }

      const parsed = await parseRequest(updateMothershipChatContract, request, context)
      if (!parsed.success) return parsed.response
      const { chatId } = parsed.data.params
      const { title, isUnread, pinned } = parsed.data.body
      const chat = await getAccessibleCopilotChatAuth(chatId, userId, { principal })
      if (!chat || chat.type !== 'mothership') {
        return NextResponse.json({ success: false, error: 'Chat not found' }, { status: 404 })
      }

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
            eq(copilotChats.type, 'mothership'),
            isNull(copilotChats.deletedAt)
          )
        )
        .returning({
          id: copilotChats.id,
          workspaceId: copilotChats.workspaceId,
          organizationId: copilotChats.organizationId,
        })

      if (!updatedChat) {
        return NextResponse.json({ success: false, error: 'Chat not found' }, { status: 404 })
      }

      publishChatStatusChanged(
        { ...updatedChat, userId },
        {
          chatId,
          type: title !== undefined ? 'renamed' : 'updated',
        }
      )
      if (updatedChat.workspaceId) {
        if (title !== undefined) {
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
      const { userId, isAuthenticated, principal } = await authenticateCopilotRequestSessionOnly()
      if (!isAuthenticated || !userId) {
        return createUnauthorizedResponse()
      }

      const parsed = await parseRequest(deleteMothershipChatContract, request, context)
      if (!parsed.success) return parsed.response
      const { chatId } = parsed.data.params

      const chat = await getAccessibleCopilotChatAuth(chatId, userId, { principal })
      if (!chat || chat.type !== 'mothership') {
        return NextResponse.json({ success: true })
      }

      const [deletedChat] = await db
        .update(copilotChats)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(copilotChats.id, chatId),
            eq(copilotChats.userId, userId),
            eq(copilotChats.type, 'mothership'),
            isNull(copilotChats.deletedAt)
          )
        )
        .returning({
          workspaceId: copilotChats.workspaceId,
          organizationId: copilotChats.organizationId,
        })

      if (!deletedChat) {
        return NextResponse.json({ success: false, error: 'Chat not found' }, { status: 404 })
      }

      publishChatStatusChanged({ ...deletedChat, userId }, { chatId, type: 'deleted' })
      if (deletedChat.workspaceId) {
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
