import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { member, organization, outboxEvent, subscription, user } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type Stripe from 'stripe'
import { parseBillingConcurrencyLimit } from '@/lib/billing/concurrency-defaults'
import { getBillingConcurrencyLimit } from '@/lib/billing/concurrency-limits'
import { dollarsToCredits } from '@/lib/billing/credits/conversion'
import {
  deriveEnterpriseOperationStatus,
  ENTERPRISE_METADATA_SYNC_EVENT_TYPE,
  ENTERPRISE_PROVISION_EVENT_TYPE,
  type EnterpriseOperationStatus,
  type EnterpriseProvisionPayload,
  type EnterpriseProvisionRequest,
  enterpriseMetadataSyncPayloadSchema,
  enterpriseProvisionPayloadSchema,
  parseEnterpriseProvisionPayload,
} from '@/lib/billing/enterprise-outbox'
import { acquireUserBillingIdentityLock } from '@/lib/billing/organizations/billing-identity-lock'
import { acquireOrganizationMutationLock } from '@/lib/billing/organizations/membership'
import { requireStripeClient } from '@/lib/billing/stripe-client'
import { withEnterpriseReconciliationLease } from '@/lib/billing/webhooks/enterprise-reconciliation-lease'
import { enqueueOutboxEvent, type OutboxHandler } from '@/lib/core/outbox/service'

const TERMINAL_SUBSCRIPTION_STATUSES = new Set(['canceled', 'incomplete_expired'])

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function isNonterminalSubscriptionStatus(status: string | null | undefined): boolean {
  return !status || !TERMINAL_SUBSCRIPTION_STATUSES.has(status)
}

function subscriptionOrganizationId(metadata: unknown): string | null {
  const record = metadataRecord(metadata)
  const value = record.referenceId ?? record.organizationId
  return typeof value === 'string' && value.length > 0 ? value : null
}

function subscriptionOperationId(metadata: unknown): string | null {
  const value = metadataRecord(metadata).enterpriseOperationId
  return typeof value === 'string' && value.length > 0 ? value : null
}

async function inspectLocalOrganizationSubscriptions(params: {
  organizationId: string
  operationId: string
  expectedStripeSubscriptionId: string | null
}): Promise<string | null> {
  const rows = await db
    .select({
      status: subscription.status,
      stripeSubscriptionId: subscription.stripeSubscriptionId,
      metadata: subscription.metadata,
    })
    .from(subscription)
    .where(eq(subscription.referenceId, params.organizationId))

  let recoveredStripeSubscriptionId: string | null = null
  for (const row of rows) {
    const belongsToOperation = subscriptionOperationId(row.metadata) === params.operationId
    const isExpected =
      Boolean(params.expectedStripeSubscriptionId) &&
      row.stripeSubscriptionId === params.expectedStripeSubscriptionId

    if (belongsToOperation || isExpected) {
      if (
        row.stripeSubscriptionId &&
        recoveredStripeSubscriptionId &&
        recoveredStripeSubscriptionId !== row.stripeSubscriptionId
      ) {
        throw new Error('Multiple Stripe subscriptions exist for this Enterprise operation')
      }
      recoveredStripeSubscriptionId = row.stripeSubscriptionId ?? recoveredStripeSubscriptionId
      continue
    }

    if (isNonterminalSubscriptionStatus(row.status)) {
      throw new Error('Organization already has a different nonterminal subscription')
    }
  }
  return recoveredStripeSubscriptionId
}

async function inspectStripeOrganizationSubscriptions(params: {
  stripe: Stripe
  customerId: string
  organizationId: string
  operationId: string
  expectedStripeSubscriptionId: string | null
}): Promise<Stripe.Subscription | null> {
  let matching: Stripe.Subscription | null = null
  let startingAfter: string | undefined

  for (;;) {
    const page = await params.stripe.subscriptions.list({
      customer: params.customerId,
      status: 'all',
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    })
    for (const candidate of page.data) {
      const belongsToOperation = candidate.metadata?.enterpriseOperationId === params.operationId
      const isExpected = candidate.id === params.expectedStripeSubscriptionId
      if (belongsToOperation || isExpected) {
        if (matching && matching.id !== candidate.id) {
          throw new Error('Multiple Stripe subscriptions exist for this Enterprise operation')
        }
        matching = candidate
        continue
      }
      if (
        subscriptionOrganizationId(candidate.metadata) === params.organizationId &&
        isNonterminalSubscriptionStatus(candidate.status)
      ) {
        throw new Error('Organization already has a different nonterminal Stripe subscription')
      }
    }
    if (!page.has_more) break
    startingAfter = page.data.at(-1)?.id
    if (!startingAfter) break
  }

  if (params.expectedStripeSubscriptionId && !matching) {
    throw new Error('Recorded Stripe subscription could not be recovered')
  }
  return matching
}

