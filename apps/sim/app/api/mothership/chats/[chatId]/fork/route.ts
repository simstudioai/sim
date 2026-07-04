import { db } from '@sim/db'
import { copilotChats, workspaceFiles } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { forkMothershipChatContract } from '@/lib/api/contracts/mothership-chats'
import { parseRequest } from '@/lib/api/server'
import { checkStorageQuota } from '@/lib/billing/storage'
import {
  executeChatFileBlobCopies,
  filterForkableChatFiles,
  listDuplicableChatFiles,
  planChatFileCopies,
} from '@/lib/copilot/chat/fork-chat-files'
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
import { removeChatResources } from '@/lib/copilot/resources/persistence'
import type { MothershipResource } from '@/lib/copilot/resources/types'
import { getMothershipBaseURL, getMothershipSourceEnvHeaders } from '@/lib/copilot/server/agent-url'
import { env } from '@/lib/core/config/env'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import {
  assertActiveWorkspaceAccess,
  isWorkspaceAccessDeniedError,
} from '@/lib/workspaces/permissions/utils'

const logger = createLogger('ForkChatAPI')

/**
 * POST /api/mothership/chats/[chatId]/fork
 * Creates a new chat copied from the given chat, in one of two modes.
 *
 * Branch (upToMessageId set): keeps messages up to and including the specified
 * message, along with the chat's uploads AND agent-generated outputs born
 * at-or-before the fork point (a file travels iff the user message that
 * carried/requested it is kept). The copy is titled "Fork | <name>".
 *
 * Whole-chat duplicate (upToMessageId omitted): keeps every message, copies
 * every upload and output with no cut, titles the copy "<name> (Copy)", and
 * asks the copilot service for its whole-chat clone mode (compacted working
 * memory preserved verbatim — nothing is cut, so nothing can leak across a
 * cut).
 *
 * In both modes every copied file gets a fresh row id and storage key, bytes
 * are physically copied and counted against the storage quota, and every
 * in-transcript file reference is re-pointed at the copies so the new chat
 * survives deletion of the source chat. File resources whose chat-owned file
 * was NOT copied (a branch fork leaves post-cut uploads/outputs behind) are
 * dropped from the new chat's resources rather than left as ghosts pointing
 * at the source chat's files.
 */
