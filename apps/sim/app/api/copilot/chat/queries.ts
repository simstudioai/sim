import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { and, desc, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
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
import { readFilePreviewSessions } from '@/lib/copilot/request/session'
import { readEvents } from '@/lib/copilot/request/session/buffer'
import { toStreamBatchEvent } from '@/lib/copilot/request/session/types'
import { authorizeWorkflowByWorkspacePermission } from '@/lib/workflows/utils'
import { assertActiveWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('CopilotChatAPI')

function transformChat(chat: {
  id: string
  title: string | null
  model: string | null
  messages: unknown
  planArtifact?: unknown
  config?: unknown
  conversationId?: string | null
  resources?: unknown
  createdAt: Date | null
  updatedAt: Date | null
}) {
  return {
    id: chat.id,
    title: chat.title,
    model: chat.model,
    messages: Array.isArray(chat.messages) ? chat.messages : [],
    messageCount: Array.isArray(chat.messages) ? chat.messages.length : 0,
    planArtifact: chat.planArtifact || null,
    config: chat.config || null,
    ...('conversationId' in chat ? { activeStreamId: chat.conversationId || null } : {}),
    ...('resources' in chat
      ? { resources: Array.isArray(chat.resources) ? chat.resources : [] }
      : {}),
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const workflowId = searchParams.get('workflowId')
    const workspaceId = searchParams.get('workspaceId')
    const chatId = searchParams.get('chatId')

    const { userId: authenticatedUserId, isAuthenticated } =
      await authenticateCopilotRequestSessionOnly()
    if (!isAuthenticated || !authenticatedUserId) {
      return createUnauthorizedResponse()
    }

    if (chatId) {
      const chat = await getAccessibleCopilotChat(chatId, authenticatedUserId)
      if (!chat) {
        return NextResponse.json({ success: false, error: 'Chat not found' }, { status: 404 })
      }

      let streamSnapshot: {
        events: ReturnType<typeof toStreamBatchEvent>[]
        previewSessions: Awaited<ReturnType<typeof readFilePreviewSessions>>
        status: string
      } | null = null
      if (chat.conversationId) {
        try {
          const [events, previewSessions, run] = await Promise.all([
            readEvents(chat.conversationId, '0'),
            readFilePreviewSessions(chat.conversationId).catch((error) => {
              logger.warn('Failed to read preview sessions for copilot chat', {
                chatId,
                conversationId: chat.conversationId,
                error: toError(error).message,
              })
              return []
            }),
            getLatestRunForStream(chat.conversationId, authenticatedUserId).catch((error) => {
              logger.warn('Failed to fetch latest run for copilot chat snapshot', {
                chatId,
                conversationId: chat.conversationId,
                error: toError(error).message,
              })
              return null
            }),
          ])

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
          logger.warn('Failed to load copilot chat stream snapshot', {
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

      logger.info(`Retrieved chat ${chatId}`)
      return NextResponse.json({
        success: true,
        chat: {
          ...transformChat(chat),
          messages: effectiveMessages,
          ...(streamSnapshot ? { streamSnapshot } : {}),
        },
      })
    }

    if (!workflowId && !workspaceId) {
      return createBadRequestResponse('workflowId, workspaceId, or chatId is required')
    }

    if (workspaceId) {
      await assertActiveWorkspaceAccess(workspaceId, authenticatedUserId)
    }

    if (workflowId) {
      const authorization = await authorizeWorkflowByWorkspacePermission({
        workflowId,
        userId: authenticatedUserId,
        action: 'read',
      })
      if (!authorization.allowed) {
        return createUnauthorizedResponse()
      }
    }

    const scopeFilter = workflowId
      ? eq(copilotChats.workflowId, workflowId)
      : eq(copilotChats.workspaceId, workspaceId!)

    const chats = await db
      .select({
        id: copilotChats.id,
        title: copilotChats.title,
        model: copilotChats.model,
        messages: copilotChats.messages,
        planArtifact: copilotChats.planArtifact,
        config: copilotChats.config,
        createdAt: copilotChats.createdAt,
        updatedAt: copilotChats.updatedAt,
      })
      .from(copilotChats)
      .where(and(eq(copilotChats.userId, authenticatedUserId), scopeFilter))
      .orderBy(desc(copilotChats.updatedAt))

    const scope = workflowId ? `workflow ${workflowId}` : `workspace ${workspaceId}`
    logger.info(`Retrieved ${chats.length} chats for ${scope}`)

    return NextResponse.json({
      success: true,
      chats: chats.map(transformChat),
    })
  } catch (error) {
    logger.error('Error fetching copilot chats:', error)
    return createInternalServerErrorResponse('Failed to fetch chats')
  }
}