async function findOperationCustomer(
  stripe: Stripe,
  email: string,
  operationId: string
): Promise<Stripe.Customer | null> {
  let match: Stripe.Customer | null = null
  let startingAfter: string | undefined
  for (;;) {
    const page = await stripe.customers.list({
      email,
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    })
    for (const candidate of page.data) {
      if (candidate.metadata?.enterpriseOperationId !== operationId) continue
      if (match && match.id !== candidate.id) {
        throw new Error('Multiple Stripe customers exist for this Enterprise operation')
      }
      match = candidate
    }
    if (!page.has_more) break
    startingAfter = page.data.at(-1)?.id
    if (!startingAfter) break
  }
  return match
}

async function findOperationPrice(
  stripe: Stripe,
  productId: string,
  operationId: string
): Promise<Stripe.Price | null> {
  let match: Stripe.Price | null = null
  let startingAfter: string | undefined
  for (;;) {
    const page = await stripe.prices.list({
      product: productId,
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    })
    for (const candidate of page.data) {
      if (candidate.metadata?.enterpriseOperationId !== operationId) continue
      if (match && match.id !== candidate.id) {
        throw new Error('Multiple Stripe prices exist for this Enterprise operation')
      }
      match = candidate
    }
    if (!page.has_more) break
    startingAfter = page.data.at(-1)?.id
    if (!startingAfter) break
  }
  return match
}

function isStripeMissingResource(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: unknown }).code === 'resource_missing'
  )
}

async function retrieveOperationProduct(
  stripe: Stripe,
  operationId: string
): Promise<Stripe.Product | null> {
  const productId = `prod_sim_enterprise_${operationId.replace(/[^a-zA-Z0-9]/g, '')}`
  try {
    const product = await stripe.products.retrieve(productId, { expand: ['default_price'] })
    if (product.metadata?.enterpriseOperationId !== operationId) {
      throw new Error('Recovered Stripe product belongs to a different Enterprise operation')
    }
    return product
  } catch (error) {
    if (isStripeMissingResource(error)) return null
    throw error
  }
}

function assertEnterprisePrice(
  price: Stripe.Price,
  request: EnterpriseProvisionRequest,
  operationId: string,
  expectedProductId: string
): void {
  const productId = typeof price.product === 'string' ? price.product : price.product?.id
  if (
    price.currency !== 'usd' ||
    price.unit_amount !== request.invoiceAmountCents ||
    price.recurring?.interval !== 'month' ||
    (price.recurring.interval_count ?? 1) !== 1 ||
    price.metadata?.enterpriseOperationId !== operationId ||
    productId !== expectedProductId
  ) {
    throw new Error('Recovered Stripe price does not match the Enterprise request')
  }
}

export interface IssueEnterpriseProvisioningInput {
  ownerUserId: string
  organizationName?: string
  monthlyInvoiceAmountUsd: number
  usageLimitCredits?: number
  seats: number
  concurrencyLimit?: number
  pausePaymentCollection?: boolean
  requestedByEmail: string
  requestedByUserId: string | null
}

export interface EnterpriseProvisioningView {
  id: string
  ownerUserId: string
  organizationId: string
  status: EnterpriseOperationStatus
  monthlyInvoiceAmountUsd: number
  usageLimitCredits: number
  seats: number
  concurrencyLimit: number
  pausePaymentCollection: boolean
  stripeSubscriptionId: string | null
  error: string | null
  createdAt: string
  updatedAt: string
}

export class EnterpriseProvisioningError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EnterpriseProvisioningError'
  }
}

function slugifyOrganizationName(name: string, organizationId: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
  return `${base || 'organization'}-${organizationId.slice(-8)}`
}

/** Builds a deterministic key from every Enterprise commercial term. */
export function buildEnterpriseProvisioningRequestKey(
  input: IssueEnterpriseProvisioningInput,
  organizationId: string
): string {
  const usageLimitCredits =
    input.usageLimitCredits ?? dollarsToCredits(input.monthlyInvoiceAmountUsd)
  const requestTerms: Array<string | number> = [
    'enterprise-v3',
    input.ownerUserId,
    organizationId,
    Math.round(input.monthlyInvoiceAmountUsd * 100),
    usageLimitCredits,
    input.seats,
  ]
  if (input.concurrencyLimit !== undefined) requestTerms.push(input.concurrencyLimit)
  if (input.pausePaymentCollection) requestTerms.push('draft-collection')
  return requestTerms.join(':')
}

function toEnterpriseProvisioningView(
  row: typeof outboxEvent.$inferSelect,
  payload: EnterpriseProvisionPayload
): EnterpriseProvisioningView {
  const request = payload.request
  const updatedAt = row.processedAt ?? row.lockedAt ?? row.availableAt ?? row.createdAt
  return {
    id: row.id,
    ownerUserId: request.ownerUserId,
    organizationId: request.organizationId,
    status: deriveEnterpriseOperationStatus(row.status, payload),
    monthlyInvoiceAmountUsd: request.invoiceAmountCents / 100,
    usageLimitCredits: request.usageLimitCredits,
    seats: request.seats,
    concurrencyLimit: getBillingConcurrencyLimit('enterprise', request.concurrencyLimit),
    pausePaymentCollection: request.pausePaymentCollection,
    stripeSubscriptionId:
      payload.applicationResult?.subscriptionId ?? payload.stripeProgress.subscriptionId ?? null,
    error: row.lastError,
    createdAt: row.createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
  }
}

