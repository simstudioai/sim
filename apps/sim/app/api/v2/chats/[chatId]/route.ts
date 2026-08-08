import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { and, eq, isNull } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { v2GetChatContract, v2RenameChatContract } from '@/lib/api/contracts/v2/chats'
import { parseRequest } from '@/lib/api/server'
import { getAccessibleCopilotChatWithMessages } from '@/lib/copilot/chat/lifecycle'
import { normalizeMessage } from '@/lib/copilot/chat/persisted-message'
import { reconcileChatStreamMarkers } from '@/lib/copilot/chat/stream-liveness'
import { chatPubSub } from '@/lib/copilot/chat-status'
import { issueV2ChatContinuationToken } from '@/lib/copilot/headless/continuation-token'
import { isAuthDisabled } from '@/lib/core/config/env-flags'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import { checkRateLimit, resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import { v2ApiGateError } from '@/app/api/v2/lib/gate'
import {
  v2Data,
  v2Error,
  v2RateLimitError,
  v2ValidationError,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'

const logger = createLogger('V2ChatDetailAPI')
type ChatRouteContext = { params: Promise<{ chatId: string }> }

/** GET /api/v2/chats/[chatId] — open one owned chat and mint a fresh resume token. */
export const GET = withRouteHandler(async (request: NextRequest, context: ChatRouteContext) => {
  try {
    const rateLimit = await checkRateLimit(request, 'copilot-chat')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!
    const gate = await v2ApiGateError(userId)
    if (gate) return gate
    if (rateLimit.keyType === 'workspace') {
      return v2Error('FORBIDDEN', 'Chat history requires a personal API key')
    }

    const parsed = await parseRequest(v2GetChatContract, request, context, {
      validationErrorResponse: v2ValidationError,
    })
    if (!parsed.success) return parsed.response
    const { chatId } = parsed.data.params
    const { workspaceId, readOnly } = parsed.data.query

    const accessPrincipal = isAuthDisabled ? { ...rateLimit, keyType: undefined } : rateLimit
    const access = await resolveWorkspaceAccess(accessPrincipal, userId, workspaceId, 'read')
    if (access) return v2WorkspaceAccessError(access)

    const chat = await getAccessibleCopilotChatWithMessages(chatId, userId)
    if (!chat || chat.type !== 'mothership' || chat.workspaceId !== workspaceId) {
      return v2Error('NOT_FOUND', 'Chat not found')
    }

    const streamMarkers = await reconcileChatStreamMarkers(
      [{ chatId: chat.id, streamId: chat.conversationId }],
      { repairVerifiedStaleMarkers: true }
    )
    const active = Boolean(streamMarkers.get(chat.id)?.streamId)
    const continuationToken = await issueV2ChatContinuationToken({
      chatId: chat.id,
      workspaceId,
      authorizationUserId: userId,
      credentialType: 'personal',
      readOnly,
      persistence: 'sim',
    })
    const messages = (Array.isArray(chat.messages) ? chat.messages : [])
      .filter((message): message is Record<string, unknown> => Boolean(message))
      .map(normalizeMessage)
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .map(({ id, role, content, timestamp }) => ({ id, role, content, timestamp }))

    return v2Data(
      {
        id: chat.id,
        title: chat.title,
        messages,
        continuationToken,
        active,
      },
      { rateLimit }
    )
  } catch (error) {
    logger.error('Failed to open v2 chat', {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})

/** PATCH /api/v2/chats/[chatId] — rename one owned workspace chat. */
export const PATCH = withRouteHandler(async (request: NextRequest, context: ChatRouteContext) => {
  try {
    const rateLimit = await checkRateLimit(request, 'copilot-chat')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!
    const gate = await v2ApiGateError(userId)
    if (gate) return gate
    if (rateLimit.keyType === 'workspace') {
      return v2Error('FORBIDDEN', 'Renaming chats requires a personal API key')
    }

    const parsed = await parseRequest(v2RenameChatContract, request, context, {
      validationErrorResponse: v2ValidationError,
    })
    if (!parsed.success) return parsed.response
    const { chatId } = parsed.data.params
    const { workspaceId, title } = parsed.data.body

    const accessPrincipal = isAuthDisabled ? { ...rateLimit, keyType: undefined } : rateLimit
    const access = await resolveWorkspaceAccess(accessPrincipal, userId, workspaceId, 'read')
    if (access) return v2WorkspaceAccessError(access)

    const now = new Date()
    const [updated] = await db
      .update(copilotChats)
      .set({ title, updatedAt: now, lastSeenAt: now })
      .where(
        and(
          eq(copilotChats.id, chatId),
          eq(copilotChats.userId, userId),
          eq(copilotChats.workspaceId, workspaceId),
          eq(copilotChats.type, 'mothership'),
          isNull(copilotChats.deletedAt)
        )
      )
      .returning({ id: copilotChats.id, workspaceId: copilotChats.workspaceId })

    if (!updated) return v2Error('NOT_FOUND', 'Chat not found')

    if (updated.workspaceId) {
      chatPubSub?.publishStatusChanged({
        workspaceId: updated.workspaceId,
        chatId: updated.id,
        type: 'renamed',
      })
      captureServerEvent(
        userId,
        'task_renamed',
        { workspace_id: updated.workspaceId },
        { groups: { workspace: updated.workspaceId } }
      )
    }

    return v2Data({ id: updated.id, title }, { rateLimit })
  } catch (error) {
    logger.error('Failed to rename v2 chat', {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})
