import { outboxEvent } from '@sim/db/schema'
import { isRecordLike } from '@sim/utils/object'
import { and, desc, eq, sql } from 'drizzle-orm'
import type Stripe from 'stripe'
import { z } from 'zod'
import { MAX_BILLING_CONCURRENCY_LIMIT } from '@/lib/billing/concurrency-defaults'
import { MAX_WORKFLOW_EXECUTION_TIMEOUT_SECONDS } from '@/lib/billing/execution-timeout-defaults'
import type { DbOrTx } from '@/lib/db/types'

export const ENTERPRISE_PROVISION_EVENT_TYPE = 'stripe.provision-enterprise'
export const ENTERPRISE_METADATA_SYNC_EVENT_TYPE = 'stripe.sync-enterprise-metadata'
export const ENTERPRISE_WORKSPACE_MOVE_EVENT_TYPE = 'enterprise.move-workspace'

const nonnegativeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)

export const enterpriseProvisionRequestSchema = z.object({
  requestKey: z.string().min(1),
  ownerUserId: z.string().min(1),
  organizationId: z.string().min(1),
  requestedByEmail: z.string().min(1),
  requestedByUserId: z.string().nullable(),
  invoiceAmountCents: z.number().int().positive(),
  billingInterval: z.enum(['month', 'year']).default('month'),
  reportingPeriodAnchorDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  workspaceIds: z.array(z.string().min(1)).max(1_000).default([]),
  usageLimitCredits: nonnegativeInteger,
  prepaidBalanceCreditsAtIssuance: nonnegativeInteger.default(0),
  seats: z.number().int().positive(),
  concurrencyLimit: z.number().int().positive().max(MAX_BILLING_CONCURRENCY_LIMIT).optional(),
  workflowExecutionTimeoutSeconds: z
    .number()
    .int()
    .positive()
    .max(MAX_WORKFLOW_EXECUTION_TIMEOUT_SECONDS)
    .optional(),
  pausePaymentCollection: z.boolean().default(false),
})

export const enterpriseProvisionPayloadSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]),
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
  acknowledgement: z
    .object({
      startedAt: z.string().datetime(),
      deadlineAt: z.string().datetime(),
    })
    .optional(),
  metadata: z.record(z.string(), z.unknown()),
  terms: z
    .object({
      invoiceAmountCents: z.number().int().positive(),
      billingInterval: z.enum(['month', 'year']),
    })
    .optional(),
  stripeProgress: z.object({ priceId: z.string().min(1).optional() }).default({}),
})

export type EnterpriseMetadataSyncPayload = z.infer<typeof enterpriseMetadataSyncPayloadSchema>

function stripeMetadataValueMatches(
  metadata: Stripe.Metadata,
  key: string,
  expected: unknown
): boolean {
  if (expected === null) return metadata[key] === undefined || metadata[key] === ''
  if (expected === undefined) return true
  return metadata[key] === String(expected)
}

/** Exact guard before a configuration marker can acknowledge an admin intent. */
export function enterpriseMetadataIntentMatchesStripeSubscription(
  payload: EnterpriseMetadataSyncPayload,
  operationId: string,
  stripeSubscription: Stripe.Subscription
): boolean {
  const metadata = stripeSubscription.metadata ?? {}
  if (
    metadata.simConfigOperationId !== operationId ||
    metadata.simConfigRevision !== String(payload.revision) ||
    metadata.simConfigDeliveryRevision !== String(payload.deliveryRevision) ||
    !Object.entries(payload.metadata).every(([key, value]) =>
      stripeMetadataValueMatches(metadata, key, value)
    )
  ) {
    return false
  }

  if (!payload.terms) return true
  const items = stripeSubscription.items?.data ?? []
  const price = items[0]?.price
  return (
    !stripeSubscription.schedule &&
    stripeSubscription.collection_method === 'send_invoice' &&
    stripeSubscription.days_until_due === 30 &&
    items.length === 1 &&
    (items[0]?.quantity ?? 1) === 1 &&
    price?.currency === 'usd' &&
    price.unit_amount === payload.terms.invoiceAmountCents &&
    price.recurring?.interval === payload.terms.billingInterval &&
    (price.recurring.interval_count ?? 1) === 1
  )
}