async function getEnterpriseProvisioningById(
  operationId: string
): Promise<EnterpriseProvisioningView | null> {
  const [row] = await db
    .select()
    .from(outboxEvent)
    .where(
      and(
        eq(outboxEvent.id, operationId),
        eq(outboxEvent.eventType, ENTERPRISE_PROVISION_EVENT_TYPE)
      )
    )
    .limit(1)
  if (!row) return null
  const payload = parseEnterpriseProvisionPayload(row.payload)
  return payload ? toEnterpriseProvisioningView(row, payload) : null
}

type EnterpriseSubscriptionState = Pick<
  typeof subscription.$inferSelect,
  'status' | 'stripeSubscriptionId' | 'metadata'
>

function operationHasTerminalAppliedSubscription(
  payload: EnterpriseProvisionPayload,
  subscriptions: EnterpriseSubscriptionState[]
): boolean {
  if (!payload.applicationResult) return false
  const applied = subscriptions.find(
    (row) => row.stripeSubscriptionId === payload.applicationResult?.subscriptionId
  )
  return Boolean(applied && !isNonterminalSubscriptionStatus(applied.status))
}

export type EnterpriseIssueDecision = { kind: 'create' } | { kind: 'reuse'; operationId: string }

/** Pure serialization decision used after the caller locks the organization. */
export function decideEnterpriseProvisioningIssue(
  requestKey: string,
  operationRows: Array<{ id: string; payload: unknown }>,
  subscriptionRows: EnterpriseSubscriptionState[]
): EnterpriseIssueDecision {
  for (const row of operationRows) {
    const payload = parseEnterpriseProvisionPayload(row.payload)
    if (!payload) {
      throw new EnterpriseProvisioningError(
        `Existing Enterprise issuance operation ${row.id} has an invalid payload`
      )
    }
    const terminalApplied = operationHasTerminalAppliedSubscription(payload, subscriptionRows)
    if (terminalApplied) continue
    if (payload.request.requestKey === requestKey) {
      return { kind: 'reuse', operationId: row.id }
    }
    throw new EnterpriseProvisioningError(
      payload.applicationResult
        ? 'Organization already has a different nonterminal Enterprise subscription'
        : 'Organization already has unfinished Enterprise issuance; retry that operation first'
    )
  }

  const unrelatedNonterminal = subscriptionRows.find((row) =>
    isNonterminalSubscriptionStatus(row.status)
  )
  if (unrelatedNonterminal) {
    throw new EnterpriseProvisioningError(
      'Organization already has a different nonterminal subscription'
    )
  }

  return { kind: 'create' }
}

export type EnterpriseRetryDecision =
  | { shouldRetry: false; operationId: string }
  | { shouldRetry: true; operationId: string; retryRevision: number }

export function decideEnterpriseProvisioningRetry(
  operationId: string,
  outboxStatus: string,
  payload: EnterpriseProvisionPayload
): EnterpriseRetryDecision {
  const status = deriveEnterpriseOperationStatus(outboxStatus, payload)
  if (status === 'dead_letter' || status === 'awaiting_webhook') {
    return { shouldRetry: true, operationId, retryRevision: payload.retryRevision + 1 }
  }
  return { shouldRetry: false, operationId }
}

