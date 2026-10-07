import { db } from '@sim/db'
import { outboxEvent, subscription } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateShortId } from '@sim/utils/id'
import { toRecord } from '@sim/utils/object'
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import type Stripe from 'stripe'
import { requireStripeClient } from '@/lib/billing/stripe-client'
import { OUTBOX_EVENT_TYPES } from '@/lib/billing/webhooks/outbox-events'
import { enqueueOutboxEvent, patchOutboxEventPayload } from '@/lib/core/outbox/service'
import type { DbOrTx } from '@/lib/db/types'

const logger = createLogger('BillingSubscriptionSync')

/**
 * Prefix of the idempotency key on every `cancel_at_period_end` write the sync handler sends.
 * Stripe copies the key onto the resulting event's `request.idempotency_key`, which is how a
 * webhook is recognized as the echo of Sim's own sync rather than a change made in Stripe.
 */
const CANCEL_AT_PERIOD_END_SYNC_KEY_PREFIX = 'outbox-sync-cancel-at-period-end:'

/**
 * The value Sim committed for a synced field, recorded on the sync event. `requestedAt` is the
 * database clock read while the enqueuing transaction held the subscription row lock, so among
 * a subscription's in-flight events the latest `requestedAt` is the latest committed value.
 * Transaction start time (`created_at`) cannot order them: a transaction that began earlier
 * can take the row lock later.
 */
interface SyncIntent {
  requestedAt: string
}

export interface CancelAtPeriodEndSyncPayload extends Partial<SyncIntent> {
  stripeSubscriptionId: string
  /** The DB subscription row id; the handler pushes this row's current value. */
  subscriptionId: string
  /** The value committed with this event. Absent on events enqueued before it was recorded. */
  cancelAtPeriodEnd?: boolean
  /** Reason this was enqueued, e.g. 'joined-paid-org'. */
  reason?: string
  /** Correlates Enterprise-issuance follow-up work for Admin progress/retry. */
  sourceOperationId?: string
  operationId?: string
  organizationId?: string
  requestedBy?: { id: string | null; name: string; email: string | null }
}

export interface SubscriptionSeatsSyncPayload extends Partial<SyncIntent> {
  /** The DB subscription row id; the handler pushes this row's current plan and seats. */
  subscriptionId: string
  /** The seat count committed with this event. Absent on events enqueued before it was recorded. */
  seats?: number
  reason?: string
}

async function readDatabaseClock(executor: DbOrTx): Promise<string> {
  const [row] = await executor.execute<{ requestedAt: string }>(
    sql`select to_json(clock_timestamp()) #>> '{}' as "requestedAt"`
  )
  if (!row) throw new Error('Database clock read returned no row')
  return row.requestedAt
}

/**
 * Enqueue the Stripe sync for a `cancelAtPeriodEnd` value written in this transaction. The
 * caller must hold the subscription row lock (`FOR UPDATE`, or the `UPDATE` itself).
 */
export async function enqueueCancelAtPeriodEndSync(
  tx: DbOrTx,
  payload: Omit<CancelAtPeriodEndSyncPayload, 'cancelAtPeriodEnd' | 'requestedAt'> & {
    cancelAtPeriodEnd: boolean
  }
): Promise<string> {
  const intent: CancelAtPeriodEndSyncPayload = {
    ...payload,
    requestedAt: await readDatabaseClock(tx),
  }
  return enqueueOutboxEvent(tx, OUTBOX_EVENT_TYPES.STRIPE_SYNC_CANCEL_AT_PERIOD_END, intent)
}

/**
 * Re-records the committed value on an existing cancel-sync event that is being retried, so it
 * orders after every event enqueued since. The caller must hold the subscription row lock.
 */
export async function recommitCancelAtPeriodEndSync(
  tx: DbOrTx,
  eventId: string,
  cancelAtPeriodEnd: boolean
): Promise<void> {
  const patch: Pick<CancelAtPeriodEndSyncPayload, 'cancelAtPeriodEnd' | 'requestedAt'> = {
    cancelAtPeriodEnd,
    requestedAt: await readDatabaseClock(tx),
  }
  await patchOutboxEventPayload(tx, eventId, patch)
}

/**
 * Enqueue the Stripe sync for a Team subscription's plan and `seats` as written in this
 * transaction. The caller must hold the subscription row lock.
 */
export async function enqueueSubscriptionSeatsSync(
  tx: DbOrTx,
  payload: Omit<SubscriptionSeatsSyncPayload, 'seats' | 'requestedAt'> & { seats: number }
): Promise<string> {
  const intent: SubscriptionSeatsSyncPayload = {
    ...payload,
    requestedAt: await readDatabaseClock(tx),
  }
  return enqueueOutboxEvent(tx, OUTBOX_EVENT_TYPES.STRIPE_SYNC_SUBSCRIPTION_SEATS, intent)
}

/** A fresh key per Stripe write: the SDK reuses it across its own network retries of that call. */
export function cancelAtPeriodEndSyncIdempotencyKey(eventId: string): string {
  return `${CANCEL_AT_PERIOD_END_SYNC_KEY_PREFIX}${eventId}:${generateShortId()}`
}

