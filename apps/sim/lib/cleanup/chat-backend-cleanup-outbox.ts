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
import {
  continueOutboxHandler,
  deferOutboxHandler,
  type OutboxEventContext,
  type OutboxHandlerRegistry,
} from '@/lib/core/outbox/service'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import {
  INLINE_CHAT_IMAGE_PREFIX,
  inlineImageRequestIdSchema,
} from '@/lib/mothership/chat/inline-image-reference'
import { outboxDeadlineNear } from '@/lib/uploads/core/prefix-sweep'
import { deleteFile } from '@/lib/uploads/core/storage-service'
import { sweepStoragePrefix } from '@/lib/uploads/core/sweep-prefix'

const FILE_DELETE_CONCURRENCY = 10

/**
 * Deletes every inline image under each deleted chat's `chat-images/<chatId>/` prefix, from the
 * `from`th chat on. `swept` is how many leading chats are done: all of them unless the deadline
 * neared (`continue`) or a listing stopped advancing (`stalled`).
 */
async function sweepInlineImages(
  chatIds: readonly string[],
  deleted: ReadonlySet<string>,
  from: number,
  context: OutboxEventContext
): Promise<{ swept: number; outcome: 'done' | 'continue' | 'stalled' }> {
  for (let index = from; index < chatIds.length; index++) {
    const chatId = chatIds[index]
    // A chat id outside the image key grammar never had an image stored under it.
    if (!deleted.has(chatId) || !inlineImageRequestIdSchema.safeParse(chatId).success) continue
    for (;;) {
      context.signal.throwIfAborted()
      const outcome = await sweepStoragePrefix(
        `${INLINE_CHAT_IMAGE_PREFIX}${chatId}/`,
        'mothership',
        context
      )
      if (outcome === 'done') break
      if (outcome === 'stalled' || outboxDeadlineNear(context)) return { swept: index, outcome }
    }
    if (outboxDeadlineNear(context)) return { swept: index + 1, outcome: 'continue' }
  }
  return { swept: chatIds.length, outcome: 'done' }
}

export const chatBackendCleanupOutboxHandlers = {
  /**
   * Purges the inline images, copilot backend data and stored files of chats whose rows are gone.
   * A chat whose row survived (its delete was spared, rolled back, or never happened) keeps all
   * three. Inline images go by the chat's prefix rather than by key, so one a turn published after
   * the delete read the transcript goes too; the sweep checkpoints how many chats it finished and
   * continues in a later run once its deadline nears. Any failure throws so the outbox retries it:
   * a failed backend call, a failed object delete, or chat ids queued for the backend reaching a
   * processor without `COPILOT_API_KEY`. An object already gone counts as deleted, so a retry
   * repeats only what is left.
   */
  [CHAT_BACKEND_CLEANUP_EVENT]: async (rawPayload, context) => {
    const { chatIds, files, copilotBackend, imagesSwept } =
      chatBackendCleanupPayloadSchema.parse(rawPayload)
    context.signal.throwIfAborted()
    const named = [...new Set([...chatIds, ...files.map((file) => file.chatId)])]
    const surviving = await db
      .select({ id: copilotChats.id })
      .from(copilotChats)
      .where(inArray(copilotChats.id, named))
    const survivingIds = new Set(surviving.map(({ id }) => id))
    const deletedChatIds = chatIds.filter((id) => !survivingIds.has(id))
    const deletedFiles = files.filter((file) => !survivingIds.has(file.chatId))

    if (imagesSwept < chatIds.length) {
      const sweep = await sweepInlineImages(chatIds, new Set(deletedChatIds), imagesSwept, context)
      if (sweep.swept > imagesSwept) await context.checkpointPayload({ imagesSwept: sweep.swept })
      if (sweep.outcome === 'continue')
        return continueOutboxHandler('Continuing chat inline image cleanup')
      if (sweep.outcome === 'stalled')
        return deferOutboxHandler('Chat inline image cleanup removed nothing from its listing')
    }

    if (copilotBackend && deletedChatIds.length > 0) {
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