export async function issueEnterpriseProvisioning(
  input: IssueEnterpriseProvisioningInput
): Promise<EnterpriseProvisioningView> {
  const invoiceAmountCents = Math.round(input.monthlyInvoiceAmountUsd * 100)
  if (
    invoiceAmountCents <= 0 ||
    !Number.isSafeInteger(invoiceAmountCents) ||
    Math.abs(input.monthlyInvoiceAmountUsd * 100 - invoiceAmountCents) > 1e-8
  ) {
    throw new EnterpriseProvisioningError(
      'Monthly invoice amount must be at least $0.01 and use whole cents'
    )
  }
  const defaultUsageLimitCredits = dollarsToCredits(input.monthlyInvoiceAmountUsd)
  if (
    input.concurrencyLimit !== undefined &&
    parseBillingConcurrencyLimit(input.concurrencyLimit) !== input.concurrencyLimit
  ) {
    throw new EnterpriseProvisioningError('Concurrency limit is invalid')
  }
  const result = await db.transaction(async (tx) => {
    const [owner] = await tx
      .select({ id: user.id, name: user.name, email: user.email })
      .from(user)
      .where(eq(user.id, input.ownerUserId))
      .for('update')
      .limit(1)
    if (!owner) throw new EnterpriseProvisioningError('Owner user not found')

    const [membership] = await tx
      .select({ role: member.role, organizationId: member.organizationId })
      .from(member)
      .where(eq(member.userId, input.ownerUserId))
      .limit(1)

    let organizationId: string
    if (membership) {
      if (membership.role !== 'owner') {
        throw new EnterpriseProvisioningError(
          'The selected user is a member, but not the owner, of an organization'
        )
      }
      organizationId = membership.organizationId
      await acquireOrganizationMutationLock(tx, organizationId)
      await acquireUserBillingIdentityLock(tx, input.ownerUserId)
      const [currentMembership] = await tx
        .select({ role: member.role, organizationId: member.organizationId })
        .from(member)
        .where(eq(member.userId, input.ownerUserId))
        .limit(1)
      if (
        currentMembership?.organizationId !== organizationId ||
        currentMembership.role !== 'owner'
      ) {
        throw new EnterpriseProvisioningError('The selected user no longer owns this organization')
      }
    } else {
      await acquireUserBillingIdentityLock(tx, input.ownerUserId)
      const [currentMembership] = await tx
        .select({ organizationId: member.organizationId })
        .from(member)
        .where(eq(member.userId, input.ownerUserId))
        .limit(1)
      if (currentMembership) {
        throw new EnterpriseProvisioningError(
          'The selected user joined an organization while issuance was starting; retry the request'
        )
      }
      if (!input.organizationName) {
        throw new EnterpriseProvisioningError(
          'Organization name is required when the owner has no organization'
        )
      }
      organizationId = `org_${generateId()}`
      const now = new Date()
      await tx.insert(organization).values({
        id: organizationId,
        name: input.organizationName,
        slug: slugifyOrganizationName(input.organizationName, organizationId),
        createdAt: now,
        updatedAt: now,
      })
      await tx.insert(member).values({
        id: generateId(),
        userId: input.ownerUserId,
        organizationId,
        role: 'owner',
        createdAt: now,
      })
    }

    await acquireOrganizationMutationLock(tx, organizationId)
    const requestKey = buildEnterpriseProvisioningRequestKey(input, organizationId)
    const [lockedOwner] = await tx
      .select({ role: member.role })
      .from(member)
      .where(and(eq(member.organizationId, organizationId), eq(member.userId, input.ownerUserId)))
      .limit(1)
    if (lockedOwner?.role !== 'owner') {
      throw new EnterpriseProvisioningError('The selected user no longer owns this organization')
    }

    const [memberCount] = await tx
      .select({ value: count() })
      .from(member)
      .where(eq(member.organizationId, organizationId))
    if (input.seats < (memberCount?.value ?? 0)) {
      throw new EnterpriseProvisioningError(
        'Enterprise seat capacity cannot be below current internal membership'
      )
    }

    const operationRows = await tx
      .select()
      .from(outboxEvent)
      .where(
        and(
          eq(outboxEvent.eventType, ENTERPRISE_PROVISION_EVENT_TYPE),
          sql`${outboxEvent.payload} #>> '{request,organizationId}' = ${organizationId}`
        )
      )
      .orderBy(desc(outboxEvent.createdAt), desc(outboxEvent.id))
      .for('update')
    const subscriptionRows = await tx
      .select()
      .from(subscription)
      .where(eq(subscription.referenceId, organizationId))

    const decision = decideEnterpriseProvisioningIssue(requestKey, operationRows, subscriptionRows)
    if (decision.kind === 'reuse') {
      return { operationId: decision.operationId, created: false as const }
    }

    const request: EnterpriseProvisionRequest = {
      requestKey,
      ownerUserId: input.ownerUserId,
      organizationId,
      requestedByEmail: input.requestedByEmail,
      requestedByUserId: input.requestedByUserId,
      invoiceAmountCents,
      usageLimitCredits: input.usageLimitCredits ?? defaultUsageLimitCredits,
      seats: input.seats,
      ...(input.concurrencyLimit !== undefined ? { concurrencyLimit: input.concurrencyLimit } : {}),
      pausePaymentCollection: input.pausePaymentCollection ?? false,
    }
    const payload: EnterpriseProvisionPayload = {
      version: 1,
      request,
      retryRevision: 0,
      stripeProgress: {},
    }
    const operationId = await enqueueOutboxEvent(tx, ENTERPRISE_PROVISION_EVENT_TYPE, payload)
    return { operationId, created: true as const }
  })

  const view = await getEnterpriseProvisioningById(result.operationId)
  if (!view) throw new Error('Enterprise issuance operation was not persisted')
  if (result.created) {
    recordAudit({
      actorId: input.requestedByUserId,
      actorName: 'Admin Panel',
      actorEmail: input.requestedByEmail === 'admin-api' ? null : input.requestedByEmail,
      action: AuditAction.ENTERPRISE_SUBSCRIPTION_PROVISIONED,
      resourceType: AuditResourceType.SUBSCRIPTION,
      resourceId: view.id,
      description: `Admin requested Enterprise issuance for organization ${view.organizationId}`,
      metadata: {
        organizationId: view.organizationId,
        invoiceAmountCents: Math.round(view.monthlyInvoiceAmountUsd * 100),
        usageLimitCredits: view.usageLimitCredits,
        seats: view.seats,
        concurrencyLimit: view.concurrencyLimit,
        pausePaymentCollection: view.pausePaymentCollection,
        status: view.status,
      },
    })
  }
  return view
}

