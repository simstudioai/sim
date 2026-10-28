import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { describeError, toError } from '@sim/utils/errors'
import { inArray } from 'drizzle-orm'
import { chatBackendCleanupPayloadSchema } from '@/lib/cleanup/chat-backend-cleanup'
import { CHAT_BACKEND_CLEANUP_EVENT } from '@/lib/cleanup/chat-backend-cleanup-event'
import {
  cleanupCopilotBackend,
  organizationAttachmentsStillReferenced,
} from '@/lib/cleanup/chat-cleanup'
import { env } from '@/lib/core/config/env'
import type { OutboxHandlerRegistry } from '@/lib/core/outbox/service'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import { deleteFile } from '@/lib/uploads/core/storage-service'

const FILE_DELETE_CONCURRENCY = 10

export const chatBackendCleanupOutboxHandlers = {
  /**
   * Purges the copilot backend data and stored files of chats whose rows are gone. A chat whose
   * row survived (its delete was spared, rolled back, or never happened) keeps both. Any failure
   * throws so the outbox retries it: a failed backend call, a failed object delete, or chat ids
   * queued while `COPILOT_API_KEY` was set reaching a processor without it. An object already
   * gone counts as deleted, so a retry repeats only what is left.
   */
  [CHAT_BACKEND_CLEANUP_EVENT]: async (rawPayload, context) => {
    const { chatIds, files } = chatBackendCleanupPayloadSchema.parse(rawPayload)
    context.signal.throwIfAborted()
    const named = [...new Set([...chatIds, ...files.map((file) => file.chatId)])]
    const surviving = await db
      .select({ id: copilotChats.id })
      .from(copilotChats)
      .where(inArray(copilotChats.id, named))
    const survivingIds = new Set(surviving.map(({ id }) => id))
    const deletedChatIds = chatIds.filter((id) => !survivingIds.has(id))
    const deletedFiles = files.filter((file) => !survivingIds.has(file.chatId))

    if (deletedChatIds.length > 0) {
      context.signal.throwIfAborted()
      if (!env.COPILOT_API_KEY) throw new Error('Copilot cleanup is not configured')
      const result = await cleanupCopilotBackend(
        deletedChatIds,
        `ChatBackendCleanup:${context.eventId}`
      )
      if (result.failed > 0) throw new Error('Copilot backend chat cleanup failed')
    }

    if (deletedFiles.length === 0) return
    const stillReferenced = await organizationAttachmentsStillReferenced(deletedFiles)
    const failures = await mapWithConcurrency(
      deletedFiles.filter((file) => !stillReferenced.has(file.key)),
      FILE_DELETE_CONCURRENCY,
      async ({ key, context: storageContext }) => {
        context.signal.throwIfAborted()
        try {
          await deleteFile({ key, context: storageContext, signal: context.signal })
        } catch (error) {
          if (describeError(error).code !== 'ENOENT') return toError(error)
        }
      }
    )
    const failure = failures.find((error) => error !== undefined)
    if (failure) throw failure
  },
} satisfies OutboxHandlerRegistry
