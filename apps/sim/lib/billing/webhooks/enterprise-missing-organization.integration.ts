/**
 * Stripe subscription webhooks for an Enterprise subscription whose referenced organization no
 * longer exists, against real PostgreSQL and the real Better Auth Stripe webhook endpoint (plugin
 * write first, then Sim's callbacks), with an in-memory Stripe.
 *
 * Failure modes covered:
 * - a renewal for a live subscription whose organization was deleted fails into Stripe's retry
 *   loop forever instead of being acknowledged;
 * - a dashboard-created Enterprise subscription naming a nonexistent organization does the same;
 * - the update callback treats the dangling organization id as a user upgrading to Team and
 *   seeds an organization owned by that nonexistent user;
 * - acknowledging permanent failures swallows a transient one (an issuance whose Stripe writes
 *   have not landed yet), so the event is never redelivered.
 *
 * The copied tables carry no foreign keys, so an attempted organization creation for a dangling
 * reference persists here instead of being rolled back by the member foreign key: the suite
 * checks the decision, not the constraint that backstops it.
 */

import { stripe as stripePlugin } from '@better-auth/stripe'
import * as schema from '@sim/db/schema'
import { member, organization, outboxEvent, subscription, user } from '@sim/db/schema'
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { withUtcTimestamps } from '@sim/db/timestamps'
import {
  createInMemoryStripe,
  createMockStripeEvent,
  type InMemoryStripe,
  stripeClientMock,
} from '@sim/testing/mocks/stripe.mock'
import { generateId } from '@sim/utils/id'
import { type BetterAuthOptions, betterAuth } from 'better-auth'
import { eq } from 'drizzle-orm'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import type Stripe from 'stripe'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const database = vi.hoisted(() => ({
  current: undefined as PostgresJsDatabase<typeof schema> | undefined,
}))

vi.mock('@sim/db', () => ({
  get db() {
    if (!database.current) throw new Error('Enterprise webhook test database is not initialized')
    return database.current
  },
}))
vi.mock('@/lib/billing/stripe-client', () => stripeClientMock)

import { createSimAuthAdapter } from '@/lib/auth/sim-auth-adapter'
import { ENTERPRISE_PROVISION_EVENT_TYPE } from '@/lib/billing/enterprise-outbox-events'
import { ensureOrganizationForTeamSubscription } from '@/lib/billing/organization'
import { handleManualEnterpriseSubscription } from '@/lib/billing/webhooks/enterprise'
import { reconcileSubscriptionSyncFromStripe } from '@/lib/billing/webhooks/subscription-sync'
import { handleSubscriptionUsageUpdate } from '@/lib/billing/webhooks/subscription-usage'

const schemaName = `enterprise_missing_org_${generateId().replaceAll('-', '')}`
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

const INVOICE_AMOUNT_CENTS = 100_000

let stripe: InMemoryStripe

/**
 * Sim's Better Auth Stripe wiring from `lib/auth/auth.ts`, reduced to the organization
 * resolution in `onSubscriptionUpdate` and the subscription steps of `onEvent`, in order.
 */
function createTestAuth() {
  return betterAuth({
    baseURL: 'http://localhost:3000',
    secret: 'isolated-integration-fixture-secret-not-a-real-credential',
    database: (options: BetterAuthOptions) => createSimAuthAdapter(options, testDatabase),
    emailAndPassword: { enabled: true },
    plugins: [
      stripePlugin({
        stripeClient: stripe.client,
        stripeWebhookSecret: 'whsec_fixture',
        subscription: {
          enabled: true,
          plans: [],
          onSubscriptionUpdate: async ({ event, subscription: updated }) => {
            const stripeSubscription = event.data.object as Stripe.Subscription
            await ensureOrganizationForTeamSubscription({
              ...updated,
              enterpriseOperationId: stripeSubscription.metadata?.enterpriseOperationId ?? null,
            })
          },
        },
        onEvent: async (event) => {
          if (
            event.type !== 'customer.subscription.created' &&
            event.type !== 'customer.subscription.updated'
          ) {
            return
          }
          await handleManualEnterpriseSubscription(event)
          await reconcileSubscriptionSyncFromStripe(event)
          await handleSubscriptionUsageUpdate(event)
        },
      }),
    ],
  })
}

let auth: ReturnType<typeof createTestAuth>

function deliver(event: Stripe.Event) {
  return auth.handler(
    new Request('http://localhost:3000/api/auth/stripe/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=fixture' },
      body: JSON.stringify(event),
    })
  )
}