export async function retryEnterpriseProvisioning(
  operationId: string,
  actor: { id: string | null; name: string; email: string | null }
): Promise<EnterpriseProvisioningView> {
  const [snapshot] = await db
    .select({ payload: outboxEvent.payload })
    .from(outboxEvent)
    .where(
      and(
        eq(outboxEvent.id, operationId),
        eq(outboxEvent.eventType, ENTERPRISE_PROVISION_EVENT_TYPE)
      )
    )
    .limit(1)
  const snapshotPayload = snapshot && parseEnterpriseProvisionPayload(snapshot.payload)
  if (!snapshotPayload) throw new EnterpriseProvisioningError('Enterprise operation not found')

  const result = await db.transaction(async (tx) => {
    await acquireOrganizationMutationLock(tx, snapshotPayload.request.organizationId)
    const [row] = await tx
      .select()
      .from(outboxEvent)
      .where(
        and(
          eq(outboxEvent.id, operationId),
          eq(outboxEvent.eventType, ENTERPRISE_PROVISION_EVENT_TYPE)
        )
      )
      .for('update')
      .limit(1)
    const payload = row && parseEnterpriseProvisionPayload(row.payload)
    if (!row || !payload) throw new EnterpriseProvisioningError('Enterprise operation not found')

    const localSubscriptions = await tx
      .select()
      .from(subscription)
      .where(eq(subscription.referenceId, payload.request.organizationId))
    const conflicting = localSubscriptions.find(
      (candidate) =>
        subscriptionOperationId(candidate.metadata) !== operationId &&
        isNonterminalSubscriptionStatus(candidate.status)
    )
    if (conflicting) {
      throw new EnterpriseProvisioningError(
        'Organization now has a different nonterminal subscription; issuance cannot be retried'
      )
    }

    const decision = decideEnterpriseProvisioningRetry(operationId, row.status, payload)
    if (!decision.shouldRetry) return false

    await tx
      .update(outboxEvent)
      .set({
        status: 'pending',
        attempts: 0,
        lastError: null,
        availableAt: new Date(),
        lockedAt: null,
        processedAt: null,
        payload: sql`(${outboxEvent.payload}::jsonb || ${JSON.stringify({ retryRevision: decision.retryRevision })}::jsonb)::json`,
      })
      .where(eq(outboxEvent.id, decision.operationId))
    return true
  })

  const view = await getEnterpriseProvisioningById(operationId)
  if (!view) throw new EnterpriseProvisioningError('Enterprise operation not found')
  if (result) {
    recordAudit({
      actorId: actor.id,
      actorName: actor.name,
      actorEmail: actor.email,
      action: AuditAction.ENTERPRISE_SUBSCRIPTION_PROVISIONED,
      resourceType: AuditResourceType.SUBSCRIPTION,
      resourceId: operationId,
      description: 'Admin retried Enterprise issuance',
      metadata: { organizationId: view.organizationId, status: view.status },
    })
  }
  return view
}

async function resolveCanonicalCustomer(params: {
  stripe: Stripe
  operationId: string
  payload: EnterpriseProvisionPayload
  owner: { id: string; name: string; email: string; stripeCustomerId: string | null }
}): Promise<string> {
  if (params.owner.stripeCustomerId) return params.owner.stripeCustomerId

  let candidateId = params.payload.stripeProgress.customerId ?? null
  if (!candidateId) {
    candidateId =
      (await findOperationCustomer(params.stripe, params.owner.email, params.operationId))?.id ??
      null
  }
  if (!candidateId) {
    const customer = await params.stripe.customers.create(
      {
        email: params.owner.email,
        name: params.owner.name,
        metadata: {
          enterpriseOperationId: params.operationId,
          ownerUserId: params.owner.id,
        },
      },
      { idempotencyKey: `enterprise:${params.operationId}:customer` }
    )
    candidateId = customer.id
  }

  const attached = await db
    .update(user)
    .set({ stripeCustomerId: candidateId, updatedAt: new Date() })
    .where(and(eq(user.id, params.owner.id), isNull(user.stripeCustomerId)))
    .returning({ stripeCustomerId: user.stripeCustomerId })
  if (attached[0]?.stripeCustomerId) return attached[0].stripeCustomerId

  const [current] = await db
    .select({ stripeCustomerId: user.stripeCustomerId })
    .from(user)
    .where(eq(user.id, params.owner.id))
    .limit(1)
  if (!current?.stripeCustomerId) throw new Error('Unable to establish canonical Stripe customer')
  return current.stripeCustomerId
}

/**
 * The subscription create call also creates its first invoice. Freeze that
 * invoice before pausing collection so it cannot auto-finalize in the small
 * interval between the two Stripe operations.
 */
