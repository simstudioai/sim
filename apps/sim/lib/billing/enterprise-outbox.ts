import { outboxEvent } from '@sim/db/schema'
import { and, desc, eq, sql } from 'drizzle-orm'
import type Stripe from 'stripe'
import { z } from 'zod'
import { MAX_BILLING_CONCURRENCY_LIMIT } from '@/lib/billing/concurrency-defaults'
import type { DbOrTx } from '@/lib/db/types'

export const ENTERPRISE_PROVISION_EVENT_TYPE = 'stripe.provision-enterprise'
export const ENTERPRISE_METADATA_SYNC_EVENT_TYPE = 'stripe.sync-enterprise-metadata'

const nonnegativeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)

export const enterpriseProvisionRequestSchema = z.object({
  requestKey: z.string().min(1),
  ownerUserId: z.string().min(1),
  organizationId: z.string().min(1),
  requestedByEmail: z.string().min(1),
  requestedByUserId: z.string().nullable(),
  invoiceAmountCents: z.number().int().positive(),
  includedMonthlyCredits: nonnegativeInteger,
  usageLimitCredits: nonnegativeInteger,
  seats: z.number().int().positive(),
  concurrencyLimit: z.number().int().positive().max(MAX_BILLING_CONCURRENCY_LIMIT).optional(),
  pausePaymentCollection: z.boolean().default(false),
})

export const enterpriseProvisionPayloadSchema = z.object({
  version: z.literal(1),
  request: enterpriseProvisionRequestSchema,
  retryRevision: nonnegativeInteger,
  stripeProgress: z
    .object({
      customerId: z.string().min(1).optional(),
      productId: z.string().min(1).optional(),
      priceId: z.string().min(1).optional(),
      subscriptionId: z.string().min(1).optional(),
    })
    .default({}),
  applicationResult: z
    .object({
      appliedAt: z.string().datetime(),
      subscriptionId: z.string().min(1),
    })
    .optional(),
})

export type EnterpriseProvisionPayload = z.infer<typeof enterpriseProvisionPayloadSchema>
export type EnterpriseProvisionRequest = EnterpriseProvisionPayload['request']

export const enterpriseMetadataSyncPayloadSchema = z.object({
  subscriptionId: z.string().min(1),
  revision: z.number().int().positive(),
  deliveryRevision: nonnegativeInteger.default(0),
  metadata: z.record(z.string(), z.unknown()),
})

export type EnterpriseMetadataSyncPayload = z.infer<typeof enterpriseMetadataSyncPayloadSchema>

export type EnterpriseOperationStatus =
  | 'pending'
  | 'processing'
  | 'dead_letter'
  | 'awaiting_webhook'
  | 'applied'

export function parseEnterpriseProvisionPayload(value: unknown): EnterpriseProvisionPayload | null {
  const result = enterpriseProvisionPayloadSchema.safeParse(value)
  return result.success ? result.data : null
}

export function deriveEnterpriseOperationStatus(
  outboxStatus: string,
  payload: EnterpriseProvisionPayload
): EnterpriseOperationStatus {
  if (payload.applicationResult) return 'applied'
  if (outboxStatus === 'processing') return 'processing'
  if (outboxStatus === 'dead_letter') return 'dead_letter'
  if (outboxStatus === 'completed') return 'awaiting_webhook'
  return 'pending'
}

export function isEnterpriseOperationUnresolved(
  outboxStatus: string,
  payload: EnterpriseProvisionPayload
): boolean {
  return deriveEnterpriseOperationStatus(outboxStatus, payload) !== 'applied'
}

export class EnterpriseIssuanceInProgressError extends Error {
  constructor(readonly organizationId: string) {
    super('Organization has an unfinished Enterprise issuance')
    this.name = 'EnterpriseIssuanceInProgressError'
  }
}

