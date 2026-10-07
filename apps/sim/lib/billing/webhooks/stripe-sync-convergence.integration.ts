/**
 * DB → Stripe sync convergence against real PostgreSQL, the real outbox worker path, and the
 * real Better Auth Stripe webhook endpoint (plugin write first, then Sim's callbacks), with an
 * in-memory Stripe that applies requests in the order the test releases them.
 */

import { stripe as stripePlugin } from '@better-auth/stripe'
import * as schema from '@sim/db/schema'
import { member, organization, outboxEvent, subscription, user } from '@sim/db/schema'
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { withUtcTimestamps } from '@sim/db/timestamps'
import { envFlagsMock, resetEnvFlagsMock, setEnvFlags } from '@sim/testing/mocks/env-flags.mock'
import {
  createInMemoryStripe,
  type InMemoryStripe,
  stripeClientMock,
} from '@sim/testing/mocks/stripe.mock'
import { generateId } from '@sim/utils/id'
import { type BetterAuthOptions, betterAuth } from 'better-auth'
import { createAuthMiddleware } from 'better-auth/api'
import { and, desc, eq, sql } from 'drizzle-orm'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { NextRequest } from 'next/server'
import postgres from 'postgres'
import type Stripe from 'stripe'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const ADMIN_API_KEY = vi.hoisted(() => {
  const key = 'integration-fixture-admin-key'
  process.env.ADMIN_API_KEY = key
  process.env.STRIPE_PRICE_TEAM_25_MO = 'price_team_pro_tier_month'
  process.env.STRIPE_PRICE_TEAM_100_MO = 'price_team_max_tier_month'
  return key
})

const database = vi.hoisted(() => ({
  current: undefined as PostgresJsDatabase<typeof schema> | undefined,
}))

vi.mock('@sim/db', () => ({
  get db() {
    if (!database.current) throw new Error('Stripe sync test database is not initialized')
    return database.current
  },
}))
vi.mock('@/lib/billing/stripe-client', () => stripeClientMock)
vi.mock('@/lib/core/config/env-flags', () => envFlagsMock)

import { requestDashboardSubscriptionCancellation } from '@/lib/admin/subscription-lifecycle'
import { createSimAuthAdapter } from '@/lib/auth/sim-auth-adapter'
import { CREDIT_TIERS } from '@/lib/billing/constants'
import {
  pauseProSubscriptionForOrgCoverage,
  restoreUserProSubscription,
} from '@/lib/billing/organizations/membership'
import { ensureTeamOrganizationForAcceptance } from '@/lib/billing/organizations/provision-seat'
import { reconcileOrganizationSeats } from '@/lib/billing/organizations/seats'
import { isTeam } from '@/lib/billing/plan-helpers'
import { syncSeatsFromStripeQuantity } from '@/lib/billing/validation/seat-management'
import { OUTBOX_EVENT_TYPES } from '@/lib/billing/webhooks/outbox-events'
import { billingOutboxHandlers } from '@/lib/billing/webhooks/outbox-handlers'
import {
  enqueueCancelAtPeriodEndSync,
  enqueueSubscriptionSeatsSync,
  reconcileSubscriptionSyncFromStripe,
  recordCustomerRestoreAfterHook,
} from '@/lib/billing/webhooks/subscription-sync'
import { enqueueOutboxEvent, processOutboxEventById } from '@/lib/core/outbox/service'
import { POST as requeueOutboxEvent } from '@/app/api/v1/admin/outbox/[id]/requeue/route'

const schemaName = `stripe_sync_${generateId().replaceAll('-', '')}`
const connection = postgres(
  readTestDatabaseUrl(),
  withUtcTimestamps({
    max: 6,
    prepare: false,
    fetch_types: false,
    connection: { search_path: schemaName },
    onnotice: () => {},
  })
)
const testDatabase = drizzle(connection, { schema })

let stripe: InMemoryStripe

/** Runs between the plugin's write and Sim's reconcile step, to place work in that window. */
let beforeReconcile: (() => Promise<void>) | undefined

/**
 * Sim's Better Auth Stripe wiring from `lib/auth/auth.ts`, reduced to the parts that touch the
 * synced fields: the seat sync in `onSubscriptionUpdate`, the reconcile step in `onEvent`, and
 * the restore step in the `after` hook.
 */
function createTestAuth() {
  return betterAuth({
    baseURL: 'http://localhost:3000',
    secret: 'isolated-integration-fixture-secret-not-a-real-credential',
    database: (options: BetterAuthOptions) => createSimAuthAdapter(options, testDatabase),
    emailAndPassword: { enabled: true },
    hooks: { after: createAuthMiddleware(recordCustomerRestoreAfterHook) },
    plugins: [
      stripePlugin({
        stripeClient: stripe.client,
        stripeWebhookSecret: 'whsec_fixture',
        subscription: {
          enabled: true,
          plans: [],
          onSubscriptionUpdate: async ({ event, subscription: updated }) => {
            const stripeSubscription = event.data.object as Stripe.Subscription
            if (!isTeam(updated.plan)) return
            await syncSeatsFromStripeQuantity(
              updated.id,
              updated.seats ?? null,
              stripeSubscription.items?.data?.[0]?.quantity || 1
            )
          },
        },
        onEvent: async (event) => {
          await beforeReconcile?.()
          await reconcileSubscriptionSyncFromStripe(event)
        },
      }),
    ],
  })
}

let auth: ReturnType<typeof createTestAuth>

async function deliver(event: Stripe.Event) {
  const response = await auth.handler(
    new Request('http://localhost:3000/api/auth/stripe/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=fixture' },
      body: JSON.stringify(event),
    })
  )
  expect(response.status).toBe(200)
}

beforeAll(async () => {
  await connection`CREATE SCHEMA ${connection(schemaName)}`
  for (const table of [
    'subscription',
    'outbox_event',
    'member',
    'user',
    'organization',
    'workspace',
    'permissions',
    'audit_log',
    'session',
    'account',
    'verification',
  ]) {
    await connection.unsafe(`CREATE TABLE "${table}" (LIKE public."${table}" INCLUDING ALL)`)
  }
  database.current = testDatabase
})

beforeEach(() => {
  stripe = createInMemoryStripe()
  stripeClientMock.requireStripeClient.mockReturnValue(stripe.client)
  beforeReconcile = undefined
  auth = createTestAuth()
})

afterAll(async () => {
  resetEnvFlagsMock()
  try {
    await connection`DROP SCHEMA ${connection(schemaName)} CASCADE`
  } finally {
    await connection.end()
    database.current = undefined
  }
})

