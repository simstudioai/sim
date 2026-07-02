import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { duplicateMothershipChatContract } from '@/lib/api/contracts/mothership-chats'
import { parseRequest } from '@/lib/api/server'
import { checkStorageQuota } from '@/lib/billing/storage'
import {
  executeChatFileBlobCopies,
  listDuplicableChatFiles,
  planChatFileCopies,
} from '@/lib/copilot/chat/duplicate-chat-files'
import { loadCopilotChatMessages } from '@/lib/copilot/chat/lifecycle'
import { appendCopilotChatMessages } from '@/lib/copilot/chat/messages-store'
import {
  rewriteMessageFileRefs,
  rewriteResourceFileRefs,
} from '@/lib/copilot/chat/rewrite-file-references'
import { chatPubSub } from '@/lib/copilot/chat-status'
import { fetchGo } from '@/lib/copilot/request/go/fetch'
import {
  authenticateCopilotRequestSessionOnly,
  createBadRequestResponse,
  createForbiddenResponse,
  createInternalServerErrorResponse,
  createNotFoundResponse,
  createUnauthorizedResponse,
} from '@/lib/copilot/request/http'
import type { MothershipResource } from '@/lib/copilot/resources/types'
import { getMothershipBaseURL, getMothershipSourceEnvHeaders } from '@/lib/copilot/server/agent-url'
import { env } from '@/lib/core/config/env'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import {
  assertActiveWorkspaceAccess,
  isWorkspaceAccessDeniedError,
} from '@/lib/workspaces/permissions/utils'

const logger = createLogger('DuplicateChatAPI')

/**
 * POST /api/mothership/chats/[chatId]/duplicate
 * Creates a self-contained copy of the whole chat: row, messages, resources,
 * and the chat-owned files (uploads + outputs), with every in-transcript file
 * reference re-pointed at the copies. The copilot-service conversation state
 * (working memory + memory files) is cloned best-effort via the fork endpoint
 * in whole-chat mode (no upToMessageId).
 */
export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ chatId: string }> }) => {
    try {
      const { userId, isAuthenticated } = await authenticateCopilotRequestSessionOnly()
      if (!isAuthenticated || !userId) {
        return createUnauthorizedResponse()
      }

      const parsed = await parseRequest(duplicateMothershipChatContract, request, context)
      if (!parsed.success) return parsed.response
      const { chatId } = parsed.data.params

      const [parent] = await db
        .select({
          id: copilotChats.id,
          userId: copilotChats.userId,
          type: copilotChats.type,
          workspaceId: copilotChats.workspaceId,
          title: copilotChats.title,
          model: copilotChats.model,
          resources: copilotChats.resources,
          previewYaml: copilotChats.previewYaml,
          planArtifact: copilotChats.planArtifact,
          config: copilotChats.config,
        })
        .from(copilotChats)
        .where(eq(copilotChats.id, chatId))
        .limit(1)

      if (!parent || parent.userId !== userId || parent.type !== 'mothership') {
        return createNotFoundResponse('Chat not found')
      }

      if (parent.workspaceId) {
        await assertActiveWorkspaceAccess(parent.workspaceId, userId)
      }

      const sourceFiles = await listDuplicableChatFiles(db, chatId)
      const totalFileBytes = sourceFiles.reduce((sum, row) => sum + row.size, 0)
      if (totalFileBytes > 0) {
        const quotaCheck = await checkStorageQuota(userId, totalFileBytes)
        if (!quotaCheck.allowed) {
          return createBadRequestResponse(quotaCheck.error || 'Storage limit exceeded')
        }
      }

      const messages = await loadCopilotChatMessages(chatId)

      const parentResources = Array.isArray(parent.resources)
        ? (parent.resources as MothershipResource[])
        : []

      const newId = generateId()
      const title = `${parent.title ?? 'New chat'} (Copy)`
      const now = new Date()

      const result = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(copilotChats)
          .values({
            id: newId,
            userId,
            workspaceId: parent.workspaceId,
            type: parent.type,
            title,
            model: parent.model,
            resources: parentResources,
            previewYaml: parent.previewYaml,
            planArtifact: parent.planArtifact,
            config: parent.config,
            conversationId: null,
            updatedAt: now,
            lastSeenAt: now,
          })
          .returning({ id: copilotChats.id, workspaceId: copilotChats.workspaceId })

        if (!row) return null

        // File rows FK the new chat row, so the plan runs after the insert.
        const { idMap, keyMap, blobTasks } = await planChatFileCopies({
          tx,
          rows: sourceFiles,
          newChatId: newId,
          userId,
          now,
        })

        const maps = { fileIds: idMap, fileKeys: keyMap }
        if (idMap.size > 0 || keyMap.size > 0) {
          await tx
            .update(copilotChats)
            .set({ resources: rewriteResourceFileRefs(parentResources, maps) })
            .where(eq(copilotChats.id, newId))
        }

        await appendCopilotChatMessages(
          newId,
          rewriteMessageFileRefs(messages, maps),
          { chatModel: parent.model },
          tx
        )
        return { row, blobTasks }
      })

      if (!result) {
        return createInternalServerErrorResponse('Failed to create duplicated chat')
      }

      const { copied, failed } = await executeChatFileBlobCopies(result.blobTasks, {
        userId,
        workspaceId: parent.workspaceId ?? undefined,
      })
      if (failed > 0) {
        logger.warn('Some chat file blobs failed to copy during duplicate', {
          chatId,
          newChatId: newId,
          copied,
          failed,
        })
      }

      // Clone copilot-service conversation state (messages, active window, memory
      // files) in whole-chat mode. Best-effort: if the copilot service doesn't
      // have a row for the source chat yet (no messages sent), skip.
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
            userId,
          }),
          spanName: 'sim → go /api/chats/fork',
          operation: 'duplicate_chat',
        })
        if (!copilotRes.ok) {
          const text = await copilotRes.text().catch(() => '')
          logger.warn('Copilot duplicate returned non-OK', {
            status: copilotRes.status,
            body: text,
          })
        }
      } catch (err) {
        logger.warn('Failed to duplicate copilot-service conversation, skipping', { err })
      }

      if (result.row.workspaceId) {
        chatPubSub?.publishStatusChanged({
          workspaceId: result.row.workspaceId,
          chatId: newId,
          type: 'created',
        })
      }

      captureServerEvent(
        userId,
        'task_duplicated',
        { workspace_id: parent.workspaceId ?? '', source_chat_id: chatId },
        { groups: { workspace: parent.workspaceId ?? '' } }
      )

      return NextResponse.json({ success: true, id: newId })
    } catch (error) {
      if (isWorkspaceAccessDeniedError(error)) {
        return createForbiddenResponse('Workspace access denied')
      }
      logger.error('Error duplicating chat:', error)
      return createInternalServerErrorResponse('Failed to duplicate chat')
    }
  }
)
