import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { inArray } from 'drizzle-orm'
import { chatBackendCleanupPayloadSchema } from '@/lib/cleanup/chat-backend-cleanup'
import { CHAT_BACKEND_CLEANUP_EVENT } from '@/lib/cleanup/chat-backend-cleanup-event'
import { cleanupCopilotBackend } from '@/lib/cleanup/chat-cleanup'
import type { OutboxHandlerRegistry } from '@/lib/core/outbox/service'

export const chatBackendCleanupOutboxHandlers = {
  /**
   * Purges the copilot backend data of chats whose rows are gone. A chat whose row survived (its
   * delete was spared or rolled back) keeps its data; a failed backend call throws so the outbox
   * retries it, and a deployment without a copilot key completes with nothing to purge.
   */
  [CHAT_BACKEND_CLEANUP_EVENT]: async (rawPayload, context) => {
    const { chatIds } = chatBackendCleanupPayloadSchema.parse(rawPayload)
    context.signal.throwIfAborted()
    const surviving = await db
      .select({ id: copilotChats.id })
      .from(copilotChats)
      .where(inArray(copilotChats.id, chatIds))
    const survivingIds = new Set(surviving.map(({ id }) => id))
    const deletedIds = chatIds.filter((id) => !survivingIds.has(id))
    if (deletedIds.length === 0) return
    context.signal.throwIfAborted()
    const result = await cleanupCopilotBackend(deletedIds, `ChatBackendCleanup:${context.eventId}`)
    if (result.failed > 0) throw new Error('Copilot backend chat cleanup failed')
  },
} satisfies OutboxHandlerRegistry
