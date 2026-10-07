import { db } from '@sim/db'
import { subscription } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateShortId } from '@sim/utils/id'
import { toRecord } from '@sim/utils/object'
import { eq, sql } from 'drizzle-orm'
import type Stripe from 'stripe'
import { requireStripeClient } from '@/lib/billing/stripe-client'
import { OUTBOX_EVENT_TYPES } from '@/lib/billing/webhooks/outbox-events'
import {
  enqueueOutboxEvent,
  listInflightOutboxEvents,
  maxSettledOutboxPayloadNumber,
  patchInflightOutboxEvents,
} from '@/lib/core/outbox/service'
import type { DbOrTx } from '@/lib/db/types'

const logger = createLogger('BillingSubscriptionSync')

/**
 * Prefix of the idempotency key on every `cancel_at_period_end` write the sync handler sends.
 * Stripe copies the key onto the resulting event's `request.idempotency_key`, which is how a
 * webhook is recognized as the echo of Sim's own sync rather than a change made in Stripe.
 */
const CANCEL_AT_PERIOD_END_SYNC_KEY_PREFIX = 'outbox-sync-cancel-at-period-end:'
/** The key prefix the cancel-sync handler used before the one above; old pods still send it mid-rollout. */
const LEGACY_SYNC_KEY_PREFIX = 'outbox:'

const CANCEL_SYNC = OUTBOX_EVENT_TYPES.STRIPE_SYNC_CANCEL_AT_PERIOD_END
const SEATS_SYNC = OUTBOX_EVENT_TYPES.STRIPE_SYNC_SUBSCRIPTION_SEATS

export interface CancelAtPeriodEndSyncPayload {
  stripeSubscriptionId: string
  /** The DB subscription row id; the handler pushes this row's current value. */
  subscriptionId: string
  /** The latest committed value. Absent on events enqueued before it was recorded. */
  cancelAtPeriodEnd?: boolean
  /** When `cancelAtPeriodEnd` was committed; see `withCommittedAt`. */
  committedAt?: number
  /** Reason this was enqueued, e.g. 'joined-paid-org'. */
  reason?: string
  /** Correlates Enterprise-issuance follow-up work for Admin progress/retry. */
  sourceOperationId?: string
  operationId?: string
  organizationId?: string
  requestedBy?: { id: string | null; name: string; email: string | null }
}

export interface SubscriptionSeatsSyncPayload {
  /** The DB subscription row id; the handler pushes this row's current plan and seats. */
  subscriptionId: string
  /** The latest committed seat count. Absent on events enqueued before it was recorded. */
  seats?: number
  /** When `seats` was committed; see `withCommittedAt`. */
  committedAt?: number
  reason?: string
}

type SubscriptionSyncEventType = typeof CANCEL_SYNC | typeof SEATS_SYNC
type SyncIntentFields = { cancelAtPeriodEnd: boolean } | { seats: number }

export function isSubscriptionSyncEventType(
  eventType: string
): eventType is SubscriptionSyncEventType {
  return eventType === CANCEL_SYNC || eventType === SEATS_SYNC
}

function subscriptionSubject(subscriptionId: string) {
  return { payloadKey: 'subscriptionId', payloadValue: subscriptionId }
}

/**
 * Stamps `fields` with the database clock in microseconds since the epoch. Read while the
 * caller holds the subscription row lock, so a later stamp is a later committed value. The
 * transaction start time (`created_at`) cannot order them: a transaction that began earlier
 * can take the row lock later.
 */
async function withCommittedAt<T extends SyncIntentFields>(
  tx: DbOrTx,
  fields: T
): Promise<T & { committedAt: number }> {
  const [row] = await tx.execute<{ committedAt: string }>(
    sql`select (extract(epoch from clock_timestamp()) * 1000000)::bigint::text as "committedAt"`
  )
  if (!row) throw new Error('Database clock read returned no row')
  return { ...fields, committedAt: Number(row.committedAt) }
}