async function createUser(label: string) {
  const id = generateId()
  const now = new Date()
  await testDatabase.insert(user).values({
    id,
    name: label,
    email: `${label}-${id}@example.com`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  return { id, email: `${label}-${id}@example.com`, name: label }
}

async function createOrganizationWithPlan(plan: 'team', seats = 1) {
  const organizationId = generateId()
  await testDatabase
    .insert(organization)
    .values({ id: organizationId, name: 'Org', slug: organizationId })
  const subscriptionId = generateId()
  const stripeSubscriptionId = `sub_${subscriptionId}`
  const stripeCustomerId = `cus_${subscriptionId}`
  await testDatabase.insert(subscription).values({
    id: subscriptionId,
    plan,
    referenceId: organizationId,
    status: 'active',
    seats,
    stripeSubscriptionId,
    stripeCustomerId,
    cancelAtPeriodEnd: false,
  })
  stripe.addSubscription({ id: stripeSubscriptionId, customer: stripeCustomerId, quantity: seats })
  return { organizationId, subscriptionId, stripeSubscriptionId, stripeCustomerId }
}

async function addMember(organizationId: string, userId: string, role = 'member') {
  await testDatabase
    .insert(member)
    .values({ id: generateId(), organizationId, userId, role, createdAt: new Date() })
}

/** A user on personal Pro, synced with Stripe, who belongs to a paid Team organization. */
async function createProUserInPaidOrganization(existingUserId?: string) {
  const proUser = existingUserId ? { id: existingUserId } : await createUser('pro')
  const subscriptionId = generateId()
  const stripeSubscriptionId = `sub_${subscriptionId}`
  await testDatabase.insert(subscription).values({
    id: subscriptionId,
    plan: 'pro',
    referenceId: proUser.id,
    status: 'active',
    seats: 1,
    stripeSubscriptionId,
    stripeCustomerId: `cus_${subscriptionId}`,
    cancelAtPeriodEnd: false,
  })
  stripe.addSubscription({ id: stripeSubscriptionId, customer: `cus_${subscriptionId}` })
  const paidOrganization = await createOrganizationWithPlan('team')
  await addMember(paidOrganization.organizationId, proUser.id)
  return { userId: proUser.id, subscriptionId, stripeSubscriptionId, paidOrganization }
}

async function leaveOrganization(userId: string, organizationId: string) {
  await testDatabase
    .delete(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, organizationId)))
}

async function latestOutboxEventId(eventType: string, subscriptionId: string) {
  const [latest] = await testDatabase
    .select({ id: outboxEvent.id })
    .from(outboxEvent)
    .where(
      and(
        eq(outboxEvent.eventType, eventType),
        sql`${outboxEvent.payload} ->> 'subscriptionId' = ${subscriptionId}`
      )
    )
    .orderBy(desc(outboxEvent.createdAt), desc(outboxEvent.id))
    .limit(1)
  if (!latest) throw new Error(`No ${eventType} event for ${subscriptionId}`)
  return latest.id
}

function processEvent(eventId: string) {
  return processOutboxEventById(eventId, billingOutboxHandlers)
}

async function makeDue(eventId: string) {
  await testDatabase
    .update(outboxEvent)
    .set({ availableAt: new Date() })
    .where(eq(outboxEvent.id, eventId))
}

/** Runs the event's last attempt with Stripe unavailable, so it dead-letters without applying. */
async function deadLetter(eventId: string) {
  await testDatabase.update(outboxEvent).set({ maxAttempts: 1 }).where(eq(outboxEvent.id, eventId))
  stripe.failNextRequest('subscriptions.update')
  await expect(processEvent(eventId)).resolves.toBe('dead_letter')
}

async function requeueFromAdminApi(eventId: string) {
  const response = await requeueOutboxEvent(
    new NextRequest(`http://localhost:3000/api/v1/admin/outbox/${eventId}/requeue`, {
      method: 'POST',
      headers: { 'x-admin-key': ADMIN_API_KEY },
    }),
    { params: Promise.resolve({ id: eventId }) }
  )
  expect(response.status).toBe(200)
}

/** Delivers a subscription update Stripe makes on its own, e.g. a renewal. */
async function deliverUnrelatedUpdate(stripeSubscriptionId: string) {
  stripe.updateOutsideSim(stripeSubscriptionId, { metadata: { renewedAt: generateId() } })
  await deliver(stripe.events.at(-1) as Stripe.Event)
}

async function signUp(label: string) {
  const email = `${label}-${generateId()}@example.com`
  const response = await auth.api.signUpEmail({
    body: { email, password: 'integration-fixture-password', name: label },
    asResponse: true,
  })
  expect(response.status).toBe(200)
  const { user: created } = (await response.json()) as { user: { id: string } }
  const cookie = response.headers
    .getSetCookie()
    .map((header) => header.split(';')[0])
    .join('; ')
  return { userId: created.id, cookie }
}

function restoreSubscription(cookie: string) {
  return auth.handler(
    new Request('http://localhost:3000/api/auth/subscription/restore', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, origin: 'http://localhost:3000' },
      body: '{}',
    })
  )
}

async function cancelValuesOfRetryableSyncs(subscriptionId: string) {
  const rows = await testDatabase
    .select({ payload: outboxEvent.payload })
    .from(outboxEvent)
    .where(
      and(
        eq(outboxEvent.eventType, OUTBOX_EVENT_TYPES.STRIPE_SYNC_CANCEL_AT_PERIOD_END),
        sql`${outboxEvent.status} in ('pending', 'processing', 'dead_letter')`,
        sql`${outboxEvent.payload} ->> 'subscriptionId' = ${subscriptionId}`
      )
    )
  return rows.map((row) => (row.payload as { cancelAtPeriodEnd?: boolean }).cancelAtPeriodEnd)
}

async function storedSubscription(subscriptionId: string) {
  const [row] = await testDatabase
    .select({ cancelAtPeriodEnd: subscription.cancelAtPeriodEnd, seats: subscription.seats })
    .from(subscription)
    .where(eq(subscription.id, subscriptionId))
  if (!row) throw new Error(`Subscription ${subscriptionId} not found`)
  return row
}

/** Resolves once another backend is blocked on a lock, i.e. the racing transaction is parked. */
type TestTransaction = Parameters<Parameters<typeof testDatabase.transaction>[0]>[0]

/**
 * Starts a transaction that takes its locks in `holdLocks`, then parks until released and runs
 * `finish`. `untilBlocking` resolves once another backend is waiting on one of its locks.
 */
