import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { forkMothershipChatContract } from '@/lib/api/contracts/mothership-tasks'
import { parseRequest } from '@/lib/api/server'
import type { PersistedMessage } from '@/lib/copilot/chat/persisted-message'
import { SIM_AGENT_API_URL } from '@/lib/copilot/constants'
import { fetchGo } from '@/lib/copilot/request/go/fetch'
import {
  authenticateCopilotRequestSessionOnly,
  createBadRequestResponse,
  createInternalServerErrorResponse,
  createNotFoundResponse,
  createUnauthorizedResponse,
} from '@/lib/copilot/request/http'
import type { MothershipResource } from '@/lib/copilot/resources/types'
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

      if (parent.conversationId) {
        return createBadRequestResponse('Cannot fork a chat with an active stream')
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

      // Clone copilot-service conversation state first. If this fails we never
      // insert the Sim row, so there is no orphaned UI entry to clean up.
      // (The inverse order — Sim INSERT first — required a compensating delete
      // and still left a brief window where the row was visible but Go state
      // wasn't ready.)
      const copilotHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
      if (env.COPILOT_API_KEY) {
        copilotHeaders['x-api-key'] = env.COPILOT_API_KEY
      }
      try {
        const copilotRes = await fetchGo(`${SIM_AGENT_API_URL}/api/chats/fork`, {
          method: 'POST',
          headers: copilotHeaders,
          body: JSON.stringify({
            sourceChatId: chatId,
            newChatId: newId,
            keepCount: forkedMessages.length,
            userId,
          }),
          spanName: 'sim → go /api/chats/fork',
          operation: 'fork_chat',
        })
        if (!copilotRes.ok) {
          const text = await copilotRes.text().catch(() => '')
          logger.error('Copilot fork returned non-OK', { status: copilotRes.status, body: text })
          return createInternalServerErrorResponse('Failed to fork chat')
        }
      } catch (err) {
        logger.error('Failed to call copilot fork endpoint', { err })
        return createInternalServerErrorResponse('Failed to fork chat')
      }

      // Go state is ready — now persist the Sim metadata row. If this insert
      // fails the Go conversation is orphaned but permanently inaccessible
      // (no Sim row = no UI entry), which is harmless.
      const [newChat] = await db
        .insert(copilotChats)
        .values({
          id: newId,
          userId,
          workspaceId: parent.workspaceId,
          workflowId: parent.workflowId,
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
        logger.error('Failed to insert forked chat row after successful Go fork', {
          newId,
          chatId,
        })
        return createInternalServerErrorResponse('Failed to create forked chat')
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