function stripeMetadataInteger(metadata: Stripe.Metadata, key: string): number | null {
  const value = metadata[key]
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

/** Exact commercial-term guard used before a webhook can close/admin-attribute an issuance. */
export function enterpriseOperationMatchesStripeSubscription(
  payload: EnterpriseProvisionPayload,
  stripeSubscription: Stripe.Subscription,
  referenceId: string
): boolean {
  const request = payload.request
  const items = stripeSubscription.items?.data ?? []
  const item = items[0]
  const price = item?.price
  const metadata = stripeSubscription.metadata ?? {}
  const pauseCollection = stripeSubscription.pause_collection
  const paymentCollectionMatches = request.pausePaymentCollection
    ? pauseCollection?.behavior === 'keep_as_draft' && pauseCollection.resumes_at === null
    : pauseCollection == null
  return (
    request.organizationId === referenceId &&
    items.length === 1 &&
    (item?.quantity ?? 1) === 1 &&
    stripeSubscription.collection_method === 'send_invoice' &&
    stripeSubscription.days_until_due === 30 &&
    price?.currency === 'usd' &&
    price.unit_amount === request.invoiceAmountCents &&
    price.recurring?.interval === 'month' &&
    (price.recurring.interval_count ?? 1) === 1 &&
    stripeMetadataInteger(metadata, 'invoiceAmountCents') === request.invoiceAmountCents &&
    stripeMetadataInteger(metadata, 'includedMonthlyCredits') === request.includedMonthlyCredits &&
    stripeMetadataInteger(metadata, 'usageLimitCredits') === request.usageLimitCredits &&
    stripeMetadataInteger(metadata, 'seats') === request.seats &&
    (request.concurrencyLimit === undefined ||
      stripeMetadataInteger(metadata, 'concurrencyLimit') === request.concurrencyLimit) &&
    paymentCollectionMatches
  )
}

export async function getLatestEnterpriseIssuanceForOrganization(
  executor: DbOrTx,
  organizationId: string
) {
  const [row] = await executor
    .select()
    .from(outboxEvent)
    .where(
      and(
        eq(outboxEvent.eventType, ENTERPRISE_PROVISION_EVENT_TYPE),
        sql`${outboxEvent.payload} #>> '{request,organizationId}' = ${organizationId}`
      )
    )
    .orderBy(desc(outboxEvent.createdAt), desc(outboxEvent.id))
    .limit(1)
  if (!row) return null
  const payload = parseEnterpriseProvisionPayload(row.payload)
  if (!payload) {
    throw new Error(`Enterprise issuance outbox payload ${row.id} is invalid`)
  }
  return { row, payload }
}

/**
 * Fail closed while the generic outbox contains an Enterprise issuance that
 * has not yet been transactionally marked applied by its Stripe webhook.
 * Mutation callers must hold the organization mutation lock while invoking
 * this guard so entitlement creation cannot pass concurrently with issuance.
 */
export async function assertNoUnresolvedEnterpriseIssuance(
  executor: DbOrTx,
  organizationId: string
): Promise<void> {
  await assertNoCompetingEnterpriseIssuance(executor, organizationId, null)
}

/**
 * Variant used by the generic Stripe subscription callback. It may pass the
 * operation ID carried by the Stripe object so the authoritative Enterprise
 * webhook can apply that exact issuance, while every competing entitlement is
 * still rejected.
 */
export async function assertNoCompetingEnterpriseIssuance(
  executor: DbOrTx,
  organizationId: string,
  allowedOperationId: string | null
): Promise<void> {
  const latest = await getLatestEnterpriseIssuanceForOrganization(executor, organizationId)
  if (
    latest &&
    latest.row.id !== allowedOperationId &&
    isEnterpriseOperationUnresolved(latest.row.status, latest.payload)
  ) {
    throw new EnterpriseIssuanceInProgressError(organizationId)
  }
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function positiveInteger(value: unknown): number | null {
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

export interface EnterpriseMetadataIntentState {
  latestRevision: number
  desiredMetadata: Record<string, unknown>
  hasUnappliedIntent: boolean
  effectiveSeatCapacity: number | null
}

/**
 * Resolve the latest admin-authored Enterprise configuration entirely from the
 * generic outbox. A dead-lettered intent is not effective until explicitly
 * retried. An increase cannot grant seats before Stripe's webhook applies it;
 * a decrease constrains admission immediately, so both directions are safe.
 */
export async function resolveEnterpriseMetadataIntent(
  executor: DbOrTx,
  subscriptionId: string,
  appliedMetadataValue: unknown
): Promise<EnterpriseMetadataIntentState> {
  const appliedMetadata = metadataRecord(appliedMetadataValue)
  const appliedSeats = positiveInteger(appliedMetadata.seats)
  const appliedRevision = positiveInteger(appliedMetadata.simConfigRevision) ?? 0
  const [latest] = await executor
    .select({
      id: outboxEvent.id,
      status: outboxEvent.status,
      payload: outboxEvent.payload,
    })
    .from(outboxEvent)
    .where(
      and(
        eq(outboxEvent.eventType, ENTERPRISE_METADATA_SYNC_EVENT_TYPE),
        sql`${outboxEvent.payload} ->> 'subscriptionId' = ${subscriptionId}`
      )
    )
    .orderBy(
      desc(sql`coalesce((${outboxEvent.payload} ->> 'revision')::bigint, 0)`),
      desc(outboxEvent.createdAt),
      desc(outboxEvent.id)
    )
    .limit(1)

  if (!latest) {
    return {
      latestRevision: appliedRevision,
      desiredMetadata: appliedMetadata,
      hasUnappliedIntent: false,
      effectiveSeatCapacity: appliedSeats,
    }
  }

  const parsed = enterpriseMetadataSyncPayloadSchema.safeParse(latest.payload)
  if (!parsed.success) {
    throw new Error(`Enterprise metadata outbox payload ${latest.id} is invalid`)
  }

  const appliedOperationId = appliedMetadata.simConfigOperationId
  const hasUnappliedIntent = latest.status !== 'dead_letter' && appliedOperationId !== latest.id
  const desiredMetadata = hasUnappliedIntent ? parsed.data.metadata : appliedMetadata
  const desiredSeats = positiveInteger(parsed.data.metadata.seats)
  const effectiveSeatCapacity = hasUnappliedIntent
    ? appliedSeats === null
      ? desiredSeats
      : desiredSeats === null
        ? appliedSeats
        : Math.min(appliedSeats, desiredSeats)
    : appliedSeats

  return {
    latestRevision: Math.max(appliedRevision, parsed.data.revision),
    desiredMetadata,
    hasUnappliedIntent,
    effectiveSeatCapacity,
  }
}