export const enterpriseWorkspaceMovePayloadSchema = z.object({
  provisioningOperationId: z.string().min(1),
  workspaceId: z.string().min(1),
  destinationOrganizationId: z.string().min(1),
  expectedOwnerId: z.string().min(1),
  adminEmail: z.string().email(),
  sequence: z.number().int().min(0),
})

export type EnterpriseWorkspaceMovePayload = z.infer<typeof enterpriseWorkspaceMovePayloadSchema>

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
    price.recurring?.interval === request.billingInterval &&
    (price.recurring.interval_count ?? 1) === 1 &&
    stripeMetadataInteger(metadata, 'invoiceAmountCents') === request.invoiceAmountCents &&
    stripeMetadataInteger(metadata, 'usageLimitCredits') === request.usageLimitCredits &&
    (request.reportingPeriodAnchorDate === undefined ||
      metadata.reportingPeriodAnchorDate === request.reportingPeriodAnchorDate) &&
    stripeMetadataInteger(metadata, 'seats') === request.seats &&
    (request.concurrencyLimit === undefined ||
      stripeMetadataInteger(metadata, 'concurrencyLimit') === request.concurrencyLimit) &&
    (request.workflowExecutionTimeoutSeconds === undefined ||
      stripeMetadataInteger(metadata, 'workflowExecutionTimeoutSeconds') ===
        request.workflowExecutionTimeoutSeconds) &&
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
  return isRecordLike(value) ? (value as Record<string, unknown>) : {}
}

function positiveInteger(value: unknown): number | null {
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

export interface EnterpriseMetadataIntentState {
  latestRevision: number
  desiredMetadata: Record<string, unknown>
  desiredTerms: EnterpriseMetadataSyncPayload['terms'] | null
  hasUnappliedIntent: boolean
  effectiveSeatCapacity: number | null
  configurationUpdate: {
    id: string
    status: 'pending' | 'processing' | 'failed'
    requestedMetadata: Record<string, unknown>
    requestedTerms: EnterpriseMetadataSyncPayload['terms'] | null
    providerAccepted: boolean
    error: string | null
  } | null
}

/**
 * Resolve the latest admin-authored Enterprise configuration entirely from the
 * generic outbox. A dead letter before the provider accepts the mutation is
 * ineffective. Once the durable acknowledgement window starts, Stripe already
 * contains the desired state, so a later dead letter remains effective and
 * fail-closed until reconciliation or an explicit retry completes.
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
      lastError: outboxEvent.lastError,
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
      desiredTerms: null,
      hasUnappliedIntent: false,
      effectiveSeatCapacity: appliedSeats,
      configurationUpdate: null,
    }
  }

  const parsed = enterpriseMetadataSyncPayloadSchema.safeParse(latest.payload)
  if (!parsed.success) {
    throw new Error(`Enterprise metadata outbox payload ${latest.id} is invalid`)
  }

  const appliedOperationId = appliedMetadata.simConfigOperationId
  const operationApplied = appliedOperationId === latest.id
  const providerAccepted = parsed.data.acknowledgement !== undefined
  const hasUnappliedIntent =
    !operationApplied && (latest.status !== 'dead_letter' || providerAccepted)
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
    desiredTerms: hasUnappliedIntent ? (parsed.data.terms ?? null) : null,
    hasUnappliedIntent,
    effectiveSeatCapacity,
    configurationUpdate: operationApplied
      ? null
      : {
          id: latest.id,
          status:
            latest.status === 'dead_letter'
              ? 'failed'
              : latest.status === 'processing'
                ? 'processing'
                : 'pending',
          requestedMetadata: parsed.data.metadata,
          requestedTerms: parsed.data.terms ?? null,
          providerAccepted,
          error: latest.status === 'dead_letter' ? (latest.lastError ?? null) : null,
        },
  }
}
