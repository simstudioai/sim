import type { db } from '@sim/db'
import { copilotChats, workflow, workspace } from '@sim/db/schema'
import { chunkArray } from '@sim/utils/helpers'
import { eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { CHAT_BACKEND_CLEANUP_EVENT } from '@/lib/cleanup/chat-backend-cleanup-event'
import { env } from '@/lib/core/config/env'
import { enqueueOutboxEvents, MAX_BULK_ENQUEUE_EVENTS } from '@/lib/core/outbox/service'
import type { DbOrTx } from '@/lib/db/types'

/** Most chat ids one cleanup event carries, so one handler run is one bounded backend call. */
const CHAT_BACKEND_CLEANUP_BATCH_SIZE = 100

export const chatBackendCleanupPayloadSchema = z
  .object({
    chatIds: z.array(z.string().min(1).max(255)).min(1).max(CHAT_BACKEND_CLEANUP_BATCH_SIZE),
  })
  .strict()

type ChatBackendCleanupPayload = z.infer<typeof chatBackendCleanupPayloadSchema>

/**
 * Queues the copilot backend cleanup of chats a delete is about to cascade away, one bounded
 * event per {@link CHAT_BACKEND_CLEANUP_BATCH_SIZE} chats. Call it in the deleting transaction so
 * a rollback leaves no cleanup behind; the handler purges only chats whose rows are gone, so a
 * chat the delete ends up sparing keeps its backend data. Without `COPILOT_API_KEY` this Sim
 * never reached a copilot backend, so there is nothing to purge and nothing is queued.
 */
export async function enqueueChatBackendCleanup(
  executor: Pick<typeof db, 'insert'>,
  chatIds: readonly string[]
): Promise<void> {
  if (!env.COPILOT_API_KEY) return
  const payloads = chunkArray([...new Set(chatIds)], CHAT_BACKEND_CLEANUP_BATCH_SIZE).map(
    (batch): ChatBackendCleanupPayload => ({ chatIds: batch })
  )
  for (const events of chunkArray(payloads, MAX_BULK_ENQUEUE_EVENTS)) {
    await enqueueOutboxEvents(executor, CHAT_BACKEND_CLEANUP_EVENT, events)
  }
}

/**
 * Every chat the removal of an account and the given workspaces cascades away: the account's own
 * chats, chats in those workspaces, and chats on workflows the account created or the workspaces
 * hold (`copilot_chats` cascades from `user`, `workspace` and `workflow`, and `workflow` from
 * `user` and `workspace`). A chat a handover later spares is skipped by the handler's re-check.
 */
export async function collectAccountRemovalChatIds(
  executor: DbOrTx,
  params: { userId: string; workspaceIds: readonly string[] }
): Promise<string[]> {
  const workspaceIds = [...params.workspaceIds]
  const chatId = { id: copilotChats.id }
  const [own, onOwnWorkflows, ...inWorkspaces] = await Promise.all([
    executor.select(chatId).from(copilotChats).where(eq(copilotChats.userId, params.userId)),
    executor
      .select(chatId)
      .from(copilotChats)
      .innerJoin(workflow, eq(workflow.id, copilotChats.workflowId))
      .where(eq(workflow.userId, params.userId)),
    ...(workspaceIds.length > 0
      ? [
          executor
            .select(chatId)
            .from(copilotChats)
            .where(inArray(copilotChats.workspaceId, workspaceIds)),
          executor
            .select(chatId)
            .from(copilotChats)
            .innerJoin(workflow, eq(workflow.id, copilotChats.workflowId))
            .where(inArray(workflow.workspaceId, workspaceIds)),
        ]
      : []),
  ])
  return [...new Set([own, onOwnWorkflows, ...inWorkspaces].flat().map((row) => row.id))]
}

/** The workspaces a bare `DELETE FROM "user"` cascades away: every one the account owns. */
export async function ownedWorkspaceIds(executor: DbOrTx, userId: string): Promise<string[]> {
  const owned = await executor
    .select({ id: workspace.id })
    .from(workspace)
    .where(eq(workspace.ownerId, userId))
  return owned.map((row) => row.id)
}
