import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { forkMothershipChatContract } from '@/lib/api/contracts/mothership-tasks'
import { parseRequest } from '@/lib/api/server'
import type { PersistedMessage } from '@/lib/copilot/chat/persisted-message'
import { fetchGo } from '@/lib/copilot/request/go/fetch'
import {
  authenticateCopilotRequestSessionOnly,
  createBadRequestResponse,
  createInternalServerErrorResponse,
  createNotFoundResponse,
  createUnauthorizedResponse,
} from '@/lib/copilot/request/http'
import type { MothershipResource } from '@/lib/copilot/resources/types'
import { getMothershipBaseURL, getMothershipSourceEnvHeaders } from '@/lib/copilot/server/agent-url'
import { taskPubSub } from '@/lib/copilot/tasks'
import { env } from '@/lib/core/config/env'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import { assertActiveWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('ForkChatAPI')

/**
 * POST /api/mothership/chats/[chatId]/fork
 * Creates a new chat branched from the given chat, keeping messages up to and
 * including the specified message. Resources and copilot-side state are copied.
 */
export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ chatId: string }> }) => {
    try {
      const { userId, isAuthenticated } = await authenticateCopilotRequestSessionOnly()
      if (!isAuthenticated || !userId) {
        return createUnauthorizedResponse()
      }

      const parsed = await parseRequest(forkMothershipChatContract, request, context, {
        validationErrorResponse: () => createBadRequestResponse('upToMessageId is required'),
      })
      if (!parsed.success) return parsed.response
      const { chatId } = parsed.data.params
      const { upToMessageId } = parsed.data.body

      // Load parent chat and verify ownership.
      const [parent] = await db
        .select()
        .from(copilotChats)
        .where(eq(copilotChats.id, chatId))
        .limit(1)

      if (!parent || parent.userId !== userId || parent.type !== 'mothership') {
        return createNotFoundResponse('Chat not found')
      }

      if (parent.workspaceId) {
        await assertActiveWorkspaceAccess(parent.workspaceId, userId)
      }

      // Find the fork point in the Sim-side messages array.
      const messages = Array.isArray(parent.messages) ? (parent.messages as PersistedMessage[]) : []
      const forkIdx = messages.findIndex((m) => m.id === upToMessageId)
      if (forkIdx < 0) {
        return createBadRequestResponse('Message not found in chat')
      }
      const forkedMessages = messages.slice(0, forkIdx + 1)

      // Resources are stored as a jsonb array on the chat row — copy them directly.
      const parentResources = Array.isArray(parent.resources)
        ? (parent.resources as MothershipResource[])
        : []

      const newId = generateId()
      const baseTitle = (parent.title ?? 'New task').replace(/^Fork \| /, '')
      const title = `Fork | ${baseTitle}`
      const now = new Date()

      const [newChat] = await db
        .insert(copilotChats)
        .values({
          id: newId,
          userId,
          workspaceId: parent.workspaceId,
          type: parent.type,
          title,
          model: parent.model,
          messages: forkedMessages,
          resources: parentResources,
          previewYaml: parent.previewYaml,
          planArtifact: parent.planArtifact,
          config: parent.config,
          conversationId: null,
          updatedAt: now,
          lastSeenAt: now,
        })
        .returning({ id: copilotChats.id, workspaceId: copilotChats.workspaceId })

      if (!newChat) {
        return createInternalServerErrorResponse('Failed to create forked chat')
      }

      // Clone copilot-service conversation state (messages, active_messages, memory files).
      // Best-effort: if the copilot service doesn't have a row for the source chat yet, skip.
      try {
        const copilotHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
        if (env.COPILOT_API_KEY) {
          copilotHeaders['x-api-key'] = env.COPILOT_API_KEY
        }
        Object.assign(copilotHeaders, getMothershipSourceEnvHeaders())
        const mothershipBaseURL = await getMothershipBaseURL({ userId })
        const copilotRes = await fetchGo(`${mothershipBaseURL}/api/chats/fork`, {
          method: 'POST',
          headers: copilotHeaders,
          body: JSON.stringify({
            sourceChatId: chatId,
            newChatId: newId,
            upToMessageId,
            userId,
          }),
          spanName: 'sim → go /api/chats/fork',
          operation: 'fork_chat',
        })
        if (!copilotRes.ok) {
          const text = await copilotRes.text().catch(() => '')
          logger.warn('Copilot fork returned non-OK', { status: copilotRes.status, body: text })
        }
      } catch (err) {
        // The copilot service may not have a row for this chat if no messages
        // have been sent yet, or if it's unreachable. Log and continue.
        logger.warn('Failed to fork copilot-service conversation, skipping', { err })
      }

      if (newChat.workspaceId) {
        taskPubSub?.publishStatusChanged({
          workspaceId: newChat.workspaceId,
          chatId: newId,
          type: 'created',
        })
      }

      captureServerEvent(
        userId,
        'task_forked',
        { workspace_id: parent.workspaceId ?? '', source_chat_id: chatId },
        { groups: { workspace: parent.workspaceId ?? '' } }
      )

      return NextResponse.json({ success: true, id: newId })
    } catch (error) {
      logger.error('Error forking chat:', error)
      return createInternalServerErrorResponse('Failed to fork chat')
    }
  }
)