/**
 * Records `fields` as the subscription's latest committed value for `eventType` and writes it
 * onto every in-flight event of that type, so no pending, retrying, or reaped event still
 * carries an older value for the webhook reconcile to restore. The caller must hold the
 * subscription row lock (`FOR UPDATE`, or the `UPDATE` itself).
 */
async function commitIntent<T extends SyncIntentFields>(
  tx: DbOrTx,
  eventType: SubscriptionSyncEventType,
  subscriptionId: string,
  fields: T
): Promise<T & { committedAt: number }> {
  const committed = await withCommittedAt(tx, fields)
  await patchInflightOutboxEvents(tx, eventType, subscriptionSubject(subscriptionId), committed)
  return committed
}

/**
 * Enqueue the Stripe sync for a `cancelAtPeriodEnd` value written in this transaction. The
 * caller must hold the subscription row lock. Once every in-flight event for the subscription
 * completes, Stripe holds the last committed value.
 */
export async function enqueueCancelAtPeriodEndSync(
  tx: DbOrTx,
  payload: Omit<CancelAtPeriodEndSyncPayload, 'cancelAtPeriodEnd' | 'committedAt'> & {
    cancelAtPeriodEnd: boolean
  }
): Promise<string> {
  const committed = await commitIntent(tx, CANCEL_SYNC, payload.subscriptionId, {
    cancelAtPeriodEnd: payload.cancelAtPeriodEnd,
  })
  const intent: CancelAtPeriodEndSyncPayload = { ...payload, ...committed }
  return enqueueOutboxEvent(tx, CANCEL_SYNC, intent)
}

/**
 * Enqueue the Stripe sync for a Team subscription's plan and `seats` as written in this
 * transaction. The caller must hold the subscription row lock.
 */
export async function enqueueSubscriptionSeatsSync(
  tx: DbOrTx,
  payload: Omit<SubscriptionSeatsSyncPayload, 'seats' | 'committedAt'> & { seats: number }
): Promise<string> {
  const committed = await commitIntent(tx, SEATS_SYNC, payload.subscriptionId, {
    seats: payload.seats,
  })
  const intent: SubscriptionSeatsSyncPayload = { ...payload, ...committed }
  return enqueueOutboxEvent(tx, SEATS_SYNC, intent)
}

/**
 * Re-commits the subscription's current DB value onto its in-flight sync events, for a
 * dead-lettered event that was just reset to `pending`: the retry then carries the latest value
 * rather than the one it failed with. Takes the subscription row lock itself.
 */
export async function recommitSubscriptionSync(
  tx: DbOrTx,
  eventType: SubscriptionSyncEventType,
  subscriptionId: string
): Promise<void> {
  const [current] = await tx
    .select({ cancelAtPeriodEnd: subscription.cancelAtPeriodEnd, seats: subscription.seats })
    .from(subscription)
    .where(eq(subscription.id, subscriptionId))
    .for('update')
    .limit(1)
  if (!current) return

  await commitIntent(
    tx,
    eventType,
    subscriptionId,
    eventType === CANCEL_SYNC
      ? { cancelAtPeriodEnd: Boolean(current.cancelAtPeriodEnd) }
      : { seats: current.seats ?? 1 }
  )
}

/**
 * Records a customer's restore through Better Auth's `/subscription/restore` as Sim's latest
 * committed `cancelAtPeriodEnd`. That endpoint updates Stripe and then writes the row directly,
 * so a cancel sync still in flight would otherwise carry the cancellation the customer just
 * undid, and a webhook processed before the restore's own could restore it for that sync to
 * push. Enqueuing re-pushes `false` even if such a sync already ran. Called from the endpoint's
 * `after` hook with the Stripe subscription it returned.
 */