async function keepInitialEnterpriseInvoiceAsDraft(params: {
  stripe: Stripe
  subscription: Stripe.Subscription
  operationId: string
}): Promise<void> {
  const latestInvoice = params.subscription.latest_invoice
  if (!latestInvoice) {
    throw new Error('Paused Enterprise subscription did not expose its initial invoice')
  }
  const invoiceId = typeof latestInvoice === 'string' ? latestInvoice : latestInvoice.id
  if (!invoiceId) {
    throw new Error('Paused Enterprise subscription initial invoice has no ID')
  }

  const invoice =
    typeof latestInvoice === 'string'
      ? await params.stripe.invoices.retrieve(invoiceId)
      : latestInvoice
  if (invoice.status !== 'draft') {
    throw new Error(
      `Paused Enterprise initial invoice ${invoiceId} is already ${invoice.status ?? 'in an unknown state'}`
    )
  }
  if (invoice.auto_advance === false) return

  await params.stripe.invoices.update(
    invoiceId,
    { auto_advance: false },
    { idempotencyKey: `enterprise:${params.operationId}:initial-invoice-draft` }
  )
}

export const provisionEnterpriseInStripe: OutboxHandler<unknown> = async (rawPayload, context) => {
  const parsed = enterpriseProvisionPayloadSchema.safeParse(rawPayload)
  if (!parsed.success) throw new Error('Invalid Enterprise issuance outbox payload')
  let payload = parsed.data
  if (payload.applicationResult) return
  const request = payload.request

  const [record] = await db
    .select({
      ownerId: user.id,
      ownerName: user.name,
      ownerEmail: user.email,
      ownerStripeCustomerId: user.stripeCustomerId,
      organizationName: organization.name,
      ownerRole: member.role,
    })
    .from(user)
    .innerJoin(organization, eq(organization.id, request.organizationId))
    .leftJoin(
      member,
      and(eq(member.organizationId, request.organizationId), eq(member.userId, request.ownerUserId))
    )
    .where(eq(user.id, request.ownerUserId))
    .limit(1)
  if (!record) throw new Error('Enterprise issuance owner or organization no longer exists')
  if (record.ownerRole !== 'owner')
    throw new Error('Issuance owner no longer owns the organization')

  const [memberCount] = await db
    .select({ value: count() })
    .from(member)
    .where(eq(member.organizationId, request.organizationId))
  if (request.seats < (memberCount?.value ?? 0)) {
    throw new Error('Enterprise seat capacity is below current internal membership')
  }

  const stripe = requireStripeClient()
  const customerId = await resolveCanonicalCustomer({
    stripe,
    operationId: context.eventId,
    payload,
    owner: {
      id: record.ownerId,
      name: record.ownerName,
      email: record.ownerEmail,
      stripeCustomerId: record.ownerStripeCustomerId,
    },
  })
  if (payload.stripeProgress.customerId !== customerId) {
    const stripeProgress = { ...payload.stripeProgress, customerId }
    await context.checkpointPayload({ stripeProgress })
    payload = { ...payload, stripeProgress }
  }

  const locallyRecoveredSubscriptionId = await inspectLocalOrganizationSubscriptions({
    organizationId: request.organizationId,
    operationId: context.eventId,
    expectedStripeSubscriptionId: payload.stripeProgress.subscriptionId ?? null,
  })
  const expectedSubscriptionId =
    payload.stripeProgress.subscriptionId ?? locallyRecoveredSubscriptionId

  const metadata = {
    plan: 'enterprise',
    referenceId: request.organizationId,
    organizationId: request.organizationId,
    enterpriseOperationId: context.eventId,
    invoiceAmountCents: request.invoiceAmountCents.toString(),
    monthlyPrice: (request.invoiceAmountCents / 100).toFixed(2),
    usageLimitCredits: request.usageLimitCredits.toString(),
    seats: request.seats.toString(),
    ...(request.concurrencyLimit !== undefined
      ? { concurrencyLimit: request.concurrencyLimit.toString() }
      : {}),
  }

  // Recover the subscription before creating supporting catalog objects. This
  // handles a prior successful create whose final outbox checkpoint was lost.
  let stripeSubscription = await inspectStripeOrganizationSubscriptions({
    stripe,
    customerId,
    organizationId: request.organizationId,
    operationId: context.eventId,
    expectedStripeSubscriptionId: expectedSubscriptionId,
  })

  let createdSubscription = false
  if (!stripeSubscription) {
    let productId = payload.stripeProgress.productId ?? null
    let priceId = payload.stripeProgress.priceId ?? null
    if (productId) {
      const checkpointedProduct = await stripe.products.retrieve(productId, {
        expand: ['default_price'],
      })
      if (checkpointedProduct.metadata?.enterpriseOperationId !== context.eventId) {
        throw new Error('Checkpointed Stripe product belongs to a different Enterprise operation')
      }
      priceId ??=
        typeof checkpointedProduct.default_price === 'string'
          ? checkpointedProduct.default_price
          : (checkpointedProduct.default_price?.id ?? null)
    } else {
      const recoveredProduct = await retrieveOperationProduct(stripe, context.eventId)
      productId = recoveredProduct?.id ?? null
      priceId =
        typeof recoveredProduct?.default_price === 'string'
          ? recoveredProduct.default_price
          : (recoveredProduct?.default_price?.id ?? priceId)
    }
    if (productId && !priceId) {
      priceId = (await findOperationPrice(stripe, productId, context.eventId))?.id ?? null
    }
    if (!productId) {
      const product = await stripe.products.create(
        {
          id: `prod_sim_enterprise_${context.eventId.replace(/[^a-zA-Z0-9]/g, '')}`,
          name: `${record.organizationName} Enterprise`,
          metadata: { enterpriseOperationId: context.eventId },
          default_price_data: {
            currency: 'usd',
            unit_amount: request.invoiceAmountCents,
            recurring: { interval: 'month' },
            metadata: { enterpriseOperationId: context.eventId },
          },
          expand: ['default_price'],
        },
        { idempotencyKey: `enterprise:${context.eventId}:product` }
      )
      productId = product.id
      priceId =
        typeof product.default_price === 'string'
          ? product.default_price
          : (product.default_price?.id ?? null)
    }
    if (!priceId) {
      priceId = (await findOperationPrice(stripe, productId, context.eventId))?.id ?? null
    }
    if (!priceId) throw new Error('Unable to recover Enterprise recurring price')
    const price = await stripe.prices.retrieve(priceId)
    assertEnterprisePrice(price, request, context.eventId, productId)

    const stripeProgress = {
      ...payload.stripeProgress,
      customerId,
      productId,
      priceId,
    }
    await context.checkpointPayload({ stripeProgress })
    payload = { ...payload, stripeProgress }

    // A different process may have created a subscription while catalog
    // recovery was running. Re-scan immediately before the create call.
    stripeSubscription = await inspectStripeOrganizationSubscriptions({
      stripe,
      customerId,
      organizationId: request.organizationId,
      operationId: context.eventId,
      expectedStripeSubscriptionId: expectedSubscriptionId,
    })
  }

  if (!stripeSubscription) {
    const priceId = payload.stripeProgress.priceId
    if (!priceId) throw new Error('Enterprise recurring price was not checkpointed')

    // Canonical Sim-side entitlement conversions are fenced by the unresolved
    // outbox intent. Re-read local state and capacity at the final external
    // side-effect boundary as defense in depth against a checkout/webhook that
    // was already in flight before the intent was committed.
    const finalLocalSubscriptionId = await inspectLocalOrganizationSubscriptions({
      organizationId: request.organizationId,
      operationId: context.eventId,
      expectedStripeSubscriptionId: expectedSubscriptionId,
    })
    if (finalLocalSubscriptionId) {
      stripeSubscription = await inspectStripeOrganizationSubscriptions({
        stripe,
        customerId,
        organizationId: request.organizationId,
        operationId: context.eventId,
        expectedStripeSubscriptionId: finalLocalSubscriptionId,
      })
    }

    const [finalMemberCount] = await db
      .select({ value: count() })
      .from(member)
      .where(eq(member.organizationId, request.organizationId))
    if (request.seats < (finalMemberCount?.value ?? 0)) {
      throw new Error('Enterprise seat capacity is below current internal membership')
    }
  }

  if (!stripeSubscription) {
    const priceId = payload.stripeProgress.priceId
    if (!priceId) throw new Error('Enterprise recurring price was not checkpointed')
    stripeSubscription = await stripe.subscriptions.create(
      {
        customer: customerId,
        items: [{ price: priceId, quantity: 1 }],
        collection_method: 'send_invoice',
        days_until_due: 30,
        metadata,
      },
      { idempotencyKey: `enterprise:${context.eventId}:subscription` }
    )
    createdSubscription = true
  }

  if (request.pausePaymentCollection) {
    await keepInitialEnterpriseInvoiceAsDraft({
      stripe,
      subscription: stripeSubscription,
      operationId: context.eventId,
    })
  }

  if (!createdSubscription || request.pausePaymentCollection) {
    stripeSubscription = await stripe.subscriptions.update(
      stripeSubscription.id,
      {
        metadata: {
          ...metadata,
          enterpriseRetryRevision: payload.retryRevision.toString(),
        },
        pause_collection: request.pausePaymentCollection ? { behavior: 'keep_as_draft' } : '',
      },
      {
        idempotencyKey: createdSubscription
          ? `enterprise:${context.eventId}:pause-collection`
          : `enterprise:${context.eventId}:retry:${payload.retryRevision}`,
      }
    )
  }

  if (payload.stripeProgress.subscriptionId !== stripeSubscription.id) {
    const stripeProgress = {
      ...payload.stripeProgress,
      customerId,
      subscriptionId: stripeSubscription.id,
    }
    await context.checkpointPayload({ stripeProgress })
  }
}