/** The value of the most recently committed in-flight sync event, or undefined. */
async function readInflightIntent(
  tx: DbOrTx,
  eventType: string,
  subscriptionId: string
): Promise<Record<string, unknown> | undefined> {
  const [latest] = await tx
    .select({ payload: outboxEvent.payload })
    .from(outboxEvent)
    .where(
      and(
        eq(outboxEvent.eventType, eventType),
        inArray(outboxEvent.status, ['pending', 'processing']),
        sql`${outboxEvent.payload} ->> 'subscriptionId' = ${subscriptionId}`,
        isNotNull(sql`${outboxEvent.payload} ->> 'requestedAt'`)
      )
    )
    .orderBy(sql`(${outboxEvent.payload} ->> 'requestedAt')::timestamptz desc`)
    .limit(1)
  return latest ? toRecord(latest.payload) : undefined
}

/** True when the event records a `cancel_at_period_end` change made in Stripe, not by Sim's sync. */
function isCancellationChangedInStripe(event: Stripe.Event): boolean {
  const previousAttributes = toRecord(event.data.previous_attributes)
  if (!('cancel_at_period_end' in previousAttributes)) return false
  const idempotencyKey = event.request?.idempotency_key
  return !idempotencyKey?.startsWith(CANCEL_AT_PERIOD_END_SYNC_KEY_PREFIX)
}

/**
 * Reconciles the Sim-owned subscription fields after the Better Auth Stripe plugin has copied a
 * `customer.subscription.updated` payload into the row. The plugin writes `cancelAtPeriodEnd`
 * and `seats` unconditionally, so a delayed, out-of-order, or unrelated event would otherwise
 * overwrite a value Sim committed but has not yet pushed, and the pending sync would then push
 * the overwritten value back to Stripe.
 *
 * Under the subscription row lock (the lock every enqueuing writer holds):
 * - `cancelAtPeriodEnd`: while a cancel sync is in flight, Sim's latest committed value wins over
 *   snapshots and over echoes of Sim's own earlier writes. A change made in Stripe itself (customer
 *   portal, dashboard, Better Auth's cancel/restore endpoints) is newer than anything pending and
 *   wins, as does Stripe whenever no sync is in flight. Stripe's value is read live, never taken
 *   from the event, so out-of-order delivery cannot regress it.
 * - `seats`: Team seats follow the member count Sim maintains; while a seat sync is in flight its
 *   latest committed value wins. With none in flight the plugin's write stands, as before.
 *
 * Only the DB row is written: nothing is enqueued and nothing is sent to Stripe, so this cannot
 * trigger another webhook. The in-flight sync pushes the restored value.
 */
export async function reconcileSubscriptionSyncFromStripe(event: Stripe.Event): Promise<void> {
  if (event.type !== 'customer.subscription.updated') return
  const stripeSubscriptionId = event.data.object.id

  const [row] = await db
    .select({ id: subscription.id })
    .from(subscription)
    .where(eq(subscription.stripeSubscriptionId, stripeSubscriptionId))
    .limit(1)
  if (!row) return

  const liveSubscription = await requireStripeClient().subscriptions.retrieve(stripeSubscriptionId)
  const changedInStripe = isCancellationChangedInStripe(event)

  await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ cancelAtPeriodEnd: subscription.cancelAtPeriodEnd, seats: subscription.seats })
      .from(subscription)
      .where(eq(subscription.id, row.id))
      .for('update')
      .limit(1)
    if (!current) return

    const cancelIntent = changedInStripe
      ? undefined
      : (await readInflightIntent(tx, OUTBOX_EVENT_TYPES.STRIPE_SYNC_CANCEL_AT_PERIOD_END, row.id))
          ?.cancelAtPeriodEnd
    const seatsIntent = (
      await readInflightIntent(tx, OUTBOX_EVENT_TYPES.STRIPE_SYNC_SUBSCRIPTION_SEATS, row.id)
    )?.seats

    const cancelAtPeriodEnd =
      typeof cancelIntent === 'boolean'
        ? cancelIntent
        : Boolean(liveSubscription.cancel_at_period_end)
    const seats = typeof seatsIntent === 'number' ? seatsIntent : current.seats

    if (Boolean(current.cancelAtPeriodEnd) === cancelAtPeriodEnd && current.seats === seats) {
      return
    }

    await tx
      .update(subscription)
      .set({ cancelAtPeriodEnd, seats })
      .where(eq(subscription.id, row.id))

    logger.info('Reconciled Sim-owned subscription fields after a Stripe webhook', {
      eventId: event.id,
      subscriptionId: row.id,
      stripeSubscriptionId,
      cancelAtPeriodEnd: {
        stored: current.cancelAtPeriodEnd,
        reconciled: cancelAtPeriodEnd,
        source: typeof cancelIntent === 'boolean' ? 'pending-sync' : 'stripe',
      },
      seats: { stored: current.seats, reconciled: seats },
    })
  })
}
