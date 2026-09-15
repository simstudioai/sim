import type { SessionPrincipal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, eq, isNull } from 'drizzle-orm'
import { defineWorkspaceOperation } from '@/lib/core/application'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import { defineAuthorizedChatUseCase } from '@/lib/mothership/chat/application/authorized-chat-use-case'
import { resolveOwnedChatContext } from '@/lib/mothership/chat/application/context'
import {
  type ChatBlobCopyTask,
  executeChatFileBlobCopies,
  filterForkableChatFiles,
  listForkableChatFiles,
  persistChatFileCopies,
  planChatFileCopies,
} from '@/lib/mothership/chat/fork-chat-files'
import { planForkInlineImages } from '@/lib/mothership/chat/fork-inline-images'
import { copyWorkerConversation } from '@/lib/mothership/chat/fork-worker'
import { loadCopilotChatMessages } from '@/lib/mothership/chat/lifecycle'
import { appendCopilotChatMessages } from '@/lib/mothership/chat/messages-store'
import {
  rewriteMessageFileRefs,
  rewriteResourceFileRefs,
} from '@/lib/mothership/chat/rewrite-file-references'
import { publishChatStatusChanged } from '@/lib/mothership/chat-status'
import { type MothershipResource, sanitizeChatResources } from '@/lib/mothership/resources/types'
import { captureServerEvent } from '@/lib/posthog/server'
import { deleteFile } from '@/lib/uploads/core/storage-service'

const logger = createLogger('ForkChat')
interface ForkChatInput {
  chatId: string
  upToMessageId: string
}

/** Copies a private conversation under its current owner policy before publishing its local rows. */
export const forkChat = defineAuthorizedChatUseCase({
  /** permission-group-exempt: workspace forks retain the existing membership-only private-history policy. */
  operation: defineWorkspaceOperation({
    id: 'mothership.chats.fork',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'none',
    principalKinds: ['session'],
  }),
  organizationOperation: defineOrganizationOperation({
    id: 'mothership.chats.fork',
    minimumRole: 'member',
    capability: 'copilot.use',
    principalKinds: ['session'],
  }),
  async resolveContext({
    principal,
    input,
  }: {
    principal: SessionPrincipal
    input: ForkChatInput
  }) {
    const owner = await resolveOwnedChatContext(principal, input.chatId)
    const [parent] = await db
      .select()
      .from(copilotChats)
      .where(
        and(
          eq(copilotChats.id, input.chatId),
          eq(copilotChats.userId, owner.userId),
          isNull(copilotChats.deletedAt),
          owner.organizationId
            ? eq(copilotChats.organizationId, owner.organizationId)
            : isNull(copilotChats.organizationId),
          owner.workspaceId
            ? eq(copilotChats.workspaceId, owner.workspaceId)
            : isNull(copilotChats.workspaceId)
        )
      )
      .limit(1)
    if (!parent || parent.type !== 'mothership')
      throw new OrchestrationError('not_found', 'Chat not found')
    return { ...owner, parent }
  },
  authorizationOptions: {},
  async execute({ context, input }) {
    const { parent, userId } = context
    const { chatId, upToMessageId } = input
    let preparedBlobs: ChatBlobCopyTask[] = []
    let published = false
    try {
      const messages = await loadCopilotChatMessages(chatId)
      const forkIdx = messages.findIndex((m) => m.id === upToMessageId)
      if (forkIdx < 0) {
        throw new OrchestrationError('validation', 'Message not found in chat')
      }
      const forkedMessages = messages.slice(0, forkIdx + 1)

      /** Single workspace_files read per fork: every chat-owned upload. The copied set is timeline-cut to the kept message slice in memory (files born after the fork point stay behind). */
      const chatOwnedFiles = context.workspaceId ? await listForkableChatFiles(db, chatId) : []
      const sourceFiles = filterForkableChatFiles(
        chatOwnedFiles,
        new Set(forkedMessages.map((m) => m.id))
      )

      /** Resources are stored as a jsonb array on the chat row. They carry no timestamps, so they can't be timeline-cut like messages — instead, file resources whose chat-owned file is NOT copied (uploads born after the cut) are dropped in the rewrite below; everything else is copied. */
      const parentResources = sanitizeChatResources(
        Array.isArray(parent.resources) ? (parent.resources as MothershipResource[]) : []
      )

      /** The source chat's chat-owned file ids (no cut) — the "is this resource a ghost?" test set for the rewrite. */
      const chatOwnedFileIds = new Set(chatOwnedFiles.map((row) => row.id))

      const newId = generateId()
      /** Strip a leading "Fork | " so titles don't stack prefixes when forking a forked chat. */
      const baseTitle = (parent.title ?? 'New chat').replace(/^Fork \| /, '')
      const title = `Fork | ${baseTitle}`
      const now = new Date()

      const plan = planChatFileCopies({ rows: sourceFiles, newChatId: newId, userId, now })
      preparedBlobs = [...plan.blobTasks, ...planForkInlineImages(forkedMessages, chatId, newId)]
      const { failed, failedCopyIds } = await executeChatFileBlobCopies(preparedBlobs)
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
        ...(context.organizationId
          ? { organizationId: context.organizationId }
          : { workspaceId: context.workspaceId }),
        userId,
        upToMessageId: cutUser.id,
        includeResponse: forkedMessages.at(-1)?.role === 'assistant',
        fileIds: Object.fromEntries(plan.idMap),
        fileKeys: Object.fromEntries(plan.keyMap),
      })

      /** Publish only after both the file bytes and the worker conversation are prepared. */
      await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(copilotChats)
          .values({
            id: newId,
            userId,
            workspaceId: parent.workspaceId,
            organizationId: parent.organizationId,
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

      publishChatStatusChanged({ ...parent, userId }, { chatId: newId, type: 'created' })

      captureServerEvent(
        userId,
        'task_forked',
        {
          ...(context.organizationId
            ? { organization_id: context.organizationId }
            : { workspace_id: context.workspaceId! }),
          source_chat_id: chatId,
        },
        {
          groups: context.organizationId
            ? { organization: context.organizationId }
            : { workspace: context.workspaceId! },
        }
      )

      return {
        success: true as const,
        id: newId,
        ...(failed > 0 ? { failedFileCopies: failed } : {}),
      }
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
      throw error
    }
  },
})
