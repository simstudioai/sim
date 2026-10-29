import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { describeError, toError } from '@sim/utils/errors'
import { inArray } from 'drizzle-orm'
import {
  chatBackendCleanupPayloadSchema,
  chatInlineImageCleanupPayloadSchema,
} from '@/lib/cleanup/chat-backend-cleanup'
import {
  CHAT_BACKEND_CLEANUP_EVENT,
  CHAT_INLINE_IMAGE_CLEANUP_EVENT,
} from '@/lib/cleanup/chat-backend-cleanup-event'
import { cleanupCopilotBackend, deletableChatFiles } from '@/lib/cleanup/chat-cleanup'
import { env } from '@/lib/core/config/env'
import {
  continueOutboxHandler,
  deferOutboxHandler,
  type OutboxEventContext,
  type OutboxHandlerRegistry,
} from '@/lib/core/outbox/service'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import { inlineChatImagePrefix } from '@/lib/mothership/chat/inline-image-key'
import { outboxDeadlineNear, sweepStoragePrefix } from '@/lib/uploads/core/prefix-sweep'
import { deleteFile } from '@/lib/uploads/core/storage-service'

const logger = createLogger('ChatBackendCleanupOutbox')

/** Most object deletes, or chat prefix sweeps, one handler run has in flight at once. */
const STORAGE_CONCURRENCY = 10

/** The ids among `chatIds` that still have a `copilot_chats` row. */
async function survivingChatIds(chatIds: readonly string[]): Promise<Set<string>> {
  if (chatIds.length === 0) return new Set()
  const rows = await db
    .select({ id: copilotChats.id })
    .from(copilotChats)
    .where(inArray(copilotChats.id, [...chatIds]))
  return new Set(rows.map(({ id }) => id))
}

/**
 * Sweeps `chatId`'s inline image prefix until it is empty, the deadline nears (`continue`), or a
 * listing stops advancing (`stalled`).
 */
async function sweepChatImages(
  chatId: string,
  context: OutboxEventContext
): Promise<'done' | 'continue' | 'stalled'> {
  const prefix = inlineChatImagePrefix(chatId)
  if (!prefix) {
    logger.warn('Skipping an inline image sweep for a chat id no image key can hold', {
      eventId: context.eventId,
      chatId,
    })
    return 'done'
  }
  for (;;) {
    context.signal.throwIfAborted()
    if (outboxDeadlineNear(context)) return 'continue'
    const outcome = await sweepStoragePrefix(prefix, 'mothership', context)
    if (outcome !== 'continue') return outcome
  }
}

export const chatBackendCleanupOutboxHandlers = {
  /**
   * Purges the copilot backend data and stored files of chats whose rows are gone; a surviving
   * chat keeps both, and a file another chat of its scope still references is kept
   * ({@link deletableChatFiles}). Any failure throws so the outbox retries; an object already gone
   * counts as deleted.
   */
  [CHAT_BACKEND_CLEANUP_EVENT]: async (rawPayload, context) => {
    const { chatIds, files } = chatBackendCleanupPayloadSchema.parse(rawPayload)
    context.signal.throwIfAborted()
    const survivingIds = await survivingChatIds([
      ...new Set([...chatIds, ...files.map((file) => file.chatId)]),
    ])
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
    const failures = await mapWithConcurrency(
      await deletableChatFiles(deletedFiles),
      STORAGE_CONCURRENCY,
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

  /**
   * Deletes everything under the `chat-images/<chatId>/` prefix of each chat whose row is gone, so
   * an image a turn published after the delete read the transcript goes too. Sweeps several chats
   * at once, checkpoints how many leading chats are finished, and continues in a later run once
   * the deadline nears.
   */
  [CHAT_INLINE_IMAGE_CLEANUP_EVENT]: async (rawPayload, context) => {
    const { chatIds, swept } = chatInlineImageCleanupPayloadSchema.parse(rawPayload)
    context.signal.throwIfAborted()
    const pending = chatIds.slice(swept)
    const survivingIds = await survivingChatIds(pending)
    const outcomes = await mapWithConcurrency(pending, STORAGE_CONCURRENCY, (chatId) =>
      survivingIds.has(chatId) ? Promise.resolve('done' as const) : sweepChatImages(chatId, context)
    )
    const unfinished = outcomes.findIndex((outcome) => outcome !== 'done')
    if (unfinished === -1) return
    if (unfinished > 0) await context.checkpointPayload({ swept: swept + unfinished })
    if (outcomes.includes('continue'))
      return continueOutboxHandler('Continuing chat inline image cleanup')
    return deferOutboxHandler('Chat inline image cleanup removed nothing from its listing')
  },
} satisfies OutboxHandlerRegistry