beforeAll(async () => {
  await connection`CREATE SCHEMA ${connection(schemaName)}`
  for (const table of [
    'subscription',
    'outbox_event',
    'idempotency_key',
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
  auth = createTestAuth()
})

afterAll(async () => {
  try {
    await connection`DROP SCHEMA ${connection(schemaName)} CASCADE`
  } finally {
    await connection.end()
    database.current = undefined
  }
})

/** An Enterprise owner whose Stripe customer carries a subscription for `organizationId`. */
async function createEnterpriseCustomer(
  organizationId: string,
  extraMetadata: Record<string, string> = {}
) {
  const ownerId = generateId()
  const stripeCustomerId = `cus_${generateId()}`
  const stripeSubscriptionId = `sub_${generateId()}`
  const now = new Date()
  await testDatabase.insert(user).values({
    id: ownerId,
    name: 'Owner',
    email: `owner-${ownerId}@example.com`,
    emailVerified: true,
    stripeCustomerId,
    createdAt: now,
    updatedAt: now,
  })
  stripe.addSubscription({
    id: stripeSubscriptionId,
    customer: stripeCustomerId,
    unitAmount: INVOICE_AMOUNT_CENTS,
    metadata: {
      plan: 'enterprise',
      referenceId: organizationId,
      seats: '5',
      invoiceAmountCents: String(INVOICE_AMOUNT_CENTS),
      ...extraMetadata,
    },
  })
  return { stripeCustomerId, stripeSubscriptionId }
}

/** A live Enterprise subscription row whose organization was deleted after issuance. */
async function createSubscriptionForDeletedOrganization() {
  const deletedOrganizationId = `org_${generateId()}`
  const customer = await createEnterpriseCustomer(deletedOrganizationId)
  const subscriptionId = generateId()
  await testDatabase.insert(subscription).values({
    id: subscriptionId,
    plan: 'enterprise',
    referenceId: deletedOrganizationId,
    status: 'active',
    seats: 1,
    stripeSubscriptionId: customer.stripeSubscriptionId,
    stripeCustomerId: customer.stripeCustomerId,
    cancelAtPeriodEnd: false,
    metadata: stripe.subscription(customer.stripeSubscriptionId).metadata,
  })
  return { ...customer, deletedOrganizationId, subscriptionId }
}

async function renew(stripeSubscriptionId: string) {
  stripe.updateOutsideSim(stripeSubscriptionId, { metadata: { renewedAt: generateId() } })
  return deliver(stripe.events.at(-1) as Stripe.Event)
}

async function storedSubscription(subscriptionId: string) {
  const [row] = await testDatabase
    .select({
      referenceId: subscription.referenceId,
      plan: subscription.plan,
      periodEnd: subscription.periodEnd,
    })
    .from(subscription)
    .where(eq(subscription.id, subscriptionId))
  if (!row) throw new Error(`Subscription ${subscriptionId} not found`)
  return row
}

async function organizationsOwnedBy(referenceId: string) {
  return testDatabase
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, referenceId))
}

describe('Enterprise subscription whose organization was deleted', () => {
  it('acknowledges a renewal and still mirrors the Stripe period onto the row', async () => {
    const orphan = await createSubscriptionForDeletedOrganization()

    const response = await renew(orphan.stripeSubscriptionId)

    expect(response.status).toBe(200)
    const currentPeriodEnd = stripe.subscription(orphan.stripeSubscriptionId).items.data[0]
      .current_period_end
    expect((await storedSubscription(orphan.subscriptionId)).periodEnd).toEqual(
      new Date(currentPeriodEnd * 1000)
    )
  })

  it('does not create an organization for the dangling reference on renewal', async () => {
    const orphan = await createSubscriptionForDeletedOrganization()

    await renew(orphan.stripeSubscriptionId)

    expect(await organizationsOwnedBy(orphan.deletedOrganizationId)).toEqual([])
    expect(await storedSubscription(orphan.subscriptionId)).toMatchObject({
      referenceId: orphan.deletedOrganizationId,
      plan: 'enterprise',
    })
  })

  it('acknowledges a dashboard-created subscription and records nothing for it', async () => {
    const missingOrganizationId = `org_${generateId()}`
    const customer = await createEnterpriseCustomer(missingOrganizationId)

    const response = await deliver(
      createMockStripeEvent(
        'customer.subscription.created',
        stripe.subscription(customer.stripeSubscriptionId),
        { id: `evt_${generateId()}` }
      )
    )

    expect(response.status).toBe(200)
    expect(
      await testDatabase
        .select({ id: subscription.id })
        .from(subscription)
        .where(eq(subscription.stripeSubscriptionId, customer.stripeSubscriptionId))
    ).toEqual([])
    expect(
      await testDatabase
        .select({ id: organization.id })
        .from(organization)
        .where(eq(organization.id, missingOrganizationId))
    ).toEqual([])
  })
})

describe('Enterprise issuance that Stripe has not caught up with', () => {
  it('still fails the webhook so Stripe redelivers it', async () => {
    const organizationId = `org_${generateId()}`
    await testDatabase
      .insert(organization)
      .values({ id: organizationId, name: 'Org', slug: organizationId })
    const operationId = generateId()
    await testDatabase.insert(outboxEvent).values({
      id: operationId,
      eventType: ENTERPRISE_PROVISION_EVENT_TYPE,
      payload: { version: 2 },
    })
    const customer = await createEnterpriseCustomer(organizationId, {
      enterpriseOperationId: operationId,
    })

    const response = await deliver(
      createMockStripeEvent(
        'customer.subscription.created',
        stripe.subscription(customer.stripeSubscriptionId),
        { id: `evt_${generateId()}` }
      )
    )

    expect(response.ok).toBe(false)
    expect(
      await testDatabase
        .select({ id: subscription.id })
        .from(subscription)
        .where(eq(subscription.stripeSubscriptionId, customer.stripeSubscriptionId))
    ).toEqual([])
  })
})
