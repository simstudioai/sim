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
import { and, asc, eq, sql } from 'drizzle-orm'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import type Stripe from 'stripe'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

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

import { createSimAuthAdapter } from '@/lib/auth/sim-auth-adapter'
import {
  pauseProSubscriptionForOrgCoverage,
  restoreUserProSubscription,
} from '@/lib/billing/organizations/membership'
import { reconcileOrganizationSeats } from '@/lib/billing/organizations/seats'
import { isTeam } from '@/lib/billing/plan-helpers'
import { syncSeatsFromStripeQuantity } from '@/lib/billing/validation/seat-management'
import { OUTBOX_EVENT_TYPES } from '@/lib/billing/webhooks/outbox-events'
import { billingOutboxHandlers } from '@/lib/billing/webhooks/outbox-handlers'
import { reconcileSubscriptionSyncFromStripe } from '@/lib/billing/webhooks/subscription-sync'
import { enqueueOutboxEvent, processOutboxEventById } from '@/lib/core/outbox/service'

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

/**
 * Sim's Stripe plugin callbacks from `lib/auth/auth.ts`, reduced to the parts that touch the
 * synced fields: the seat sync in `onSubscriptionUpdate` and the reconcile step in `onEvent`.
 */
function createWebhookEndpoint() {
  const auth = betterAuth({
    baseURL: 'http://localhost:3000',
    secret: 'isolated-integration-fixture-secret-not-a-real-credential',
    database: (options: BetterAuthOptions) => createSimAuthAdapter(options, testDatabase),
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
        onEvent: reconcileSubscriptionSyncFromStripe,
      }),
    ],
  })

  return async function deliver(event: Stripe.Event) {
    const response = await auth.handler(
      new Request('http://localhost:3000/api/auth/stripe/webhook', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=fixture' },
        body: JSON.stringify(event),
      })
    )
    expect(response.status).toBe(200)
  }
}

let deliver: ReturnType<typeof createWebhookEndpoint>

beforeAll(async () => {
  await connection`CREATE SCHEMA ${connection(schemaName)}`
  for (const table of ['subscription', 'outbox_event', 'member', 'user', 'organization']) {
    await connection.unsafe(`CREATE TABLE "${table}" (LIKE public."${table}" INCLUDING ALL)`)
  }
  database.current = testDatabase
})

beforeEach(() => {
  stripe = createInMemoryStripe()
  stripeClientMock.requireStripeClient.mockReturnValue(stripe.client)
  deliver = createWebhookEndpoint()
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
async function createProUserInPaidOrganization() {
  const proUser = await createUser('pro')
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

async function outboxEventIds(eventType: string, subscriptionId: string) {
  const rows = await testDatabase
    .select({ id: outboxEvent.id })
    .from(outboxEvent)
    .where(
      and(
        eq(outboxEvent.eventType, eventType),
        sql`${outboxEvent.payload} ->> 'subscriptionId' = ${subscriptionId}`
      )
    )
    .orderBy(asc(outboxEvent.createdAt), asc(outboxEvent.id))
  return rows.map((row) => row.id)
}

async function latestOutboxEventId(eventType: string, subscriptionId: string) {
  const ids = await outboxEventIds(eventType, subscriptionId)
  const id = ids.at(-1)
  if (!id) throw new Error(`No ${eventType} event for ${subscriptionId}`)
  return id
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

async function storedSubscription(subscriptionId: string) {
  const [row] = await testDatabase
    .select({ cancelAtPeriodEnd: subscription.cancelAtPeriodEnd, seats: subscription.seats })
    .from(subscription)
    .where(eq(subscription.id, subscriptionId))
  if (!row) throw new Error(`Subscription ${subscriptionId} not found`)
  return row
}

describe('cancel_at_period_end sync', () => {
  it('pushes the latest value when an earlier sync lands in Stripe after a newer one', async () => {
    const pro = await createProUserInPaidOrganization()
    await pauseProSubscriptionForOrgCoverage(pro.userId)
    const pauseSync = await latestOutboxEventId(
      OUTBOX_EVENT_TYPES.STRIPE_SYNC_CANCEL_AT_PERIOD_END,
      pro.subscriptionId
    )

    const gate = stripe.holdNextUpdate('subscriptions')
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

    const stalePush = stripe.holdNextUpdate('subscriptions')
    const pausing = processEvent(pauseSync)
    await stalePush.reached
    await leaveOrganization(pro.userId, pro.paidOrganization.organizationId)
    await restoreUserProSubscription(pro.userId)

    const correctingPush = stripe.holdNextUpdate('subscriptions')
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
    const gate = stripe.holdNextUpdate('customers')
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
})
