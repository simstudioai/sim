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
  patchRetryableOutboxEvents,
  readOutboxEventPayload,
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
  return { ...fields, committedAt: await readDatabaseClock(tx) }
}

/** The clock `committedAt` is stamped from, in microseconds since the epoch. */
async function readDatabaseClock(executor: DbOrTx): Promise<number> {
  const [row] = await executor.execute<{ now: string }>(
    sql`select (extract(epoch from clock_timestamp()) * 1000000)::bigint::text as "now"`
  )
  if (!row) throw new Error('Database clock read returned no row')
  return Number(row.now)
}

/**
 * Records `fields` as the subscription's latest committed value for `eventType` and writes it
 * onto every event of that type that can still run: pending, processing, or dead-lettered (each
 * operator retry path resets dead letters to pending). No event that can run again ever carries
 * an older value for the webhook reconcile to restore. The caller must hold the subscription row
 * lock (`FOR UPDATE`, or the `UPDATE` itself), per the lock order on
 * {@link lockSubscriptionForSyncRetry}.
 *
 * A Sim commit is stamped with the clock under that lock and rewrites every such event. A value
 * taken from Stripe passes `observedAt`, the clock read just before Stripe was read, so it orders
 * by when it was observed: it rewrites (value and stamp) only the events last stamped before that
 * observation, including ones already holding the value, so a slower reconcile of an earlier
 * Stripe read cannot outrank a later one and never overwrites a newer commit.
 */
