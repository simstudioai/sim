import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { enqueueChatBackendCleanup } from '@/lib/cleanup/chat-backend-cleanup'
import { collectChatFiles } from '@/lib/cleanup/chat-files'
import { stopLiveRunsTx } from '@/lib/mothership/async-runs/repository'
import { deliverRunStops } from '@/lib/mothership/request/application/stop-delivery'

interface DeletedChatOwner {
  workspaceId: string | null
  organizationId: string | null
}

/**
 * Moves a Mothership chat to Recently Deleted and stops its live runs in the same
 * transaction, so the chat cannot be deleted while a run keeps working in it and a restore
 * cannot revive the run. Null when the chat was not the user's, or was already deleted.
 */
export async function softDeleteMothershipChat(params: {
  chatId: string
  userId: string
}): Promise<DeletedChatOwner | null> {
  const deleted = await db.transaction(async (tx) => {
    const [chat] = await tx
      .update(copilotChats)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(copilotChats.id, params.chatId),
          eq(copilotChats.userId, params.userId),
          eq(copilotChats.type, 'mothership'),
          isNull(copilotChats.deletedAt)
        )
      )
      .returning({
        workspaceId: copilotChats.workspaceId,
        organizationId: copilotChats.organizationId,
      })
    if (!chat) return null
    return { chat, stoppedRuns: await stopLiveRunsTx(tx, { chatIds: [params.chatId] }) }
  })
  if (!deleted) return null
  deliverRunStops(deleted.stoppedRuns)
  return deleted.chat
}

/**
 * Permanently deletes a copilot chat and stops its live runs in the same transaction, which also
 * queues the purge of what lives outside Sim's rows: the copilot backend's chat data and the
 * chat's stored files. Their keys are read under the chat row's lock, so no message or file
 * naming the chat can commit between that read and the delete that cascades them away, and the
 * purge is recorded exactly when the delete commits. Null when the chat was not the user's.
 */
export async function deleteCopilotChat(params: {
  chatId: string
  userId: string
}): Promise<DeletedChatOwner | null> {
  const owned = and(eq(copilotChats.id, params.chatId), eq(copilotChats.userId, params.userId))
  const deleted = await db.transaction(async (tx) => {
    const [chat] = await tx
      .select({
        workspaceId: copilotChats.workspaceId,
        organizationId: copilotChats.organizationId,
      })
      .from(copilotChats)
      .where(owned)
      .for('update')
    if (!chat) return null
    /** Collected before the delete cascades the run, message and file rows away. */
    const stoppedRuns = await stopLiveRunsTx(tx, { chatIds: [params.chatId] })
    await enqueueChatBackendCleanup(tx, {
      chatIds: [params.chatId],
      files: await collectChatFiles([params.chatId], tx),
    })
    await tx.delete(copilotChats).where(owned)
    return { chat, stoppedRuns }
  })
  if (!deleted) return null
  deliverRunStops(deleted.stoppedRuns)
  return deleted.chat
}