export const syncEnterpriseMetadataInStripe: OutboxHandler<unknown> = async (
  rawPayload,
  context
) => {
  const parsed = enterpriseMetadataSyncPayloadSchema.safeParse(rawPayload)
  if (!parsed.success) throw new Error('Invalid Enterprise metadata-sync outbox payload')
  const payload = parsed.data

  const [subscriptionRow] = await db
    .select({
      stripeSubscriptionId: subscription.stripeSubscriptionId,
      referenceId: subscription.referenceId,
      metadata: subscription.metadata,
    })
    .from(subscription)
    .where(eq(subscription.id, payload.subscriptionId))
    .limit(1)
  if (!subscriptionRow?.stripeSubscriptionId) return
  const stripeSubscriptionId = subscriptionRow.stripeSubscriptionId
  if (metadataRecord(subscriptionRow.metadata).simConfigOperationId === context.eventId) return

  await withEnterpriseReconciliationLease(stripeSubscriptionId, async () => {
    const [currentSubscription] = await db
      .select({ metadata: subscription.metadata })
      .from(subscription)
      .where(eq(subscription.id, payload.subscriptionId))
      .limit(1)
    if (metadataRecord(currentSubscription?.metadata).simConfigOperationId === context.eventId) {
      return
    }

    const [latest] = await db
      .select({ id: outboxEvent.id, payload: outboxEvent.payload })
      .from(outboxEvent)
      .where(
        and(
          eq(outboxEvent.eventType, ENTERPRISE_METADATA_SYNC_EVENT_TYPE),
          sql`${outboxEvent.payload} ->> 'subscriptionId' = ${payload.subscriptionId}`
        )
      )
      .orderBy(
        desc(sql`coalesce((${outboxEvent.payload} ->> 'revision')::bigint, 0)`),
        desc(outboxEvent.createdAt),
        desc(outboxEvent.id)
      )
      .limit(1)
    if (!latest || latest.id !== context.eventId) return

    const latestPayload = enterpriseMetadataSyncPayloadSchema.safeParse(latest.payload)
    if (!latestPayload.success) throw new Error('Latest Enterprise metadata intent is invalid')
    const [currentMembers] = await db
      .select({ value: count() })
      .from(member)
      .where(eq(member.organizationId, subscriptionRow.referenceId))
    const desiredSeats = Number(latestPayload.data.metadata.seats)
    if (!Number.isSafeInteger(desiredSeats) || desiredSeats < (currentMembers?.value ?? 0)) {
      throw new Error('Enterprise seat intent is below current internal membership')
    }

    const metadata: Record<string, string> = {}
    for (const [key, value] of Object.entries(latestPayload.data.metadata)) {
      if (value === null) metadata[key] = ''
      else if (value !== undefined) metadata[key] = String(value)
    }
    metadata.simConfigRevision = String(latestPayload.data.revision)
    metadata.simConfigOperationId = context.eventId
    metadata.simConfigDeliveryRevision = String(latestPayload.data.deliveryRevision)
    metadata.simConfigDeliveryAttempt = String(context.attempts)

    await requireStripeClient().subscriptions.update(
      stripeSubscriptionId,
      { metadata },
      {
        idempotencyKey: `enterprise-config:${payload.subscriptionId}:${context.eventId}:delivery:${latestPayload.data.deliveryRevision}:attempt:${context.attempts}`,
      }
    )

    // Stripe's verified webhook is the only path that applies metadata to the
    // canonical subscription row. Keep this same outbox operation retryable
    // until a later attempt observes that acknowledgement.
    throw new Error('Awaiting verified Stripe webhook application')
  })
}

