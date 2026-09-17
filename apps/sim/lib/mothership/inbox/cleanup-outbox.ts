import { db } from '@sim/db'
import { mothershipInboxWebhook, outboxEvent, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  deferOutboxHandler,
  enqueueOutboxEvent,
  type OutboxEventContext,
  type OutboxHandler,
  type OutboxHandlerRegistry,
  processOutboxEventById,
} from '@/lib/core/outbox/service'
import * as agentmail from '@/lib/mothership/inbox/agentmail-client'

const logger = createLogger('InboxCleanup')
const INBOX_CLEANUP_EVENT = 'inbox.resources.cleanup'
const MAX_DELETION_POLLS = 120
const DELETION_POLL_INTERVAL_MS = 30_000

const cleanupPayloadSchema = z
  .object({
    inboxId: z.string().min(1).max(320).nullable(),
    inboxCreatedAt: z.string().datetime({ offset: true }).nullable(),
    webhookId: z.string().min(1).max(256).nullable(),
    inboxDeleteAccepted: z.boolean().optional(),
    cleanupStarted: z.boolean().optional(),
    deletionPollsRemaining: z.number().int().min(0).max(MAX_DELETION_POLLS).optional(),
  })
  .refine((payload) => !payload.inboxId || payload.inboxCreatedAt !== null)

export type InboxCleanupPayload = z.infer<typeof cleanupPayloadSchema>

/** Expected provider waits have a separate finite allowance from failures such as network errors. */
async function waitForDeletion(
  payload: InboxCleanupPayload,
  context: OutboxEventContext,
  reason: string
) {
  const remaining = payload.deletionPollsRemaining ?? MAX_DELETION_POLLS
  if (remaining === 0) {
    return deferOutboxHandler(`${reason}: polling allowance exhausted`, DELETION_POLL_INTERVAL_MS)
  }
  await context.checkpointPayload({ deletionPollsRemaining: remaining - 1 })
  return deferOutboxHandler(reason, DELETION_POLL_INTERVAL_MS, false)
}

const cleanupInboxResources: OutboxHandler = async (rawPayload, context) => {
  const payload = cleanupPayloadSchema.parse(rawPayload)
  context.signal.throwIfAborted()
  /** Retries and recovered leases become pending again, but must never be activated afterward. */
  if (!payload.cleanupStarted) await context.checkpointPayload({ cleanupStarted: true })

  if (payload.webhookId) {
    const [active] = await db
      .select({ id: mothershipInboxWebhook.id })
      .from(mothershipInboxWebhook)
      .where(eq(mothershipInboxWebhook.webhookId, payload.webhookId))
      .limit(1)
    if (active) throw new Error('Inbox webhook is still in use')
    if (!(await agentmail.deleteWebhook(payload.webhookId, context.signal))) {
      return waitForDeletion(payload, context, 'Waiting for webhook deletion')
    }
  }

  if (!payload.inboxId) return
  context.signal.throwIfAborted()
  const [active] = await db
    .select({ id: workspace.id })
    .from(workspace)
    .where(eq(workspace.inboxProviderId, payload.inboxId))
    .limit(1)
  if (active) throw new Error('Inbox is still in use')

  const inbox = await agentmail.getInbox(payload.inboxId, context.signal)
  /** Email addresses can be reused; a retry must never delete a replacement inbox. */
  if (!inbox || inbox.created_at !== payload.inboxCreatedAt) return
  if (!payload.inboxDeleteAccepted) {
    context.signal.throwIfAborted()
    if (await agentmail.deleteInbox(payload.inboxId, context.signal)) return
    await context.checkpointPayload({ inboxDeleteAccepted: true })
  }
  return waitForDeletion(payload, context, 'Waiting for inbox deletion')
}

export const inboxCleanupOutboxHandlers = {
  [INBOX_CLEANUP_EVENT]: cleanupInboxResources,
} satisfies OutboxHandlerRegistry

/** Retains resource identities in the same transaction that removes their active configuration. */
export function enqueueInboxCleanup(
  executor: Pick<typeof db, 'insert'>,
  payload: InboxCleanupPayload,
  availableAt?: Date
): Promise<string> {
  return enqueueOutboxEvent(executor, INBOX_CLEANUP_EVENT, cleanupPayloadSchema.parse(payload), {
    availableAt,
  })
}

/** Attempts committed cleanup immediately, leaving failures to the durable retry worker. */
export async function processInboxCleanupNow(eventId: string): Promise<void> {
  try {
    await processOutboxEventById(eventId, inboxCleanupOutboxHandlers)
  } catch (error) {
    logger.warn('Inbox cleanup remains queued', { eventId, error })
  }
}

/** Cancels unclaimed rollback only inside the transaction that activates its resources. */
export async function cancelInboxCleanup(
  executor: Pick<typeof db, 'delete'>,
  eventId: string
): Promise<void> {
  const [canceled] = await executor
    .delete(outboxEvent)
    .where(
      and(
        eq(outboxEvent.id, eventId),
        eq(outboxEvent.eventType, INBOX_CLEANUP_EVENT),
        eq(outboxEvent.status, 'pending'),
        sql`${outboxEvent.payload}->>'cleanupStarted' IS DISTINCT FROM 'true'`
      )
    )
    .returning({ id: outboxEvent.id })
  if (!canceled) throw new Error('Inbox setup expired. Please try again.')
}