async function commitIntent<T extends SyncIntentFields>(
  tx: DbOrTx,
  eventType: SubscriptionSyncEventType,
  subscriptionId: string,
  fields: T,
  observedAt?: number
): Promise<T & { committedAt: number }> {
  const committed =
    observedAt === undefined
      ? await withCommittedAt(tx, fields)
      : { ...fields, committedAt: observedAt }
  await patchRetryableOutboxEvents(
    tx,
    eventType,
    subscriptionSubject(subscriptionId),
    committed,
    observedAt === undefined ? undefined : 'committedAt'
  )
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
 * Records a `cancelAtPeriodEnd` value written in this transaction without enqueuing a sync, for a
 * writer whose value an existing sync will push or Stripe already holds. It is written onto every
 * sync that can still run (including one just reset to pending), so none keeps an older value.
 * The caller must hold the subscription row lock.
 */
export async function recordCancelAtPeriodEnd(
  tx: DbOrTx,
  subscriptionId: string,
  cancelAtPeriodEnd: boolean
): Promise<void> {
  await commitIntent(tx, CANCEL_SYNC, subscriptionId, { cancelAtPeriodEnd })
}

/**
 * Takes the subscription row lock for an operator retry of one of its sync events; call it
 * before touching the event, then {@link recommitSubscriptionSync} after resetting it.
 *
 * Lock order for every writer of a subscription's synced fields and their outbox events:
 * organization mutation lock (where taken) → subscription row → outbox rows. Committing a value
 * rewrites the subscription's retryable sync events, dead letters included, so a retry that
 * locked a dead-lettered event before the subscription would deadlock against any concurrent
 * writer.
 */
export async function lockSubscriptionForSyncRetry(
  tx: DbOrTx,
  subscriptionId: string
): Promise<void> {
  await tx
    .select({ id: subscription.id })
    .from(subscription)
    .where(eq(subscription.id, subscriptionId))
    .for('update')
    .limit(1)
}

/**
 * Re-commits the latest committed value onto the subscription's sync events that can still run,
 * for a dead-lettered event that was just reset to `pending`: the retry then carries the latest
 * value rather than the one it failed with. That is the newest in-flight value; the row is only a
 * fallback when nothing in flight records one, because until the reconcile step runs the row can
 * hold the Stripe plugin's stale webhook payload. The caller holds the lock from
 * {@link lockSubscriptionForSyncRetry}, taken before the reset.
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
    .limit(1)
  if (!current) return

  const pending = await readSyncIntents(tx, subscriptionId)
  if (eventType === CANCEL_SYNC) {
    const intent = pending.cancelAtPeriodEnd
    await commitIntent(tx, eventType, subscriptionId, {
      cancelAtPeriodEnd:
        intent.status === 'value' ? intent.value : Boolean(current.cancelAtPeriodEnd),
    })
    return
  }
  const intent = pending.seats
  await commitIntent(tx, eventType, subscriptionId, {
    seats: intent.status === 'value' ? intent.value : (current.seats ?? 1),
  })
}

/**
 * Records a customer's restore through Better Auth's `/subscription/restore` as Sim's latest
 * committed `cancelAtPeriodEnd`. That endpoint updates Stripe and then writes the row directly,
 * so a cancel sync still in flight would otherwise carry the cancellation the customer just
 * undid, and a webhook processed before the restore's own could restore it for that sync to
 * push. Enqueuing re-pushes `false` even if such a sync already ran.
 */
async function commitCustomerRestoredSubscription(restored: unknown): Promise<void> {
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

/**
 * The Better Auth `after` hook step for `/subscription/restore`: records the restored value from
 * the Stripe subscription the endpoint returned. A failure is logged rather than failing a
 * restore that already reached Stripe and the row; the reconcile step then still treats the
 * restore's own webhook as a change made in Stripe.
 */
export async function recordCustomerRestoreAfterHook(ctx: {
  path: string
  context: { returned?: unknown }
}): Promise<void> {
  if (ctx.path !== '/subscription/restore') return
  try {
    await commitCustomerRestoredSubscription(ctx.context.returned)
  } catch (error) {
    logger.error('Failed to record a restored subscription as the committed value', { error })
  }
}

/**
 * The value recorded on a sync event as of now, not as of its claim: every commit rewrites it on
 * each sync that can still run. Undefined for an event enqueued before values were recorded.
 */
export async function readRecordedSyncValue(
  eventId: string
): Promise<{ cancelAtPeriodEnd?: boolean; seats?: number } | undefined> {
  const payload = toRecord(await readOutboxEventPayload(eventId))
  if (typeof payload.committedAt !== 'number') return undefined
  return {
    ...(typeof payload.cancelAtPeriodEnd === 'boolean'
      ? { cancelAtPeriodEnd: payload.cancelAtPeriodEnd }
      : {}),
    ...(typeof payload.seats === 'number' ? { seats: payload.seats } : {}),
  }
}

/** A fresh key per Stripe write: the SDK reuses it across its own network retries of that call. */
export function cancelAtPeriodEndSyncIdempotencyKey(eventId: string): string {
  return `${CANCEL_AT_PERIOD_END_SYNC_KEY_PREFIX}${eventId}:${generateShortId()}`
}

/**
 * What a sync type's in-flight events say about its field: nothing in flight, the latest
 * committed value, or `legacy` when an event predates recorded values (enqueued by an older
 * deploy) so the committed value is unknown.
 */
type InflightIntent<T> =
  | { status: 'none' }
  | { status: 'legacy' }
  | { status: 'value'; value: T; committedAt: number }

function latestIntent<T>(
  events: { eventType: string; payload: unknown }[],
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
  return latest ? { status: 'value', ...latest } : { status: 'none' }
}

/**
 * One indexed read of the subscription's in-flight syncs. Dead letters are not intents: they are
 * failed syncs awaiting an operator, kept current by every commit so a retry pushes the latest
 * value, but never a reason to override Stripe.
 */
async function readSyncIntents(executor: DbOrTx, subscriptionId: string) {
  const events = await listInflightOutboxEvents(
    executor,
    [CANCEL_SYNC, SEATS_SYNC],
    subscriptionSubject(subscriptionId)
  )
  return {
    cancelAtPeriodEnd: latestIntent(events, CANCEL_SYNC, (payload) =>
      typeof payload.cancelAtPeriodEnd === 'boolean' ? payload.cancelAtPeriodEnd : undefined
    ),
    seats: latestIntent(events, SEATS_SYNC, (payload) =>
      typeof payload.seats === 'number' ? payload.seats : undefined
    ),
  }
}

/**
 * True when the event records a cancellation change made in Stripe, not by Sim's sync. A
 * `cancel_at` that was set or cleared counts too: Better Auth's restore clears `cancel_at` when it
 * is set, and Stripe may then list only `cancel_at` among the previous attributes. A `cancel_at`
 * that only moved (e.g. a billing-interval switch on a subscription already ending) is not a
 * cancellation change.
 */
function isCancellationChangedInStripe(event: Stripe.Event): boolean {
  const previousAttributes = toRecord(event.data.previous_attributes)
  const scheduledOrCleared =
    'cancel_at' in previousAttributes &&
    (previousAttributes.cancel_at == null) !== (toRecord(event.data.object).cancel_at == null)
  if (!('cancel_at_period_end' in previousAttributes) && !scheduledOrCleared) return false
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

/**
 * A Stripe-side change wins over a pending value unless the pending value was committed after
 * Stripe was read (`liveReadAt`, on the same database clock): that read predates Sim's newer
 * commit, so applying it would roll the newer value back.
 */
function cancelAtPeriodEndSource(
  intent: InflightIntent<boolean>,
  changedInStripe: boolean,
  liveReadAt?: number
): CancelAtPeriodEndSource {
  if (intent.status === 'legacy') return { source: 'unchanged' }
  if (
    intent.status === 'value' &&
    (!changedInStripe || (liveReadAt !== undefined && intent.committedAt > liveReadAt))
  ) {
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
 *   portal, dashboard, Better Auth's cancel/restore endpoints), recognised by a non-Sim request
 *   changing `cancel_at_period_end` or setting or clearing `cancel_at`, wins and is committed
 *   onto every sync that can still run, unless Sim committed a newer value after Stripe was
 *   read. With no sync in flight Stripe wins, read live so out-of-order delivery cannot regress
 *   it.
 * - Precedence across the two systems is arrival order, not wall-clock order: a Stripe-side
 *   change whose webhook is processed after a Sim commit wins even if the customer made it
 *   earlier. Stripe's `event.created` is not compared with the database clock, because skew
 *   between them could override a genuinely newer customer action.
 * - `seats`: Team seats are Sim-owned; while a seat sync is in flight its committed value wins.
 * - A field with an in-flight event from an older deploy is left as the plugin wrote it.
 *
 * Stripe is read only when its value decides, and never under the lock. Only the DB row and
 * sync payloads are written, so this cannot trigger another webhook.
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
  let liveReadAt: number | undefined

  for (let pass = 1; pass <= 2; pass++) {
    if (liveCancelAtPeriodEnd === undefined) {
      const needsStripe =
        pass > 1 ||
        cancelAtPeriodEndSource(
          (await readSyncIntents(db, row.id)).cancelAtPeriodEnd,
          changedInStripe
        ).source === 'stripe'
      if (needsStripe) {
        liveReadAt = await readDatabaseClock(db)
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

      const intents = await readSyncIntents(tx, row.id)
      const cancel = cancelAtPeriodEndSource(intents.cancelAtPeriodEnd, changedInStripe, liveReadAt)
      let cancelAtPeriodEnd = Boolean(current.cancelAtPeriodEnd)
      if (cancel.source === 'pending-sync') {
        cancelAtPeriodEnd = cancel.value
      } else if (cancel.source === 'stripe') {
        if (liveCancelAtPeriodEnd === undefined) return false
        cancelAtPeriodEnd = liveCancelAtPeriodEnd
        await commitIntent(tx, CANCEL_SYNC, row.id, { cancelAtPeriodEnd }, liveReadAt)
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