function startParkedTransaction(
  holdLocks: (tx: TestTransaction) => Promise<void>,
  finish: (tx: TestTransaction) => Promise<void> = async () => {}
) {
  let release: () => void = () => {}
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  let reportPid: (pid: number) => void = () => {}
  const holderPid = new Promise<number>((resolve) => {
    reportPid = resolve
  })
  const done = testDatabase.transaction(async (tx) => {
    await holdLocks(tx)
    const [row] = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`)
    reportPid(row.pid)
    await released
    await finish(tx)
  })
  async function untilBlocking() {
    const pid = await holderPid
    for (let attempt = 0; attempt < 200; attempt++) {
      const [row] = await connection<{ blocked: number }[]>`
        select count(*)::int as blocked from pg_stat_activity
        where ${pid}::int = any(pg_blocking_pids(pid))`
      if (row.blocked > 0) return
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
    throw new Error('No transaction ever waited on the parked one')
  }
  return { done, release, untilBlocking }
}

describe('cancel_at_period_end sync', () => {
  it('pushes the latest value when an earlier sync lands in Stripe after a newer one', async () => {
    const pro = await createProUserInPaidOrganization()
    await pauseProSubscriptionForOrgCoverage(pro.userId)
    const pauseSync = await latestOutboxEventId(
      OUTBOX_EVENT_TYPES.STRIPE_SYNC_CANCEL_AT_PERIOD_END,
      pro.subscriptionId
    )

    const gate = stripe.holdNextRequest('subscriptions.update')
    const pausing = processEvent(pauseSync)
    await gate.reached

    await leaveOrganization(pro.userId, pro.paidOrganization.organizationId)
    await restoreUserProSubscription(pro.userId)
    const restoreSync = await latestOutboxEventId(
      OUTBOX_EVENT_TYPES.STRIPE_SYNC_CANCEL_AT_PERIOD_END,
      pro.subscriptionId
    )
    await expect(processEvent(restoreSync)).resolves.toBe('completed')

    gate.release()
    await pausing

    expect((await storedSubscription(pro.subscriptionId)).cancelAtPeriodEnd).toBe(false)
    expect(stripe.subscription(pro.stripeSubscriptionId).cancel_at_period_end).toBe(false)

    for (const event of stripe.events) await deliver(event)
    expect((await storedSubscription(pro.subscriptionId)).cancelAtPeriodEnd).toBe(false)
  })

  it('keeps the latest committed value when the echo of an earlier sync arrives mid-sync', async () => {
    const pro = await createProUserInPaidOrganization()
    await pauseProSubscriptionForOrgCoverage(pro.userId)
    const pauseSync = await latestOutboxEventId(
      OUTBOX_EVENT_TYPES.STRIPE_SYNC_CANCEL_AT_PERIOD_END,
      pro.subscriptionId
    )

    const stalePush = stripe.holdNextRequest('subscriptions.update')
    const pausing = processEvent(pauseSync)
    await stalePush.reached
    await leaveOrganization(pro.userId, pro.paidOrganization.organizationId)
    await restoreUserProSubscription(pro.userId)

    const correctingPush = stripe.holdNextRequest('subscriptions.update')
    stalePush.release()
    await correctingPush.reached
    expect(stripe.subscription(pro.stripeSubscriptionId).cancel_at_period_end).toBe(true)
    await deliver(stripe.events.at(-1) as Stripe.Event)
    expect((await storedSubscription(pro.subscriptionId)).cancelAtPeriodEnd).toBe(false)

    correctingPush.release()
    await expect(pausing).resolves.toBe('completed')
    const restoreSync = await latestOutboxEventId(
      OUTBOX_EVENT_TYPES.STRIPE_SYNC_CANCEL_AT_PERIOD_END,
      pro.subscriptionId
    )
    await expect(processEvent(restoreSync)).resolves.toBe('completed')
    expect(stripe.subscription(pro.stripeSubscriptionId).cancel_at_period_end).toBe(false)
  })

  it('retries after a request reached Stripe but failed on the client and the value then changed', async () => {
    const pro = await createProUserInPaidOrganization()
    await pauseProSubscriptionForOrgCoverage(pro.userId)
    const pauseSync = await latestOutboxEventId(
      OUTBOX_EVENT_TYPES.STRIPE_SYNC_CANCEL_AT_PERIOD_END,
      pro.subscriptionId
    )

    stripe.failNextUpdateAfterApplying('subscriptions')
    await expect(processEvent(pauseSync)).resolves.toBe('pending')
    expect(stripe.subscription(pro.stripeSubscriptionId).cancel_at_period_end).toBe(true)

    await leaveOrganization(pro.userId, pro.paidOrganization.organizationId)
    await restoreUserProSubscription(pro.userId)
    await makeDue(pauseSync)

    await expect(processEvent(pauseSync)).resolves.toBe('completed')
    expect(stripe.subscription(pro.stripeSubscriptionId).cancel_at_period_end).toBe(false)
  })

  it('keeps a change that has not reached Stripe when an unrelated subscription update arrives', async () => {
    const pro = await createProUserInPaidOrganization()
    await pauseProSubscriptionForOrgCoverage(pro.userId)
    const pauseSync = await latestOutboxEventId(
      OUTBOX_EVENT_TYPES.STRIPE_SYNC_CANCEL_AT_PERIOD_END,
      pro.subscriptionId
    )

    const renewal = stripe.updateOutsideSim(pro.stripeSubscriptionId, {
      metadata: { renewedAt: 'period-2' },
    })
    expect(renewal.cancel_at_period_end).toBe(false)
    await deliver(stripe.events.at(-1) as Stripe.Event)

    expect((await storedSubscription(pro.subscriptionId)).cancelAtPeriodEnd).toBe(true)
    await expect(processEvent(pauseSync)).resolves.toBe('completed')
    expect(stripe.subscription(pro.stripeSubscriptionId).cancel_at_period_end).toBe(true)
  })

  it('keeps the live Stripe value when its webhooks arrive out of order', async () => {
    const pro = await createProUserInPaidOrganization()
    stripe.updateOutsideSim(pro.stripeSubscriptionId, { cancel_at_period_end: true })
    stripe.updateOutsideSim(pro.stripeSubscriptionId, { cancel_at_period_end: false })
    const [cancelled, renewed] = stripe.events

    await deliver(renewed)
    await deliver(cancelled)

    expect((await storedSubscription(pro.subscriptionId)).cancelAtPeriodEnd).toBe(false)
  })

  it('treats clearing a scheduled cancel_at in Stripe as a change made in Stripe', async () => {
    const pro = await createProUserInPaidOrganization()
    const scheduledEnd = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60
    stripe.updateOutsideSim(pro.stripeSubscriptionId, { cancel_at: scheduledEnd })
    await deliver(stripe.events.at(-1) as Stripe.Event)
    await pauseProSubscriptionForOrgCoverage(pro.userId)
    const pauseSync = await latestOutboxEventId(
      OUTBOX_EVENT_TYPES.STRIPE_SYNC_CANCEL_AT_PERIOD_END,
      pro.subscriptionId
    )

    stripe.updateOutsideSim(pro.stripeSubscriptionId, { cancel_at: '' })
    const restore = stripe.events.at(-1) as Stripe.Event
    expect(Object.keys(restore.data.previous_attributes ?? {})).toEqual(['cancel_at'])
    await deliver(restore)

    expect((await storedSubscription(pro.subscriptionId)).cancelAtPeriodEnd).toBe(false)
    expect(new Set(await cancelValuesOfRetryableSyncs(pro.subscriptionId))).toEqual(
      new Set([false])
    )
    await expect(processEvent(pauseSync)).resolves.toBe('completed')
    expect(stripe.subscription(pro.stripeSubscriptionId).cancel_at_period_end).toBe(false)
  })

  it('lets a change made in Stripe while a sync is pending win over the pending value', async () => {
    const pro = await createProUserInPaidOrganization()
    await pauseProSubscriptionForOrgCoverage(pro.userId)
    const pauseSync = await latestOutboxEventId(
      OUTBOX_EVENT_TYPES.STRIPE_SYNC_CANCEL_AT_PERIOD_END,
      pro.subscriptionId
    )

    stripe.updateOutsideSim(pro.stripeSubscriptionId, { cancel_at_period_end: true })
    stripe.updateOutsideSim(pro.stripeSubscriptionId, { cancel_at_period_end: false })
    for (const event of stripe.events) await deliver(event)

    expect((await storedSubscription(pro.subscriptionId)).cancelAtPeriodEnd).toBe(false)
    await expect(processEvent(pauseSync)).resolves.toBe('completed')
    expect(stripe.subscription(pro.stripeSubscriptionId).cancel_at_period_end).toBe(false)
  })
  it('keeps a renewal made in Stripe after later updates while an earlier sync retries', async () => {
    const pro = await createProUserInPaidOrganization()
    await pauseProSubscriptionForOrgCoverage(pro.userId)
    const pauseSync = await latestOutboxEventId(
      OUTBOX_EVENT_TYPES.STRIPE_SYNC_CANCEL_AT_PERIOD_END,
      pro.subscriptionId
    )
    stripe.failNextUpdateAfterApplying('subscriptions')
    await expect(processEvent(pauseSync)).resolves.toBe('pending')
    await deliver(stripe.events.at(-1) as Stripe.Event)

    stripe.updateOutsideSim(pro.stripeSubscriptionId, { cancel_at_period_end: false })
    await deliver(stripe.events.at(-1) as Stripe.Event)
    await deliverUnrelatedUpdate(pro.stripeSubscriptionId)

    await makeDue(pauseSync)
    await expect(processEvent(pauseSync)).resolves.toBe('completed')
    expect((await storedSubscription(pro.subscriptionId)).cancelAtPeriodEnd).toBe(false)
    expect(stripe.subscription(pro.stripeSubscriptionId).cancel_at_period_end).toBe(false)
  })

  it('keeps a cancel-then-renew made in Stripe after a later update while a sync is pending', async () => {
    const pro = await createProUserInPaidOrganization()
    await pauseProSubscriptionForOrgCoverage(pro.userId)
    const pauseSync = await latestOutboxEventId(
      OUTBOX_EVENT_TYPES.STRIPE_SYNC_CANCEL_AT_PERIOD_END,
      pro.subscriptionId
    )

    stripe.updateOutsideSim(pro.stripeSubscriptionId, { cancel_at_period_end: true })
    await deliver(stripe.events.at(-1) as Stripe.Event)
    stripe.updateOutsideSim(pro.stripeSubscriptionId, { cancel_at_period_end: false })
    await deliver(stripe.events.at(-1) as Stripe.Event)
    await deliverUnrelatedUpdate(pro.stripeSubscriptionId)

    await expect(processEvent(pauseSync)).resolves.toBe('completed')
    expect((await storedSubscription(pro.subscriptionId)).cancelAtPeriodEnd).toBe(false)
    expect(stripe.subscription(pro.stripeSubscriptionId).cancel_at_period_end).toBe(false)
  })

  it('does not restore an older value while its slow sync is still running', async () => {
    const pro = await createProUserInPaidOrganization()
    await pauseProSubscriptionForOrgCoverage(pro.userId)
    const pauseSync = await latestOutboxEventId(
      OUTBOX_EVENT_TYPES.STRIPE_SYNC_CANCEL_AT_PERIOD_END,
      pro.subscriptionId
    )
    const slowPush = stripe.holdNextRequest('subscriptions.update')
    const pausing = processEvent(pauseSync)
    await slowPush.reached

    await leaveOrganization(pro.userId, pro.paidOrganization.organizationId)
    await restoreUserProSubscription(pro.userId)
    const restoreSync = await latestOutboxEventId(
      OUTBOX_EVENT_TYPES.STRIPE_SYNC_CANCEL_AT_PERIOD_END,
      pro.subscriptionId
    )
    await expect(processEvent(restoreSync)).resolves.toBe('completed')
    await deliverUnrelatedUpdate(pro.stripeSubscriptionId)
    expect((await storedSubscription(pro.subscriptionId)).cancelAtPeriodEnd).toBe(false)

    slowPush.release()
    await expect(pausing).resolves.toBe('completed')
    expect(stripe.subscription(pro.stripeSubscriptionId).cancel_at_period_end).toBe(false)
  })

  it('does not revive an older value when its dead-lettered sync is requeued', async () => {
    const pro = await createProUserInPaidOrganization()
    await pauseProSubscriptionForOrgCoverage(pro.userId)
    const pauseSync = await latestOutboxEventId(
      OUTBOX_EVENT_TYPES.STRIPE_SYNC_CANCEL_AT_PERIOD_END,
      pro.subscriptionId
    )
    await deadLetter(pauseSync)

    await leaveOrganization(pro.userId, pro.paidOrganization.organizationId)
    await restoreUserProSubscription(pro.userId)
    const restoreSync = await latestOutboxEventId(
      OUTBOX_EVENT_TYPES.STRIPE_SYNC_CANCEL_AT_PERIOD_END,
      pro.subscriptionId
    )
    await expect(processEvent(restoreSync)).resolves.toBe('completed')

    await requeueFromAdminApi(pauseSync)
    await deliverUnrelatedUpdate(pro.stripeSubscriptionId)
    expect((await storedSubscription(pro.subscriptionId)).cancelAtPeriodEnd).toBe(false)
    await expect(processEvent(pauseSync)).resolves.toBe('completed')
    expect(stripe.subscription(pro.stripeSubscriptionId).cancel_at_period_end).toBe(false)
  })

  it('leaves the field alone while a sync enqueued by an older deploy is in flight', async () => {
    const pro = await createProUserInPaidOrganization()
    await pauseProSubscriptionForOrgCoverage(pro.userId)
    await leaveOrganization(pro.userId, pro.paidOrganization.organizationId)
    await testDatabase.transaction(async (tx) => {
      await tx
        .update(subscription)
        .set({ cancelAtPeriodEnd: false })
        .where(eq(subscription.id, pro.subscriptionId))
      await enqueueOutboxEvent(tx, OUTBOX_EVENT_TYPES.STRIPE_SYNC_CANCEL_AT_PERIOD_END, {
        stripeSubscriptionId: pro.stripeSubscriptionId,
        subscriptionId: pro.subscriptionId,
        reason: 'member-left-paid-org',
      })
    })

    await deliverUnrelatedUpdate(pro.stripeSubscriptionId)
    expect((await storedSubscription(pro.subscriptionId)).cancelAtPeriodEnd).toBe(false)
  })

  it('restores a pending value without reading Stripe', async () => {
    const pro = await createProUserInPaidOrganization()
    await pauseProSubscriptionForOrgCoverage(pro.userId)

    stripe.updateOutsideSim(pro.stripeSubscriptionId, { metadata: { renewedAt: 'period-2' } })
    stripe.failNextRequest('subscriptions.retrieve')
    await deliver(stripe.events.at(-1) as Stripe.Event)

    expect((await storedSubscription(pro.subscriptionId)).cancelAtPeriodEnd).toBe(true)
  })

  it('pushes the committed value when its sync runs between the plugin write and the reconcile', async () => {
    const pro = await createProUserInPaidOrganization()
    await pauseProSubscriptionForOrgCoverage(pro.userId)
    const pauseSync = await latestOutboxEventId(
      OUTBOX_EVENT_TYPES.STRIPE_SYNC_CANCEL_AT_PERIOD_END,
      pro.subscriptionId
    )

    beforeReconcile = async () => {
      beforeReconcile = undefined
      await expect(processEvent(pauseSync)).resolves.toBe('completed')
    }
    await deliverUnrelatedUpdate(pro.stripeSubscriptionId)

    expect(stripe.subscription(pro.stripeSubscriptionId).cancel_at_period_end).toBe(true)
    expect((await storedSubscription(pro.subscriptionId)).cancelAtPeriodEnd).toBe(true)
  })

  it('orders concurrent reconciles of Stripe-side changes by when each read Stripe', async () => {
    const pro = await createProUserInPaidOrganization()
    await pauseProSubscriptionForOrgCoverage(pro.userId)
    const pauseSync = await latestOutboxEventId(
      OUTBOX_EVENT_TYPES.STRIPE_SYNC_CANCEL_AT_PERIOD_END,
      pro.subscriptionId
    )
    stripe.failNextUpdateAfterApplying('subscriptions')
    await expect(processEvent(pauseSync)).resolves.toBe('pending')

    stripe.updateOutsideSim(pro.stripeSubscriptionId, { cancel_at_period_end: false })
    const renewal = stripe.events.at(-1) as Stripe.Event
    const firstRead = stripe.holdNextRequest('subscriptions.retrieve')
    const secondRead = stripe.holdNextRequest('subscriptions.retrieve')
    const reconcilingRenewal = deliver(renewal)
    await firstRead.reached

    stripe.updateOutsideSim(pro.stripeSubscriptionId, { cancel_at_period_end: true })
    const reconcilingCancel = deliver(stripe.events.at(-1) as Stripe.Event)
    await secondRead.reached

    firstRead.release()
    await reconcilingRenewal
    secondRead.release()
    await reconcilingCancel

    expect((await storedSubscription(pro.subscriptionId)).cancelAtPeriodEnd).toBe(true)
    await makeDue(pauseSync)
    await expect(processEvent(pauseSync)).resolves.toBe('completed')
    expect(stripe.subscription(pro.stripeSubscriptionId).cancel_at_period_end).toBe(true)
  })

  it('keeps a value Sim committed after the reconcile read Stripe', async () => {
    const pro = await createProUserInPaidOrganization()
    await pauseProSubscriptionForOrgCoverage(pro.userId)
    const pauseSync = await latestOutboxEventId(
      OUTBOX_EVENT_TYPES.STRIPE_SYNC_CANCEL_AT_PERIOD_END,
      pro.subscriptionId
    )
    await expect(processEvent(pauseSync)).resolves.toBe('completed')

    stripe.updateOutsideSim(pro.stripeSubscriptionId, { cancel_at_period_end: false })
    const liveRead = stripe.holdNextRequest('subscriptions.retrieve')
    const delivering = deliver(stripe.events.at(-1) as Stripe.Event)
    await liveRead.reached
    await testDatabase.transaction(async (tx) => {
      await tx
        .update(subscription)
        .set({ cancelAtPeriodEnd: true })
        .where(eq(subscription.id, pro.subscriptionId))
      await enqueueCancelAtPeriodEndSync(tx, {
        stripeSubscriptionId: pro.stripeSubscriptionId,
        subscriptionId: pro.subscriptionId,
        cancelAtPeriodEnd: true,
        reason: 'admin-cancel-at-period-end',
      })
    })
    liveRead.release()
    await delivering

    expect((await storedSubscription(pro.subscriptionId)).cancelAtPeriodEnd).toBe(true)
    const adminSync = await latestOutboxEventId(
      OUTBOX_EVENT_TYPES.STRIPE_SYNC_CANCEL_AT_PERIOD_END,
      pro.subscriptionId
    )
    await expect(processEvent(adminSync)).resolves.toBe('completed')
    expect(stripe.subscription(pro.stripeSubscriptionId).cancel_at_period_end).toBe(true)
  })

  it('requeues with the pending value when the plugin has overwritten the row', async () => {
    const pro = await createProUserInPaidOrganization()
    await pauseProSubscriptionForOrgCoverage(pro.userId)
    const pauseSync = await latestOutboxEventId(
      OUTBOX_EVENT_TYPES.STRIPE_SYNC_CANCEL_AT_PERIOD_END,
      pro.subscriptionId
    )
    await deadLetter(pauseSync)
    await testDatabase.transaction(async (tx) => {
      await tx
        .select({ id: subscription.id })
        .from(subscription)
        .where(eq(subscription.id, pro.subscriptionId))
        .for('update')
      await enqueueCancelAtPeriodEndSync(tx, {
        stripeSubscriptionId: pro.stripeSubscriptionId,
        subscriptionId: pro.subscriptionId,
        cancelAtPeriodEnd: true,
        reason: 'admin-cancel-at-period-end',
      })
    })
    const adminSync = await latestOutboxEventId(
      OUTBOX_EVENT_TYPES.STRIPE_SYNC_CANCEL_AT_PERIOD_END,
      pro.subscriptionId
    )

    beforeReconcile = async () => {
      beforeReconcile = undefined
      await requeueFromAdminApi(pauseSync)
    }
    await deliverUnrelatedUpdate(pro.stripeSubscriptionId)

    expect((await storedSubscription(pro.subscriptionId)).cancelAtPeriodEnd).toBe(true)
    await expect(processEvent(adminSync)).resolves.toBe('completed')
    await expect(processEvent(pauseSync)).resolves.toBe('completed')
    expect(stripe.subscription(pro.stripeSubscriptionId).cancel_at_period_end).toBe(true)
  })

  it('does not revive an older value when a retry path resets its sync without re-committing', async () => {
    const pro = await createProUserInPaidOrganization()
    await pauseProSubscriptionForOrgCoverage(pro.userId)
    const pauseSync = await latestOutboxEventId(
      OUTBOX_EVENT_TYPES.STRIPE_SYNC_CANCEL_AT_PERIOD_END,
      pro.subscriptionId
    )
    await deadLetter(pauseSync)
    await leaveOrganization(pro.userId, pro.paidOrganization.organizationId)
    await restoreUserProSubscription(pro.userId)
    const restoreSync = await latestOutboxEventId(
      OUTBOX_EVENT_TYPES.STRIPE_SYNC_CANCEL_AT_PERIOD_END,
      pro.subscriptionId
    )
    await expect(processEvent(restoreSync)).resolves.toBe('completed')

    await testDatabase
      .update(outboxEvent)
      .set({
        status: 'pending',
        attempts: 0,
        lastError: null,
        availableAt: new Date(),
        lockedAt: null,
        processedAt: null,
      })
      .where(eq(outboxEvent.id, pauseSync))
    await deliverUnrelatedUpdate(pro.stripeSubscriptionId)

    expect((await storedSubscription(pro.subscriptionId)).cancelAtPeriodEnd).toBe(false)
    await expect(processEvent(pauseSync)).resolves.toBe('completed')
    expect(stripe.subscription(pro.stripeSubscriptionId).cancel_at_period_end).toBe(false)
  })

  it("treats a write from an older deploy's sync handler as Sim's own echo", async () => {
    const pro = await createProUserInPaidOrganization()
    await pauseProSubscriptionForOrgCoverage(pro.userId)
    const pauseSync = await latestOutboxEventId(
      OUTBOX_EVENT_TYPES.STRIPE_SYNC_CANCEL_AT_PERIOD_END,
      pro.subscriptionId
    )
    await leaveOrganization(pro.userId, pro.paidOrganization.organizationId)
    await restoreUserProSubscription(pro.userId)

    await stripe.client.subscriptions.update(
      pro.stripeSubscriptionId,
      { cancel_at_period_end: true },
      { idempotencyKey: `outbox:${pauseSync}` }
    )
    await deliver(stripe.events.at(-1) as Stripe.Event)

    expect((await storedSubscription(pro.subscriptionId)).cancelAtPeriodEnd).toBe(false)
  })

  it("records a customer's restore through the real endpoint while an earlier sync is retrying", async () => {
    const customer = await signUp('restorer')
    const pro = await createProUserInPaidOrganization(customer.userId)
    await pauseProSubscriptionForOrgCoverage(pro.userId)
    const pauseSync = await latestOutboxEventId(
      OUTBOX_EVENT_TYPES.STRIPE_SYNC_CANCEL_AT_PERIOD_END,
      pro.subscriptionId
    )
    stripe.failNextUpdateAfterApplying('subscriptions')
    await expect(processEvent(pauseSync)).resolves.toBe('pending')

    expect((await restoreSubscription(customer.cookie)).status).toBe(200)
    const restoreEvent = stripe.events.at(-1) as Stripe.Event
    expect((await storedSubscription(pro.subscriptionId)).cancelAtPeriodEnd).toBe(false)
    expect(new Set(await cancelValuesOfRetryableSyncs(pro.subscriptionId))).toEqual(
      new Set([false])
    )

    await deliverUnrelatedUpdate(pro.stripeSubscriptionId)
    await makeDue(pauseSync)
    await expect(processEvent(pauseSync)).resolves.toBe('completed')
    await deliver(restoreEvent)

    expect((await storedSubscription(pro.subscriptionId)).cancelAtPeriodEnd).toBe(false)
    expect(stripe.subscription(pro.stripeSubscriptionId).cancel_at_period_end).toBe(false)
  })

  it('records nothing when the restore endpoint refuses the request', async () => {
    const customer = await signUp('not-cancelling')
    const pro = await createProUserInPaidOrganization(customer.userId)

    expect((await restoreSubscription(customer.cookie)).status).toBe(400)
    expect((await storedSubscription(pro.subscriptionId)).cancelAtPeriodEnd).toBe(false)
    expect(await cancelValuesOfRetryableSyncs(pro.subscriptionId)).toEqual([])
  })
})

describe('Team activation', () => {
  it('records the cleared cancellation when a cancel is committed while it activates Team', async () => {
    const owner = await createUser('owner')
    const subscriptionId = generateId()
    const stripeSubscriptionId = `sub_${subscriptionId}`
    await testDatabase.insert(subscription).values({
      id: subscriptionId,
      plan: 'team',
      referenceId: owner.id,
      status: 'active',
      seats: 1,
      stripeSubscriptionId,
      stripeCustomerId: `cus_${subscriptionId}`,
      cancelAtPeriodEnd: false,
    })
    stripe.addSubscription({ id: stripeSubscriptionId, customer: `cus_${subscriptionId}` })

    const cancelling = startParkedTransaction(async (tx) => {
      await tx
        .update(subscription)
        .set({ cancelAtPeriodEnd: true })
        .where(eq(subscription.id, subscriptionId))
      await enqueueCancelAtPeriodEndSync(tx, {
        stripeSubscriptionId,
        subscriptionId,
        cancelAtPeriodEnd: true,
        reason: 'admin-cancel-at-period-end',
      })
    })
    const activating = testDatabase.transaction((tx) =>
      ensureTeamOrganizationForAcceptance({
        billingOwnerUserId: owner.id,
        workspaceOrganizationId: null,
        executor: tx,
        workspaceIdsToAttach: [],
      })
    )
    await cancelling.untilBlocking()
    cancelling.release()
    await cancelling.done
    await expect(activating).resolves.toMatchObject({ success: true })
    expect((await storedSubscription(subscriptionId)).cancelAtPeriodEnd).toBe(false)

    await deliverUnrelatedUpdate(stripeSubscriptionId)
    expect((await storedSubscription(subscriptionId)).cancelAtPeriodEnd).toBe(false)
    const cancelSync = await latestOutboxEventId(
      OUTBOX_EVENT_TYPES.STRIPE_SYNC_CANCEL_AT_PERIOD_END,
      subscriptionId
    )
    await expect(processEvent(cancelSync)).resolves.toBe('completed')
    expect(stripe.subscription(stripeSubscriptionId).cancel_at_period_end).toBe(false)
  })
})

describe('operator retry', () => {
  it('requeues a dead-lettered sync while a writer commits a new value for the subscription', async () => {
    const pro = await createProUserInPaidOrganization()
    await pauseProSubscriptionForOrgCoverage(pro.userId)
    const pauseSync = await latestOutboxEventId(
      OUTBOX_EVENT_TYPES.STRIPE_SYNC_CANCEL_AT_PERIOD_END,
      pro.subscriptionId
    )
    await deadLetter(pauseSync)

    const writing = startParkedTransaction(
      async (tx) => {
        await tx
          .update(subscription)
          .set({ cancelAtPeriodEnd: false })
          .where(eq(subscription.id, pro.subscriptionId))
      },
      async (tx) => {
        await enqueueCancelAtPeriodEndSync(tx, {
          stripeSubscriptionId: pro.stripeSubscriptionId,
          subscriptionId: pro.subscriptionId,
          cancelAtPeriodEnd: false,
          reason: 'member-left-paid-org',
        })
      }
    )
    const requeuing = requeueFromAdminApi(pauseSync)
    await writing.untilBlocking()
    writing.release()

    await expect(Promise.all([writing.done, requeuing])).resolves.toBeDefined()
    await deliverUnrelatedUpdate(pro.stripeSubscriptionId)
    expect((await storedSubscription(pro.subscriptionId)).cancelAtPeriodEnd).toBe(false)
  })

  it('retries a dead-lettered dashboard cancellation while a writer commits a new value', async () => {
    const org = await createOrganizationWithPlan('team')
    const operationId = generateId()
    const actor = { id: null, name: 'Admin', email: null }
    await requestDashboardSubscriptionCancellation({
      organizationId: org.organizationId,
      operationId,
      timing: 'period_end',
      actor,
    })
    const cancelSync = await latestOutboxEventId(
      OUTBOX_EVENT_TYPES.STRIPE_SYNC_CANCEL_AT_PERIOD_END,
      org.subscriptionId
    )
    await deadLetter(cancelSync)

    const writing = startParkedTransaction(
      async (tx) => {
        await tx
          .update(subscription)
          .set({ cancelAtPeriodEnd: false })
          .where(eq(subscription.id, org.subscriptionId))
      },
      async (tx) => {
        await enqueueCancelAtPeriodEndSync(tx, {
          stripeSubscriptionId: org.stripeSubscriptionId,
          subscriptionId: org.subscriptionId,
          cancelAtPeriodEnd: false,
          reason: 'pro-to-team-conversion',
        })
      }
    )
    const retrying = requestDashboardSubscriptionCancellation({
      organizationId: org.organizationId,
      operationId,
      timing: 'period_end',
      actor,
    })
    await writing.untilBlocking()
    writing.release()

    await expect(Promise.all([writing.done, retrying])).resolves.toBeDefined()
    expect((await storedSubscription(org.subscriptionId)).cancelAtPeriodEnd).toBe(true)
  })
})

describe('customer contact sync', () => {
  it('pushes the current owner when an earlier sync lands in Stripe after a newer one', async () => {
    const [first, second, third] = await Promise.all([
      createUser('first-owner'),
      createUser('second-owner'),
      createUser('third-owner'),
    ])
    const org = await createOrganizationWithPlan('team')
    stripe.addCustomer({ id: org.stripeCustomerId, email: first.email, name: first.name })
    await addMember(org.organizationId, first.id, 'owner')
    await addMember(org.organizationId, second.id)
    await addMember(org.organizationId, third.id)

    async function transferOwnership(from: string, to: string) {
      await testDatabase.transaction(async (tx) => {
        await tx.update(member).set({ role: 'admin' }).where(eq(member.userId, from))
        await tx.update(member).set({ role: 'owner' }).where(eq(member.userId, to))
        await enqueueOutboxEvent(tx, OUTBOX_EVENT_TYPES.STRIPE_SYNC_CUSTOMER_CONTACT, {
          subscriptionId: org.subscriptionId,
          reason: 'ownership-transfer',
        })
      })
      return latestOutboxEventId(
        OUTBOX_EVENT_TYPES.STRIPE_SYNC_CUSTOMER_CONTACT,
        org.subscriptionId
      )
    }

    const firstSync = await transferOwnership(first.id, second.id)
    const gate = stripe.holdNextRequest('customers.update')
    const firstSyncRun = processEvent(firstSync)
    await gate.reached

    const secondSync = await transferOwnership(second.id, third.id)
    await expect(processEvent(secondSync)).resolves.toBe('completed')
    gate.release()
    await firstSyncRun

    expect(stripe.customer(org.stripeCustomerId)).toMatchObject({
      email: third.email,
      name: third.name,
    })
  })
})

describe('Team seat sync', () => {
  beforeAll(() => setEnvFlags({ isBillingEnabled: true }))

  it('keeps a seat change that has not reached Stripe when a stale subscription update arrives', async () => {
    const [owner, joiner] = await Promise.all([createUser('owner'), createUser('joiner')])
    const org = await createOrganizationWithPlan('team', 1)
    await addMember(org.organizationId, owner.id, 'owner')
    await addMember(org.organizationId, joiner.id)
    await reconcileOrganizationSeats({ organizationId: org.organizationId, reason: 'member-added' })
    expect((await storedSubscription(org.subscriptionId)).seats).toBe(2)
    const seatSync = await latestOutboxEventId(
      OUTBOX_EVENT_TYPES.STRIPE_SYNC_SUBSCRIPTION_SEATS,
      org.subscriptionId
    )

    stripe.updateOutsideSim(org.stripeSubscriptionId, { metadata: { renewedAt: 'period-2' } })
    await deliver(stripe.events.at(-1) as Stripe.Event)

    expect((await storedSubscription(org.subscriptionId)).seats).toBe(2)
    await expect(processEvent(seatSync)).resolves.toBe('completed')
    expect(stripe.subscription(org.stripeSubscriptionId).items.data[0].quantity).toBe(2)
  })
  it('pushes the committed seats when its sync runs between the plugin write and the reconcile', async () => {
    const [owner, joiner] = await Promise.all([createUser('owner'), createUser('joiner')])
    const org = await createOrganizationWithPlan('team', 1)
    await addMember(org.organizationId, owner.id, 'owner')
    await addMember(org.organizationId, joiner.id)
    await reconcileOrganizationSeats({ organizationId: org.organizationId, reason: 'member-added' })
    const seatSync = await latestOutboxEventId(
      OUTBOX_EVENT_TYPES.STRIPE_SYNC_SUBSCRIPTION_SEATS,
      org.subscriptionId
    )

    beforeReconcile = async () => {
      beforeReconcile = undefined
      await expect(processEvent(seatSync)).resolves.toBe('completed')
    }
    await deliverUnrelatedUpdate(org.stripeSubscriptionId)

    expect(stripe.subscription(org.stripeSubscriptionId).items.data[0].quantity).toBe(2)
  })

  it('pushes the latest plan when an earlier seat sync lands in Stripe after a newer one', async () => {
    const [smallTeam, largeTeam] = CREDIT_TIERS.map((tier) => `team_${tier.credits}`)
    const org = await createOrganizationWithPlan('team', 1)
    await testDatabase
      .update(subscription)
      .set({ plan: smallTeam })
      .where(eq(subscription.id, org.subscriptionId))
    async function commitPlan(plan: string) {
      await testDatabase.transaction(async (tx) => {
        await tx.update(subscription).set({ plan }).where(eq(subscription.id, org.subscriptionId))
        await enqueueSubscriptionSeatsSync(tx, {
          subscriptionId: org.subscriptionId,
          seats: 1,
          reason: 'plan-change',
        })
      })
      return latestOutboxEventId(
        OUTBOX_EVENT_TYPES.STRIPE_SYNC_SUBSCRIPTION_SEATS,
        org.subscriptionId
      )
    }

    const smallSync = await commitPlan(smallTeam)
    const stalePush = stripe.holdNextRequest('subscriptions.update')
    const pushingSmall = processEvent(smallSync)
    await stalePush.reached
    const largeSync = await commitPlan(largeTeam)
    await expect(processEvent(largeSync)).resolves.toBe('completed')
    stalePush.release()
    await expect(pushingSmall).resolves.toBe('completed')

    expect(stripe.subscription(org.stripeSubscriptionId).items.data[0].price.id).toBe(
      'price_team_max_tier_month'
    )
  })

  it('does not revive an older seat count when its dead-lettered sync is requeued', async () => {
    const [owner, joiner] = await Promise.all([createUser('owner'), createUser('joiner')])
    const org = await createOrganizationWithPlan('team', 1)
    await addMember(org.organizationId, owner.id, 'owner')
    await addMember(org.organizationId, joiner.id)
    await reconcileOrganizationSeats({ organizationId: org.organizationId, reason: 'member-added' })
    const growSync = await latestOutboxEventId(
      OUTBOX_EVENT_TYPES.STRIPE_SYNC_SUBSCRIPTION_SEATS,
      org.subscriptionId
    )
    await deadLetter(growSync)

    await leaveOrganization(joiner.id, org.organizationId)
    await reconcileOrganizationSeats({
      organizationId: org.organizationId,
      reason: 'member-removed',
    })
    const shrinkSync = await latestOutboxEventId(
      OUTBOX_EVENT_TYPES.STRIPE_SYNC_SUBSCRIPTION_SEATS,
      org.subscriptionId
    )
    await expect(processEvent(shrinkSync)).resolves.toBe('completed')

    await requeueFromAdminApi(growSync)
    await deliverUnrelatedUpdate(org.stripeSubscriptionId)
    expect((await storedSubscription(org.subscriptionId)).seats).toBe(1)
    await expect(processEvent(growSync)).resolves.toBe('completed')
    expect(stripe.subscription(org.stripeSubscriptionId).items.data[0].quantity).toBe(1)
  })
})

describe('webhook reconcile cost', () => {
  interface QueryPlan {
    'Node Type': string
    'Relation Name'?: string
    'Shared Hit Blocks': number
    'Shared Read Blocks': number
    'Actual Rows': number
    Plans?: QueryPlan[]
  }

  /** EXPLAIN ANALYZE inside a rolled-back transaction, so a measured UPDATE changes nothing. */
  async function explainWithoutEffects(query: string, parameters: unknown[]) {
    const rollback = new Error('rollback')
    let plan: QueryPlan | undefined
    await connection
      .begin(async (sql) => {
        const [explained] = await sql.unsafe(
          `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`,
          parameters as never[]
        )
        plan = (explained['QUERY PLAN'] as { Plan: QueryPlan }[])[0].Plan
        throw rollback
      })
      .catch((error: unknown) => {
        if (error !== rollback) throw error
      })
    if (!plan) throw new Error(`No plan for ${query}`)
    return plan
  }
  const planNodes = (plan: QueryPlan): QueryPlan[] => [
    plan,
    ...(plan.Plans ?? []).flatMap(planNodes),
  ]

  it('reads only in-flight syncs, however many have completed or dead-lettered', async () => {
    const pro = await createProUserInPaidOrganization()
    await pauseProSubscriptionForOrgCoverage(pro.userId)
    for (const [status, count] of [
      ['completed', 20000],
      ['dead_letter', 50],
    ] as const) {
      await connection`
        INSERT INTO outbox_event (id, event_type, payload, status, available_at, created_at, processed_at)
        SELECT ${generateId()} || ':' || n, ${OUTBOX_EVENT_TYPES.STRIPE_SYNC_CANCEL_AT_PERIOD_END},
          json_build_object(
            'subscriptionId', ${pro.subscriptionId}::text,
            'cancelAtPeriodEnd', false,
            'committedAt', n
          ),
          ${status}, now(), now(), now()
        FROM generate_series(1, ${count}::integer) AS n`
    }
    await connection`ANALYZE outbox_event`

    const issued: { query: string; parameters: unknown[] }[] = []
    const traced = postgres(
      readTestDatabaseUrl(),
      withUtcTimestamps({
        max: 2,
        prepare: false,
        fetch_types: false,
        connection: { search_path: schemaName },
        onnotice: () => {},
        debug: (_connection: number, query: string, parameters: unknown[]) => {
          issued.push({ query, parameters })
        },
      })
    )
    database.current = drizzle(traced, { schema })
    try {
      await deliverUnrelatedUpdate(pro.stripeSubscriptionId)
      stripe.updateOutsideSim(pro.stripeSubscriptionId, { cancel_at_period_end: true })
      await deliver(stripe.events.at(-1) as Stripe.Event)
    } finally {
      database.current = testDatabase
      await traced.end()
    }
    expect((await storedSubscription(pro.subscriptionId)).cancelAtPeriodEnd).toBe(true)
    expect(new Set(await cancelValuesOfRetryableSyncs(pro.subscriptionId))).toEqual(new Set([true]))

    const outboxQueries = issued.filter(({ query }) => /"outbox_event"/i.test(query))
    expect(outboxQueries.some(({ query }) => /^update/i.test(query))).toBe(true)
    for (const { query, parameters } of outboxQueries) {
      const plan = await explainWithoutEffects(query, parameters)
      expect(
        planNodes(plan).some(
          (node) => node['Node Type'] === 'Seq Scan' && node['Relation Name'] === 'outbox_event'
        )
      ).toBe(false)
      expect(plan['Shared Hit Blocks'] + plan['Shared Read Blocks']).toBeLessThan(200)
      if (/^select/i.test(query)) expect(plan['Actual Rows']).toBeLessThanOrEqual(1)
    }
  })
})
