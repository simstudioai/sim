import { chunkArray } from '@sim/utils/helpers'
import { z } from 'zod'
import { enqueueOutboxEvent } from '@/lib/core/outbox/service'
import type { DbTransaction } from '@/lib/db/types'

/**
 * Queuing the worker-side move of chats Sim moved out of an organization into a workspace, apart
 * from the handler that calls the worker, so the membership transaction that queues it does not
 * load the worker client or Stop delivery.
 */

export const CHAT_RESCOPE_EVENT = 'copilot.chats.rescope'

/** The worker's `RescopeChatsRequest` takes at most this many chats per call. */
const CHAT_RESCOPE_BATCH_SIZE = 1000

const stoppedRunSchema = z
  .object({
    id: z.string().min(1),
    streamId: z.string().min(1),
    userId: z.string().min(1),
    chatId: z.string().min(1),
    desktopDeviceId: z.string().min(1).nullable(),
  })
  .strict()

export const chatRescopePayloadSchema = z
  .object({
    /** The chats' owner, whose mothership environment the worker call goes to. */
    userId: z.string().min(1),
    fromOrganizationId: z.string().min(1).max(200),
    toWorkspaceId: z.string().min(1),
    chatIds: z.array(z.string().uuid()).min(1).max(CHAT_RESCOPE_BATCH_SIZE),
    /** Runs the move stopped, whose Stop the handler delivers before moving the worker's copy. */
    stoppedRuns: z.array(stoppedRunSchema),
  })
  .strict()

export type ChatRescopePayload = z.infer<typeof chatRescopePayloadSchema>

/**
 * Queues the worker-side move of `chatIds`, in batches the worker accepts, in the caller's
 * transaction, so the worker follows exactly when Sim's move commits. The first batch carries the
 * stopped runs. Returns the queued event ids.
 */
export async function enqueueChatRescopeTx(
  tx: DbTransaction,
  input: Omit<ChatRescopePayload, 'chatIds'> & { chatIds: readonly string[] }
): Promise<string[]> {
  const batches = chunkArray([...input.chatIds], CHAT_RESCOPE_BATCH_SIZE)
  const eventIds: string[] = []
  for (const [index, chatIds] of batches.entries()) {
    const eventId = await enqueueOutboxEvent(
      tx,
      CHAT_RESCOPE_EVENT,
      chatRescopePayloadSchema.parse({
        userId: input.userId,
        fromOrganizationId: input.fromOrganizationId,
        toWorkspaceId: input.toWorkspaceId,
        chatIds,
        stoppedRuns: index === 0 ? input.stoppedRuns : [],
      })
    )
    eventIds.push(eventId)
  }
  return eventIds
}