export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ chatId: string }> }) => {
    try {
      const { userId, isAuthenticated } = await authenticateCopilotRequestSessionOnly()
      if (!isAuthenticated || !userId) {
        return createUnauthorizedResponse()
      }

      const parsed = await parseRequest(forkMothershipChatContract, request, context)
      if (!parsed.success) return parsed.response
      const { chatId } = parsed.data.params
      const { upToMessageId } = parsed.data.body
      const isWholeChatDuplicate = !upToMessageId

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

      const messages = await loadCopilotChatMessages(chatId)
      let forkedMessages = messages
      if (upToMessageId) {
        const forkIdx = messages.findIndex((m) => m.id === upToMessageId)
        if (forkIdx < 0) {
          return createBadRequestResponse('Message not found in chat')
        }
        forkedMessages = messages.slice(0, forkIdx + 1)
      }

      // Single workspace_files read per fork: every chat-owned file (uploads +
      // outputs). A whole-chat duplicate copies all of them; a branch fork
      // timeline-cuts to the kept message slice in memory (files born after
      // the fork point stay behind).
      const chatOwnedFiles = await listDuplicableChatFiles(db, chatId)
      const sourceFiles = isWholeChatDuplicate
        ? chatOwnedFiles
        : filterForkableChatFiles(chatOwnedFiles, new Set(forkedMessages.map((m) => m.id)))
      const totalFileBytes = sourceFiles.reduce((sum, row) => sum + row.size, 0)
      if (totalFileBytes > 0) {
        const quotaCheck = await checkStorageQuota(userId, totalFileBytes)
        if (!quotaCheck.allowed) {
          return createBadRequestResponse(quotaCheck.error || 'Storage limit exceeded')
        }
      }

      // Resources are stored as a jsonb array on the chat row. They carry no
      // timestamps, so they can't be timeline-cut like messages — instead,
      // file resources whose chat-owned file is NOT copied (uploads/outputs
      // born after a branch fork's cut) are dropped in the rewrite below;
      // everything else is copied.
      const parentResources = Array.isArray(parent.resources)
        ? (parent.resources as MothershipResource[])
        : []

      // The source chat's chat-owned file ids (uploads + outputs, no cut) —
      // the "is this resource a ghost?" test set for the rewrite.
      const chatOwnedFileIds = new Set(chatOwnedFiles.map((row) => row.id))

      const newId = generateId()
      const baseTitle = (parent.title ?? 'New chat').replace(/^Fork \| /, '')
      const title = isWholeChatDuplicate
        ? `${parent.title ?? 'New chat'} (Copy)`
        : `Fork | ${baseTitle}`
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
        const newChatResources = rewriteResourceFileRefs(parentResources, maps, chatOwnedFileIds)
        // Skip the redundant update only when the rewrite changed nothing:
        // no ids re-pointed AND no ghost resources dropped.
        if (
          idMap.size > 0 ||
          keyMap.size > 0 ||
          newChatResources.length !== parentResources.length
        ) {
          await tx
            .update(copilotChats)
            .set({ resources: newChatResources })
            .where(eq(copilotChats.id, newId))
        }

        await appendCopilotChatMessages(
          newId,
          rewriteMessageFileRefs(forkedMessages, maps),
          { chatModel: parent.model },
          tx
        )
        return { row, blobTasks }
      })

      if (!result) {
        return createInternalServerErrorResponse('Failed to create forked chat')
      }
      const newChat = result.row

      const { copied, failed, failedCopyIds } = await executeChatFileBlobCopies(result.blobTasks, {
        userId,
        workspaceId: parent.workspaceId ?? undefined,
      })
      if (failed > 0) {
        // A failed blob copy leaves a committed row with no bytes behind it.
        // Cleanly absent beats present-but-broken: hard-delete the dead rows
        // (they vanish from the VFS listings and name resolution) and drop
        // their resource chips from the new chat. Inline transcript embeds
        // can't be healed — those 404 — which is what `failedFileCopies` in
        // the response warns the user about.
        try {
          await db.delete(workspaceFiles).where(inArray(workspaceFiles.id, failedCopyIds))
          await removeChatResources(
            newId,
            failedCopyIds.map((id) => ({ type: 'file' as const, id, title: '' }))
          )
        } catch (cleanupError) {
          logger.error('Failed to clean up dead file rows after blob-copy failure', {
            newChatId: newId,
            failedCopyIds,
            error: cleanupError,
          })
        }
        logger.warn('Some chat file blobs failed to copy during fork', {
          chatId,
          newChatId: newId,
          copied,
          failed,
        })
      }

      // Clone copilot-service conversation state (messages, active_messages, memory files).
      // Omitting upToMessageId selects the service's whole-chat mode, which preserves the
      // compacted working memory verbatim instead of rebuilding it from raw messages.
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
            ...(upToMessageId ? { upToMessageId } : {}),
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
        chatPubSub?.publishStatusChanged({
          workspaceId: newChat.workspaceId,
          chatId: newId,
          type: 'created',
        })
      }

      captureServerEvent(
        userId,
        'task_forked',
        {
          workspace_id: parent.workspaceId ?? '',
          source_chat_id: chatId,
          whole_chat: isWholeChatDuplicate,
        },
        { groups: { workspace: parent.workspaceId ?? '' } }
      )

      return NextResponse.json({
        success: true,
        id: newId,
        ...(failed > 0 ? { failedFileCopies: failed } : {}),
      })
    } catch (error) {
      if (isWorkspaceAccessDeniedError(error)) {
        return createForbiddenResponse('Workspace access denied')
      }
      logger.error('Error forking chat:', error)
      return createInternalServerErrorResponse('Failed to fork chat')
    }
  }
)