export async function commitCustomerRestoredSubscription(restored: unknown): Promise<void> {
  const stripeSubscription = toRecord(restored)
  const stripeSubscriptionId = stripeSubscription.id
  if (
    typeof stripeSubscriptionId !== 'string' ||
    stripeSubscription.cancel_at_period_end !== false
  ) {
    return
  }

  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: subscription.id })
      .from(subscription)
      .where(eq(subscription.stripeSubscriptionId, stripeSubscriptionId))
      .for('update')
      .limit(1)
    if (!row) return

    await tx
      .update(subscription)
      .set({ cancelAtPeriodEnd: false })
      .where(eq(subscription.id, row.id))
    await enqueueCancelAtPeriodEndSync(tx, {
      stripeSubscriptionId,
      subscriptionId: row.id,
      cancelAtPeriodEnd: false,
      reason: 'customer-restored',
    })
  })
}

/** A fresh key per Stripe write: the SDK reuses it across its own network retries of that call. */
export function cancelAtPeriodEndSyncIdempotencyKey(eventId: string): string {
  return `${CANCEL_AT_PERIOD_END_SYNC_KEY_PREFIX}${eventId}:${generateShortId()}`
}

/**
 * What a sync type's in-flight events say about its field: no applicable value, the latest
 * committed value, or `legacy` when an event predates recorded values (enqueued by an older
 * deploy) so the committed value is unknown. An in-flight value older than one a settled event
 * already carried was revived by a retry path that did not re-commit, and does not apply.
 */
type InflightIntent<T> = { status: 'none' } | { status: 'legacy' } | { status: 'value'; value: T }

function latestIntent<T>(
  events: { eventType: string; payload: unknown }[],
  settledCommittedAt: Map<string, number>,
  eventType: SubscriptionSyncEventType,
  readValue: (payload: Record<string, unknown>) => T | undefined
): InflightIntent<T> {
  let latest: { committedAt: number; value: T } | undefined
  for (const event of events) {
    if (event.eventType !== eventType) continue
    const payload = toRecord(event.payload)
    const value = readValue(payload)
    if (typeof payload.committedAt !== 'number' || value === undefined) return { status: 'legacy' }
    if (!latest || payload.committedAt > latest.committedAt) {
      latest = { committedAt: payload.committedAt, value }
    }
  }
  if (!latest || latest.committedAt < (settledCommittedAt.get(eventType) ?? 0)) {
    return { status: 'none' }
  }
  return { status: 'value', value: latest.value }
}

async function readInflightIntents(executor: DbOrTx, subscriptionId: string) {
  const eventTypes = [CANCEL_SYNC, SEATS_SYNC]
  const subject = subscriptionSubject(subscriptionId)
  const events = await listInflightOutboxEvents(executor, eventTypes, subject)
  const settledCommittedAt = await maxSettledOutboxPayloadNumber(
    executor,
    eventTypes,
    subject,
    'committedAt'
  )
  return {
    cancelAtPeriodEnd: latestIntent(events, settledCommittedAt, CANCEL_SYNC, (payload) =>
      typeof payload.cancelAtPeriodEnd === 'boolean' ? payload.cancelAtPeriodEnd : undefined
    ),
    seats: latestIntent(events, settledCommittedAt, SEATS_SYNC, (payload) =>
      typeof payload.seats === 'number' ? payload.seats : undefined
    ),
  }
}

/** True when the event records a `cancel_at_period_end` change made in Stripe, not by Sim's sync. */
function isCancellationChangedInStripe(event: Stripe.Event): boolean {
  const previousAttributes = toRecord(event.data.previous_attributes)
  if (!('cancel_at_period_end' in previousAttributes)) return false
  const idempotencyKey = event.request?.idempotency_key
  const issuedBySimSync =
    idempotencyKey?.startsWith(CANCEL_AT_PERIOD_END_SYNC_KEY_PREFIX) ||
    idempotencyKey?.startsWith(LEGACY_SYNC_KEY_PREFIX)
  return !issuedBySimSync
}