export const enterpriseIssuanceOutboxHandlers = {
  [ENTERPRISE_PROVISION_EVENT_TYPE]: provisionEnterpriseInStripe,
  [ENTERPRISE_METADATA_SYNC_EVENT_TYPE]: syncEnterpriseMetadataInStripe,
} as const

export async function getLatestEnterpriseProvisionings(organizationIds: string[]) {
  const result = new Map<string, EnterpriseProvisioningView>()
  if (organizationIds.length === 0) return result
  const rows = await db
    .select()
    .from(outboxEvent)
    .where(
      and(
        eq(outboxEvent.eventType, ENTERPRISE_PROVISION_EVENT_TYPE),
        inArray(sql<string>`${outboxEvent.payload} #>> '{request,organizationId}'`, organizationIds)
      )
    )
    .orderBy(desc(outboxEvent.createdAt), desc(outboxEvent.id))
  for (const row of rows) {
    const payload = parseEnterpriseProvisionPayload(row.payload)
    if (!payload) throw new Error(`Enterprise issuance outbox payload ${row.id} is invalid`)
    if (result.has(payload.request.organizationId)) continue
    result.set(payload.request.organizationId, toEnterpriseProvisioningView(row, payload))
  }
  return result
}

export { ENTERPRISE_METADATA_SYNC_EVENT_TYPE, ENTERPRISE_PROVISION_EVENT_TYPE }
