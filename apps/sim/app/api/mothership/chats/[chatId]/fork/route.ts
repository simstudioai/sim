import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, eq, isNull } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { forkMothershipChatContract } from '@/lib/api/contracts/mothership-chats'
import { parseRequest } from '@/lib/api/server'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  type ChatBlobCopyTask,
  executeChatFileBlobCopies,
  filterForkableChatFiles,
  listForkableChatFiles,
  persistChatFileCopies,
  planChatFileCopies,
} from '@/lib/mothership/chat/fork-chat-files'
import { copyWorkerConversation } from '@/lib/mothership/chat/fork-worker'
import { loadCopilotChatMessages } from '@/lib/mothership/chat/lifecycle'
import { appendCopilotChatMessages } from '@/lib/mothership/chat/messages-store'
import {
  rewriteMessageFileRefs,
  rewriteResourceFileRefs,
} from '@/lib/mothership/chat/rewrite-file-references'
import { chatPubSub } from '@/lib/mothership/chat-status'
import {
  authenticateCopilotRequestSessionOnly,
  createBadRequestResponse,
  createForbiddenResponse,
  createInternalServerErrorResponse,
  createNotFoundResponse,
  createUnauthorizedResponse,
} from '@/lib/mothership/request/http'
import { type MothershipResource, sanitizeChatResources } from '@/lib/mothership/resources/types'
import { captureServerEvent } from '@/lib/posthog/server'
import { deleteFile } from '@/lib/uploads/core/storage-service'
import {
  assertActiveWorkspaceAccess,
  isWorkspaceAccessDeniedError,
} from '@/lib/workspaces/permissions/utils'

const logger = createLogger('ForkChatAPI')

/**
 * POST /api/mothership/chats/[chatId]/fork
 * Creates a new chat branched from the given chat, keeping messages up to and
 * including the specified message, along with the chat's uploads born
 * at-or-before the fork point (a file travels iff the user message that
 * carried it is kept). Resources and copilot-side state are copied.
 *
 * Every copied file gets a fresh row id and storage key, and every
 * in-transcript file reference is re-pointed at the copies so the new chat
 * survives deletion of the source chat. Mothership files remain excluded from
 * workspace storage accounting. File resources whose chat-owned file was NOT
 * copied (uploads born after the cut) are dropped from the new chat's resources
 * rather than left as ghosts pointing at the source chat's files.
 */
export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ chatId: string }> }) => {
    let preparedBlobs: ChatBlobCopyTask[] = []
    let published = false
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
          config: copilotChats.config,
        })
        .from(copilotChats)
        .where(and(eq(copilotChats.id, chatId), isNull(copilotChats.deletedAt)))
        .limit(1)

      if (!parent || parent.userId !== userId || parent.type !== 'mothership') {
        return createNotFoundResponse('Chat not found')
      }

      if (!parent.workspaceId)
        return createBadRequestResponse('A workspace is required to fork a chat')
      await assertActiveWorkspaceAccess(parent.workspaceId, userId)

      const messages = await loadCopilotChatMessages(chatId)
      const forkIdx = messages.findIndex((m) => m.id === upToMessageId)
      if (forkIdx < 0) {
        return createBadRequestResponse('Message not found in chat')
      }
      const forkedMessages = messages.slice(0, forkIdx + 1)

      // Single workspace_files read per fork: every chat-owned upload. The
      // copied set is timeline-cut to the kept message slice in memory (files
      // born after the fork point stay behind).
      const chatOwnedFiles = await listForkableChatFiles(db, chatId)
      const sourceFiles = filterForkableChatFiles(
        chatOwnedFiles,
        new Set(forkedMessages.map((m) => m.id))
      )

      // Resources are stored as a jsonb array on the chat row. They carry no
      // timestamps, so they can't be timeline-cut like messages — instead,
      // file resources whose chat-owned file is NOT copied (uploads born
      // after the cut) are dropped in the rewrite below; everything else is
      // copied.
      const parentResources = sanitizeChatResources(
        Array.isArray(parent.resources) ? (parent.resources as MothershipResource[]) : []
      )

      // The source chat's chat-owned file ids (no cut) — the "is this
      // resource a ghost?" test set for the rewrite.
      const chatOwnedFileIds = new Set(chatOwnedFiles.map((row) => row.id))

      const newId = generateId()
      // Strip a leading "Fork | " so titles don't stack prefixes when forking
      // a forked chat.
      const baseTitle = (parent.title ?? 'New chat').replace(/^Fork \| /, '')
      const title = `Fork | ${baseTitle}`
      const now = new Date()

      const plan = planChatFileCopies({ rows: sourceFiles, newChatId: newId, userId, now })
      preparedBlobs = plan.blobTasks
      const { failed, failedCopyIds } = await executeChatFileBlobCopies(plan.blobTasks)
      const failedIds = new Set(failedCopyIds)
      const maps = { fileIds: plan.idMap, fileKeys: plan.keyMap }
      const newChatResources = rewriteResourceFileRefs(
        parentResources,
        maps,
        chatOwnedFileIds
      ).filter((resource) => resource.type !== 'file' || !failedIds.has(resource.id))
      const cutUser = [...forkedMessages].reverse().find((message) => message.role === 'user')
      if (!cutUser) throw new Error('The fork has no user message')
      await copyWorkerConversation({
        sourceChatId: chatId,
        newChatId: newId,
        workspaceId: parent.workspaceId,
        userId,
        upToMessageId: cutUser.id,
        includeResponse: forkedMessages.at(-1)?.role === 'assistant',
        fileIds: Object.fromEntries(plan.idMap),
        fileKeys: Object.fromEntries(plan.keyMap),
      })

      /** Publish only after both the file bytes and the worker conversation are prepared. */
      const newChat = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(copilotChats)
          .values({
            id: newId,
            userId,
            workspaceId: parent.workspaceId,
            type: parent.type,
            title,
            model: parent.model,
            resources: newChatResources,
            previewYaml: parent.previewYaml,
            config: parent.config,
            conversationId: null,
            updatedAt: now,
            lastSeenAt: now,
          })
          .returning({ id: copilotChats.id, workspaceId: copilotChats.workspaceId })
        if (!row) throw new Error('Failed to create forked chat')
        await persistChatFileCopies(tx, plan, failedIds)
        await appendCopilotChatMessages(
          newId,
          rewriteMessageFileRefs(forkedMessages, maps),
          { chatModel: parent.model },
          tx
        )
        return row
      })
      published = true

      if (newChat.workspaceId) {
        chatPubSub?.publishStatusChanged({
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

      return NextResponse.json({
        success: true,
        id: newId,
        ...(failed > 0 ? { failedFileCopies: failed } : {}),
      })
    } catch (error) {
      if (!published) {
        await mapWithConcurrency(preparedBlobs, 4, async (task) => {
          try {
            await deleteFile({ key: task.targetKey, context: task.context })
          } catch (cleanupError) {
            logger.warn('Failed to clean up an unpublished fork file', {
              key: task.targetKey,
              error: cleanupError,
            })
          }
        })
      }
      if (isWorkspaceAccessDeniedError(error)) {
        return createForbiddenResponse('Workspace access denied')
      }
      logger.error('Error forking chat:', error)
      return createInternalServerErrorResponse('Failed to fork chat')
    }
  }
)