type CancelAtPeriodEndSource =
  | { source: 'unchanged' }
  | { source: 'pending-sync'; value: boolean }
  | { source: 'stripe' }

function cancelAtPeriodEndSource(
  intent: InflightIntent<boolean>,
  changedInStripe: boolean
): CancelAtPeriodEndSource {
  if (intent.status === 'legacy') return { source: 'unchanged' }
  if (intent.status === 'value' && !changedInStripe) {
    return { source: 'pending-sync', value: intent.value }
  }
  return { source: 'stripe' }
}

/**
 * Reconciles the Sim-owned subscription fields after the Better Auth Stripe plugin has copied a
 * `customer.subscription.updated` payload into the row. The plugin writes `cancelAtPeriodEnd`
 * and `seats` unconditionally, so a delayed, out-of-order, or unrelated event would otherwise
 * overwrite a value Sim committed but has not yet pushed, and the pending sync would then push
 * the overwritten value back to Stripe.
 *
 * Decided under the subscription row lock that every committing writer holds:
 * - `cancelAtPeriodEnd`: while a cancel sync is in flight, its committed value wins over
 *   snapshots and over echoes of Sim's own writes. A change made in Stripe itself (customer
 *   portal, dashboard, Better Auth's cancel/restore endpoints) is newer and wins, and is
 *   committed onto the in-flight events so none can later restore the value it replaced. With
 *   no sync in flight Stripe wins, read live so out-of-order delivery cannot regress it.
 * - `seats`: Team seats are Sim-owned; while a seat sync is in flight its committed value wins.
 * - A field with an in-flight event from an older deploy is left as the plugin wrote it.
 *
 * Stripe is read only when its value decides, and never under the lock. Only the DB row and
 * in-flight payloads are written, so this cannot trigger another webhook.
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

  const changedInStripe = isCancellationChangedInStripe(event)
  let liveCancelAtPeriodEnd: boolean | undefined

  for (let pass = 1; pass <= 2; pass++) {
    if (liveCancelAtPeriodEnd === undefined) {
      const needsStripe =
        pass > 1 ||
        cancelAtPeriodEndSource(
          (await readInflightIntents(db, row.id)).cancelAtPeriodEnd,
          changedInStripe
        ).source === 'stripe'
      if (needsStripe) {
        const live = await requireStripeClient().subscriptions.retrieve(stripeSubscriptionId)
        liveCancelAtPeriodEnd = Boolean(live.cancel_at_period_end)
      }
    }

    const reconciled = await db.transaction(async (tx) => {
      const [current] = await tx
        .select({ cancelAtPeriodEnd: subscription.cancelAtPeriodEnd, seats: subscription.seats })
        .from(subscription)
        .where(eq(subscription.id, row.id))
        .for('update')
        .limit(1)
      if (!current) return true

      const intents = await readInflightIntents(tx, row.id)
      const cancel = cancelAtPeriodEndSource(intents.cancelAtPeriodEnd, changedInStripe)
      let cancelAtPeriodEnd = Boolean(current.cancelAtPeriodEnd)
      if (cancel.source === 'pending-sync') {
        cancelAtPeriodEnd = cancel.value
      } else if (cancel.source === 'stripe') {
        if (liveCancelAtPeriodEnd === undefined) return false
        cancelAtPeriodEnd = liveCancelAtPeriodEnd
        if (intents.cancelAtPeriodEnd.status === 'value') {
          await commitIntent(tx, CANCEL_SYNC, row.id, { cancelAtPeriodEnd })
        }
      }
      const seats = intents.seats.status === 'value' ? intents.seats.value : current.seats

      if (Boolean(current.cancelAtPeriodEnd) === cancelAtPeriodEnd && current.seats === seats) {
        return true
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
          source: cancel.source,
        },
        seats: { stored: current.seats, reconciled: seats },
      })
      return true
    })
    if (reconciled) return
  }
}
