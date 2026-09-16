import { db } from '@sim/db'
import { member, workspace } from '@sim/db/schema'
import { generateId, isValidUuid } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import { and, eq } from 'drizzle-orm'
import {
  checkBillingBlocked,
  checkBillingEntityBlocked,
  checkOrganizationMemberUsageLimit,
  checkUsageStatus,
} from '@/lib/billing/calculations/usage-monitor'
import { parseBillingConcurrencyLimit } from '@/lib/billing/concurrency-defaults'
import { getOrganizationSubscription } from '@/lib/billing/core/billing'
import { defaultBillingPeriod } from '@/lib/billing/core/billing-period'
import { getHighestPriorityPersonalSubscription } from '@/lib/billing/core/plan'
import {
  ENTERPRISE_REPORTING_PERIOD_ANCHOR_METADATA_KEY,
  resolveSubscriptionUsagePeriod,
  type UsagePeriodSource,
} from '@/lib/billing/core/reporting-period'
import type { BillingContext, BillingEntity } from '@/lib/billing/core/usage-log'
import { parseWorkflowExecutionTimeoutSeconds } from '@/lib/billing/execution-timeout-defaults'
import { isEnterprise } from '@/lib/billing/plan-helpers'
import {
  BILLING_ACCOUNT_DECISION_HEADER,
  BILLING_ACCOUNT_DECISION_HEADER_MAX_BYTES,
  BILLING_ATTRIBUTION_HEADER,
  BILLING_ATTRIBUTION_HEADER_MAX_BYTES,
  BILLING_REQUEST_ID_HEADER,
  COPILOT_BILLING_PROTOCOL,
  COPILOT_BILLING_PROTOCOL_HEADER,
  type CopilotBillingProtocol,
} from '@/lib/copilot/generated/billing-protocol-v1'
import { isBillingEnabled, isHosted } from '@/lib/core/config/env-flags'
import { type ResourceOwner, resourceScopeFromOwner } from '@/lib/core/resource-scope'

export {
  BILLING_ACCOUNT_DECISION_HEADER,
  BILLING_ACCOUNT_DECISION_HEADER_MAX_BYTES,
  BILLING_ATTRIBUTION_HEADER,
  BILLING_REQUEST_ID_HEADER,
  COPILOT_BILLING_PROTOCOL,
  COPILOT_BILLING_PROTOCOL_HEADER,
}
export type { CopilotBillingProtocol }

export interface PayerSubscriptionSnapshot {
  readonly id: string
  readonly referenceId: string
  readonly plan: string
  readonly status: string | null
  readonly seats: number | null
  readonly periodStart: string | null
  readonly periodEnd: string | null
  readonly billingInterval?: 'month' | 'year'
  readonly enterpriseReportingPeriodAnchorDate?: string
  readonly enterpriseConcurrencyLimit?: number
  readonly enterpriseWorkflowExecutionTimeoutSeconds?: number
}

export interface BillingPeriodSnapshot {
  readonly start: string
  readonly end: string
  readonly source?: UsagePeriodSource
}

/**
 * Immutable billing decision captured before hosted work starts.
 *
 * `actorUserId` identifies the human or explicit system actor recorded in
 * `usage_log.userId`. The workspace selects every payer field independently:
 * organization-owned workspaces use that exact organization, while personal
 * workspaces use their `billedAccountUserId` personal pool.
 */
export interface BillingAttributionSnapshot {
  readonly actorUserId: string
  readonly workspaceId: string | null
  readonly organizationId: string | null
  readonly billedAccountUserId: string
  readonly billingEntity: Readonly<BillingEntity>
  readonly billingPeriod: Readonly<BillingPeriodSnapshot>
  readonly payerSubscription: Readonly<PayerSubscriptionSnapshot> | null
}

export interface AttributedBillingRequestEnvelope {
  billingRequestId: string
  serializedAttribution: string
  headers: Record<string, string>
}

export interface AccountBillingDecision {
  readonly userId: string
  readonly billingEntity: BillingEntity
  readonly billingPeriod: {
    readonly start: string
    readonly end: string
    readonly source?: UsagePeriodSource
  }
}

export interface ResolveBillingAttributionParams {
  actorUserId: string
  workspaceId: string
}

export interface ResolveWorkspaceBillingPayerOptions {
  onMissing?: 'throw' | 'return-null'
}

export interface AttributedUsageLimitsResult {
  isExceeded: boolean
  message?: string
  scope?: 'actor' | 'payer' | 'member'
  payerUsage?: {
    currentUsage: number
    limit: number
  }
  memberUsage?: {
    currentUsage: number
    limit: number | null
  }
}

export interface AttributedBillingBlockResult {
  blocked: boolean
  message?: string
  scope?: 'actor' | 'payer'
}

type ResolvedPayerSubscription =
  | Awaited<ReturnType<typeof getOrganizationSubscription>>
  | Awaited<ReturnType<typeof getHighestPriorityPersonalSubscription>>

function serializeSubscription(
  subscription: NonNullable<ResolvedPayerSubscription> | null
): PayerSubscriptionSnapshot | null {
  if (!subscription) return null

  const enterpriseConcurrencyLimit =
    isEnterprise(subscription.plan) && isRecordLike(subscription.metadata)
      ? parseBillingConcurrencyLimit(subscription.metadata.concurrencyLimit)
      : null
  const enterpriseWorkflowExecutionTimeoutSeconds =
    isEnterprise(subscription.plan) && isRecordLike(subscription.metadata)
      ? parseWorkflowExecutionTimeoutSeconds(subscription.metadata.workflowExecutionTimeoutSeconds)
      : null
  const billingInterval =
    subscription.billingInterval === 'month' || subscription.billingInterval === 'year'
      ? subscription.billingInterval
      : null
  const enterpriseReportingPeriodAnchorDate =
    isEnterprise(subscription.plan) && isRecordLike(subscription.metadata)
      ? subscription.metadata[ENTERPRISE_REPORTING_PERIOD_ANCHOR_METADATA_KEY]
      : null
  return Object.freeze({
    id: subscription.id,
    referenceId: subscription.referenceId,
    plan: subscription.plan,
    status: subscription.status,
    seats: subscription.seats ?? null,
    periodStart: subscription.periodStart?.toISOString() ?? null,
    periodEnd: subscription.periodEnd?.toISOString() ?? null,
    ...(billingInterval ? { billingInterval } : {}),
    ...(typeof enterpriseReportingPeriodAnchorDate === 'string'
      ? { enterpriseReportingPeriodAnchorDate }
      : {}),
    ...(enterpriseConcurrencyLimit !== null ? { enterpriseConcurrencyLimit } : {}),
    ...(enterpriseWorkflowExecutionTimeoutSeconds !== null
      ? { enterpriseWorkflowExecutionTimeoutSeconds }
      : {}),
  })
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function parseSnapshotDate(value: unknown, field: string): Date {
  if (!isNonEmptyString(value)) {
    throw new Error(`Billing attribution ${field} must be a non-empty ISO date string`)
  }

  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`Billing attribution ${field} is not a valid ISO date string`)
  }
  return date
}

function freezeBillingAttribution(
  attribution: BillingAttributionSnapshot
): BillingAttributionSnapshot {
  Object.freeze(attribution.billingEntity)
  Object.freeze(attribution.billingPeriod)
  if (attribution.payerSubscription) Object.freeze(attribution.payerSubscription)
  return Object.freeze(attribution)
}

/**
 * Validates an attribution restored at an asynchronous or HTTP boundary.
 */
export function assertBillingAttributionSnapshot(value: unknown): BillingAttributionSnapshot {
  if (!isRecordLike(value)) {
    throw new Error('Billing attribution snapshot must be an object')
  }

  const raw = value
  if (
    !isNonEmptyString(raw.actorUserId) ||
    (raw.workspaceId !== null && !isNonEmptyString(raw.workspaceId)) ||
    !isNonEmptyString(raw.billedAccountUserId)
  ) {
    throw new Error('Billing attribution snapshot is missing actor, workspace, or billed account')
  }
  if (raw.organizationId !== null && !isNonEmptyString(raw.organizationId)) {
    throw new Error('Billing attribution organization must be a non-empty string or null')
  }

  if (raw.workspaceId === null && !isNonEmptyString(raw.organizationId)) {
    throw new Error('Organization billing requires an organization owner')
  }

  if (!isRecordLike(raw.billingEntity)) {
    throw new Error('Billing attribution snapshot is missing its billing entity')
  }
  const rawEntity = raw.billingEntity
  if (
    (rawEntity.type !== 'user' && rawEntity.type !== 'organization') ||
    !isNonEmptyString(rawEntity.id)
  ) {
    throw new Error('Billing attribution snapshot has an invalid billing entity')
  }

  const organizationId = raw.organizationId as string | null
  if (
    (rawEntity.type === 'organization' &&
      (organizationId === null || rawEntity.id !== organizationId)) ||
    (rawEntity.type === 'user' &&
      (organizationId !== null || rawEntity.id !== raw.billedAccountUserId))
  ) {
    throw new Error('Billing attribution payer fields are inconsistent')
  }

  if (!isRecordLike(raw.billingPeriod)) {
    throw new Error('Billing attribution snapshot is missing its billing period')
  }
  const rawPeriod = raw.billingPeriod
  const periodStart = parseSnapshotDate(rawPeriod.start, 'billingPeriod.start')
  const periodEnd = parseSnapshotDate(rawPeriod.end, 'billingPeriod.end')
  if (periodEnd <= periodStart) {
    throw new Error('Billing attribution billing period must end after it starts')
  }
  const periodSource = rawPeriod.source
  if (
    periodSource !== undefined &&
    periodSource !== 'reporting' &&
    periodSource !== 'stripe' &&
    periodSource !== 'default'
  ) {
    throw new Error('Billing attribution billing period source is invalid')
  }

  let payerSubscription: PayerSubscriptionSnapshot | null = null
  if (raw.payerSubscription !== null) {
    if (!isRecordLike(raw.payerSubscription)) {
      throw new Error('Billing attribution payer subscription must be an object or null')
    }

    const subscription = raw.payerSubscription
    if (
      !isNonEmptyString(subscription.id) ||
      !isNonEmptyString(subscription.referenceId) ||
      !isNonEmptyString(subscription.plan) ||
      (subscription.status !== null && typeof subscription.status !== 'string') ||
      (subscription.seats !== null &&
        (typeof subscription.seats !== 'number' ||
          !Number.isFinite(subscription.seats) ||
          subscription.seats < 0))
    ) {
      throw new Error('Billing attribution payer subscription is invalid')
    }

    const subscriptionStart =
      subscription.periodStart === null
        ? null
        : parseSnapshotDate(subscription.periodStart, 'payerSubscription.periodStart')
    const subscriptionEnd =
      subscription.periodEnd === null
        ? null
        : parseSnapshotDate(subscription.periodEnd, 'payerSubscription.periodEnd')
    if (subscriptionStart && subscriptionEnd && subscriptionEnd <= subscriptionStart) {
      throw new Error('Billing attribution subscription period must end after it starts')
    }
    if (subscription.referenceId !== rawEntity.id) {
      throw new Error('Billing attribution subscription does not belong to its billing entity')
    }
    const enterpriseConcurrencyLimit = subscription.enterpriseConcurrencyLimit
    if (
      enterpriseConcurrencyLimit !== undefined &&
      (!isEnterprise(subscription.plan) ||
        typeof enterpriseConcurrencyLimit !== 'number' ||
        parseBillingConcurrencyLimit(enterpriseConcurrencyLimit) !== enterpriseConcurrencyLimit)
    ) {
      throw new Error('Billing attribution Enterprise concurrency limit is invalid')
    }
    const enterpriseWorkflowExecutionTimeoutSeconds =
      subscription.enterpriseWorkflowExecutionTimeoutSeconds
    if (
      enterpriseWorkflowExecutionTimeoutSeconds !== undefined &&
      (!isEnterprise(subscription.plan) ||
        typeof enterpriseWorkflowExecutionTimeoutSeconds !== 'number' ||
        parseWorkflowExecutionTimeoutSeconds(enterpriseWorkflowExecutionTimeoutSeconds) !==
          enterpriseWorkflowExecutionTimeoutSeconds)
    ) {
      throw new Error('Billing attribution Enterprise workflow execution timeout is invalid')
    }
    const billingInterval = subscription.billingInterval
    if (
      billingInterval !== undefined &&
      billingInterval !== 'month' &&
      billingInterval !== 'year'
    ) {
      throw new Error('Billing attribution subscription interval is invalid')
    }
    const enterpriseReportingPeriodAnchorDate = subscription.enterpriseReportingPeriodAnchorDate
    if (
      enterpriseReportingPeriodAnchorDate !== undefined &&
      (!isEnterprise(subscription.plan) ||
        typeof enterpriseReportingPeriodAnchorDate !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(enterpriseReportingPeriodAnchorDate))
    ) {
      throw new Error('Billing attribution Enterprise reporting-period anchor is invalid')
    }

    payerSubscription = {
      id: subscription.id,
      referenceId: subscription.referenceId,
      plan: subscription.plan,
      status: subscription.status as string | null,
      seats: subscription.seats as number | null,
      periodStart: subscriptionStart?.toISOString() ?? null,
      periodEnd: subscriptionEnd?.toISOString() ?? null,
      ...(billingInterval !== undefined ? { billingInterval } : {}),
      ...(enterpriseReportingPeriodAnchorDate !== undefined
        ? { enterpriseReportingPeriodAnchorDate }
        : {}),
      ...(enterpriseConcurrencyLimit !== undefined ? { enterpriseConcurrencyLimit } : {}),
      ...(enterpriseWorkflowExecutionTimeoutSeconds !== undefined
        ? { enterpriseWorkflowExecutionTimeoutSeconds }
        : {}),
    }
  }

  return freezeBillingAttribution({
    actorUserId: raw.actorUserId,
    workspaceId: raw.workspaceId,
    organizationId,
    billedAccountUserId: raw.billedAccountUserId,
    billingEntity: { type: rawEntity.type, id: rawEntity.id },
    billingPeriod: {
      start: periodStart.toISOString(),
      end: periodEnd.toISOString(),
      ...(periodSource !== undefined ? { source: periodSource } : {}),
    },
    payerSubscription,
  })
}

/**
 * Encodes a validated snapshot for a trusted same-origin internal request.
 */
export function serializeBillingAttributionHeader(attribution: BillingAttributionSnapshot): string {
  return encodeURIComponent(JSON.stringify(assertBillingAttributionSnapshot(attribution)))
}

/**
 * Allocates a modern request identity and carries its exact attribution in the
 * trusted request envelope. Replay durability lives with the envelope, so
 * modern admission does not depend on Redis.
 */
export function createAttributedBillingRequestEnvelope(
  attribution: BillingAttributionSnapshot
): AttributedBillingRequestEnvelope {
  const validatedAttribution = assertBillingAttributionSnapshot(attribution)
  const billingRequestId = generateId()
  const serializedAttribution = serializeBillingAttributionHeader(validatedAttribution)

  return {
    billingRequestId,
    serializedAttribution,
    headers: {
      [COPILOT_BILLING_PROTOCOL_HEADER]: COPILOT_BILLING_PROTOCOL.attributed,
      [BILLING_REQUEST_ID_HEADER]: billingRequestId,
      [BILLING_ATTRIBUTION_HEADER]: serializedAttribution,
    },
  }
}

/**
 * Requires the server-generated identity shared by hosted admission and cost
 * callbacks. The UUID is allocated by Sim and is never accepted from a client
 * request body.
 */
export function requireBillingRequestIdHeader(headers: Pick<Headers, 'get'>): string {
  const billingRequestId = headers.get(BILLING_REQUEST_ID_HEADER)?.trim()
  if (!billingRequestId || !isValidUuid(billingRequestId)) {
    throw new Error('A valid billing request ID header is required for attributed billing')
  }
  return billingRequestId
}

function readBillingAttributionHeader(
  headers: Pick<Headers, 'get'>
): BillingAttributionSnapshot | undefined {
  const encoded = headers.get(BILLING_ATTRIBUTION_HEADER)
  if (!encoded) return undefined
  if (encoded.length > BILLING_ATTRIBUTION_HEADER_MAX_BYTES) {
    throw new Error('Billing attribution header exceeds the maximum allowed size')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(decodeURIComponent(encoded))
  } catch {
    throw new Error('Billing attribution header is malformed')
  }

  return assertBillingAttributionSnapshot(parsed)
}

function parseBillingAttributionHeader(
  headers: Pick<Headers, 'get'>,
  expected: ResourceOwner & { actorUserId?: string }
): BillingAttributionSnapshot | undefined {
  const attribution = readBillingAttributionHeader(headers)
  if (!attribution) return undefined
  if (expected.actorUserId !== undefined && attribution.actorUserId !== expected.actorUserId) {
    throw new Error('Billing attribution header does not match the authenticated request scope')
  }
  try {
    assertBillingAttributionOwner(attribution, expected)
  } catch {
    throw new Error('Billing attribution header does not match the authenticated request scope')
  }
  return attribution
}

/** Settles exactly the admitted scope, including organization charges replayed from Go's ledger. */
export function requireBillingCallbackAttribution(
  headers: Pick<Headers, 'get'>,
  expected: { actorUserId: string; workspaceId?: string; organizationId?: string }
): BillingAttributionSnapshot {
  const attribution = readBillingAttributionHeader(headers)
  if (
    !attribution ||
    attribution.actorUserId !== expected.actorUserId ||
    attribution.workspaceId !== (expected.workspaceId ?? null) ||
    (expected.organizationId !== undefined &&
      attribution.organizationId !== expected.organizationId)
  ) {
    throw new Error('Billing attribution header does not match the admitted callback scope')
  }
  return attribution
}

/**
 * Requires a validated snapshot at an internal boundary that always has an
 * upstream billing decision. Missing attribution is a contract failure rather
 * than permission to re-resolve a potentially different payer.
 */
export function requireBillingAttributionHeader(
  headers: Pick<Headers, 'get'>,
  expected: ResourceOwner & { actorUserId: string }
): BillingAttributionSnapshot {
  const attribution = parseBillingAttributionHeader(headers, expected)
  if (!attribution) {
    throw new Error('Billing attribution header is required for this internal request')
  }
  return attribution
}

/**
 * Restores the executor's captured billing decision without treating its actor as authorization.
 * The authenticated executor is authoritative for the snapshot; the canonical use case supplies
 * the workspace scope that must still match.
 */
export function requireWorkspaceBillingAttributionHeader(
  headers: Pick<Headers, 'get'>,
  expected: Pick<ResolveBillingAttributionParams, 'workspaceId'>
): BillingAttributionSnapshot {
  const attribution = parseBillingAttributionHeader(headers, expected)
  if (!attribution) {
    throw new Error('Billing attribution header is required for this internal request')
  }
  return attribution
}

/**
 * Compares two independently restored snapshots after canonical validation.
 */
export function billingAttributionsEqual(
  left: BillingAttributionSnapshot,
  right: BillingAttributionSnapshot
): boolean {
  return (
    JSON.stringify(assertBillingAttributionSnapshot(left)) ===
    JSON.stringify(assertBillingAttributionSnapshot(right))
  )
}

function assertAccountBillingDecision(value: unknown): AccountBillingDecision {
  if (!isRecordLike(value) || !isNonEmptyString(value.userId)) {
    throw new Error('Account billing decision must contain a user ID')
  }
  if (
    !isRecordLike(value.billingEntity) ||
    (value.billingEntity.type !== 'user' && value.billingEntity.type !== 'organization') ||
    !isNonEmptyString(value.billingEntity.id)
  ) {
    throw new Error('Account billing decision must contain a billing entity')
  }
  if (
    !isRecordLike(value.billingPeriod) ||
    !isNonEmptyString(value.billingPeriod.start) ||
    !isNonEmptyString(value.billingPeriod.end)
  ) {
    throw new Error('Account billing decision must contain a valid billing period')
  }
  const start = new Date(value.billingPeriod.start)
  const end = new Date(value.billingPeriod.end)
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
    throw new Error('Account billing decision must contain a valid billing period')
  }
  const source = value.billingPeriod.source
  if (
    source !== undefined &&
    source !== 'reporting' &&
    source !== 'stripe' &&
    source !== 'default'
  ) {
    throw new Error('Account billing decision must contain a valid billing period source')
  }

  return Object.freeze({
    userId: value.userId,
    billingEntity: Object.freeze({
      type: value.billingEntity.type,
      id: value.billingEntity.id,
    }),
    billingPeriod: Object.freeze({
      start: start.toISOString(),
      end: end.toISOString(),
      ...(source !== undefined ? { source } : {}),
    }),
  })
}

/**
 * Encodes the immutable direct-account payer selected by trusted Sim
 * admission. Go stores and returns this value opaquely.
 */
export function serializeAccountBillingDecisionHeader(decision: AccountBillingDecision): string {
  return encodeURIComponent(JSON.stringify(assertAccountBillingDecision(decision)))
}

/**
 * Restores and validates a direct-account payer decision from a trusted
 * internal callback.
 */
export function requireAccountBillingDecisionHeader(
  headers: Pick<Headers, 'get'>
): AccountBillingDecision {
  const encoded = headers.get(BILLING_ACCOUNT_DECISION_HEADER)
  if (!encoded || encoded.length > BILLING_ACCOUNT_DECISION_HEADER_MAX_BYTES) {
    throw new Error('A valid account billing decision header is required')
  }

  try {
    return assertAccountBillingDecision(JSON.parse(decodeURIComponent(encoded)))
  } catch (error) {
    throw new Error('Account billing decision header is malformed', { cause: error })
  }
}

export function toUsageLimitSubscription(attribution: BillingAttributionSnapshot) {
  const snapshot = attribution.payerSubscription
  if (!snapshot) {
    if (!attribution.organizationId) return null

    return {
      referenceId: attribution.organizationId,
      plan: 'free',
      status: null,
      seats: null,
      periodStart: new Date(attribution.billingPeriod.start),
      periodEnd: new Date(attribution.billingPeriod.end),
    }
  }

  return {
    referenceId: snapshot.referenceId,
    plan: snapshot.plan,
    status: snapshot.status,
    seats: snapshot.seats,
    periodStart: snapshot.periodStart ? new Date(snapshot.periodStart) : null,
    periodEnd: snapshot.periodEnd ? new Date(snapshot.periodEnd) : null,
    billingInterval: snapshot.billingInterval ?? null,
    metadata: snapshot.enterpriseReportingPeriodAnchorDate
      ? {
          [ENTERPRISE_REPORTING_PERIOD_ANCHOR_METADATA_KEY]:
            snapshot.enterpriseReportingPeriodAnchorDate,
        }
      : null,
    usagePeriod: {
      start: new Date(attribution.billingPeriod.start),
      end: new Date(attribution.billingPeriod.end),
      source:
        attribution.billingPeriod.source ??
        (snapshot.enterpriseReportingPeriodAnchorDate ? 'reporting' : 'stripe'),
      anchorDate: snapshot.enterpriseReportingPeriodAnchorDate ?? null,
      interval: snapshot.billingInterval ?? null,
    },
  }
}

/**
 * Reads only the identity an unauthenticated run acts as: the workspace's
 * billing account.
 *
 * The same identity {@link resolveSystemBillingAttribution} elects as
 * `actorUserId`, exposed on its own for gates that must name that identity
 * before execution and have no use for the payer's subscription. Surfaces with
 * no identifiable caller — a public API URL, a schedule, a webhook — must
 * authorize against this rather than against the workflow owner, which is a
 * stored pointer whose access can lapse without the workspace changing.
 *
 * Returns `null` when the workspace has no billing account or does not exist,
 * so a gate can fail closed without distinguishing the two.
 */
export async function getWorkspaceBilledAccountUserId(workspaceId: string): Promise<string | null> {
  const [row] = await db
    .select({ billedAccountUserId: workspace.billedAccountUserId })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1)

  return row?.billedAccountUserId ?? null
}

/**
 * Resolves the workspace-selected payer and its exact subscription without
 * consulting an actor's organization memberships.
 */
export async function resolveWorkspaceBillingPayer(
  workspaceId: string,
  options: ResolveWorkspaceBillingPayerOptions = {}
) {
  const [workspacePayer] = await db
    .select({
      billedAccountUserId: workspace.billedAccountUserId,
      organizationId: workspace.organizationId,
    })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1)

  if (!workspacePayer?.billedAccountUserId) {
    if (options.onMissing === 'return-null') return null
    throw new Error(`Unable to resolve billing payer for workspace ${workspaceId}`)
  }

  const { billedAccountUserId, organizationId } = workspacePayer
  const payerSubscription = organizationId
    ? await getOrganizationSubscription(organizationId, { onError: 'throw' })
    : await getHighestPriorityPersonalSubscription(billedAccountUserId, { onError: 'throw' })

  const expectedReferenceId = organizationId ?? billedAccountUserId
  if (payerSubscription && payerSubscription.referenceId !== expectedReferenceId) {
    throw new Error(
      `Resolved subscription ${payerSubscription.id} does not belong to workspace payer ${expectedReferenceId}`
    )
  }

  return {
    billedAccountUserId,
    organizationId,
    payerSubscription,
  }
}

function buildBillingAttributionSnapshot(params: {
  actorUserId: string
  workspaceId: string | null
  billedAccountUserId: string
  organizationId: string | null
  payerSubscription: ResolvedPayerSubscription
}): BillingAttributionSnapshot {
  const { actorUserId, workspaceId, billedAccountUserId, organizationId, payerSubscription } =
    params
  const period = resolveSubscriptionUsagePeriod(payerSubscription) ?? {
    ...defaultBillingPeriod(),
    source: 'default' as const,
  }
  const billingEntity: BillingEntity = organizationId
    ? { type: 'organization', id: organizationId }
    : { type: 'user', id: billedAccountUserId }

  return freezeBillingAttribution({
    actorUserId,
    workspaceId,
    organizationId,
    billedAccountUserId,
    billingEntity,
    billingPeriod: {
      start: period.start.toISOString(),
      end: period.end.toISOString(),
      source: period.source,
    },
    payerSubscription: serializeSubscription(payerSubscription),
  })
}

/**
 * Resolves the payer from the workspace without consulting the actor's
 * subscriptions or organization memberships.
 */
export async function resolveBillingAttribution({
  actorUserId,
  workspaceId,
}: ResolveBillingAttributionParams): Promise<BillingAttributionSnapshot> {
  const payer = await resolveWorkspaceBillingPayer(workspaceId)
  if (!payer) {
    throw new Error(`Unable to resolve billing payer for workspace ${workspaceId}`)
  }

  return buildBillingAttributionSnapshot({
    actorUserId,
    workspaceId,
    ...payer,
  })
}

/** The organization payer is independent of the person making the request. */
export async function resolveOrganizationBillingPayer(organizationId: string) {
  const [owner] = await db
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.role, 'owner')))
    .limit(1)
  if (!owner) throw new Error('Organization billing owner is unavailable')
  const payerSubscription = await getOrganizationSubscription(organizationId, { onError: 'throw' })
  if (payerSubscription && payerSubscription.referenceId !== organizationId)
    throw new Error('Organization subscription belongs to a different payer')
  return { organizationId, billedAccountUserId: owner.userId, payerSubscription }
}

/** Captures the routed organization's payer without consulting the actor's personal plan. */
export async function resolveOrganizationBillingAttribution(input: {
  actorUserId: string
  organizationId: string
}): Promise<BillingAttributionSnapshot> {
  const payer = await resolveOrganizationBillingPayer(input.organizationId)
  return buildBillingAttributionSnapshot({
    actorUserId: input.actorUserId,
    workspaceId: null,
    ...payer,
  })
}

/** Background indexing records the current payer as its system attribution, never as document authority. */
export async function resolveSystemOrganizationBillingAttribution(
  organizationId: string
): Promise<BillingAttributionSnapshot> {
  const payer = await resolveOrganizationBillingPayer(organizationId)
  return buildBillingAttributionSnapshot({
    actorUserId: payer.billedAccountUserId,
    workspaceId: null,
    ...payer,
  })
}

/** A workspace's billing organization is its payer, not a second resource owner. */
export function assertBillingAttributionOwner(
  attribution: BillingAttributionSnapshot,
  owner: ResourceOwner
): void {
  const scope = resourceScopeFromOwner(owner)
  const matches =
    scope.kind === 'workspace'
      ? attribution.workspaceId === scope.workspaceId
      : attribution.workspaceId === null && attribution.organizationId === scope.organizationId
  if (!matches) throw new Error('Billing attribution does not match resource owner')
}

/**
 * Resolves legacy-v0 traffic from the workspace visible at this request
 * boundary, falling back to account billing for markerless local self-hosted
 * requests when the workspace is absent from this Sim deployment.
 *
 * Unlike modern attributed-v1/direct-v1 envelopes, this decision is mutable:
 * historical markerless Go allocated its callback billing ID after admission
 * and returned no payer material, so admission and callback independently
 * resolve current state. Hosted traffic may use this only for explicit
 * legacy-v0 replay; markerless use is confined to local self-hosting.
 */
export async function resolveLegacyV0BillingAttribution({
  actorUserId,
  workspaceId,
}: ResolveBillingAttributionParams): Promise<BillingAttributionSnapshot | null> {
  const payer = await resolveWorkspaceBillingPayer(workspaceId, { onMissing: 'return-null' })
  if (!payer) return null

  return buildBillingAttributionSnapshot({
    actorUserId,
    workspaceId,
    ...payer,
  })
}

/**
 * Resolves an explicit system actor and payer from one workspace payer result.
 *
 * The billed account from that row is both `usage_log.userId` and the personal
 * fallback payer, while an organization workspace keeps its exact organization
 * billing entity. No second workspace read can observe a transferred state.
 */
export async function resolveSystemBillingAttribution(
  workspaceId: string
): Promise<BillingAttributionSnapshot> {
  const payer = await resolveWorkspaceBillingPayer(workspaceId)
  if (!payer) {
    throw new Error(`Unable to resolve billing payer for workspace ${workspaceId}`)
  }

  return buildBillingAttributionSnapshot({
    actorUserId: payer.billedAccountUserId,
    workspaceId,
    ...payer,
  })
}

/**
 * Converts the serialized snapshot to the exact context consumed by usage
 * ledger writes.
 */
export function toBillingContext(attribution: BillingAttributionSnapshot): BillingContext {
  const validatedAttribution = assertBillingAttributionSnapshot(attribution)
  return {
    billingEntity: {
      type: validatedAttribution.billingEntity.type,
      id: validatedAttribution.billingEntity.id,
    },
    billingPeriod: {
      start: new Date(validatedAttribution.billingPeriod.start),
      end: new Date(validatedAttribution.billingPeriod.end),
      ...(validatedAttribution.billingPeriod.source
        ? { source: validatedAttribution.billingPeriod.source }
        : {}),
    },
  }
}

/**
 * Applies hosted freeze checks only to the actor's own user account and the
 * exact immutable workspace payer. Metered usage caps are intentionally absent
 * so BYOK and other exempt paths can still enforce account standing.
 */
export async function checkAttributedBillingBlocks(
  attribution: BillingAttributionSnapshot
): Promise<AttributedBillingBlockResult> {
  const validatedAttribution = assertBillingAttributionSnapshot(attribution)
  if (!isHosted || !isBillingEnabled) {
    return { blocked: false }
  }

  const actorBlock = await checkBillingBlocked(validatedAttribution.actorUserId)
  if (actorBlock.blocked) {
    return {
      blocked: true,
      message: actorBlock.message,
      scope: 'actor',
    }
  }

  const payerBlock =
    validatedAttribution.billingEntity.type === 'user' &&
    validatedAttribution.billingEntity.id === validatedAttribution.actorUserId
      ? actorBlock
      : await checkBillingEntityBlocked(validatedAttribution.billingEntity)
  if (payerBlock.blocked) {
    return {
      blocked: true,
      message: payerBlock.message,
      scope: 'payer',
    }
  }

  return { blocked: false }
}

/**
 * Applies hosted billing gates in canonical order: actor account, workspace
 * payer pool, then `(organizationId, actorUserId)` member cap.
 */
export async function checkAttributedUsageLimits(
  attribution: BillingAttributionSnapshot
): Promise<AttributedUsageLimitsResult> {
  const validatedAttribution = assertBillingAttributionSnapshot(attribution)
  if (!isHosted || !isBillingEnabled) {
    return { isExceeded: false }
  }

  const billingBlock = await checkAttributedBillingBlocks(validatedAttribution)
  if (billingBlock.blocked) {
    return {
      isExceeded: true,
      message: billingBlock.message,
      scope: billingBlock.scope,
    }
  }

  const payerUsage = await checkUsageStatus(
    validatedAttribution.billedAccountUserId,
    toUsageLimitSubscription(validatedAttribution)
  )
  const payerSnapshot = {
    currentUsage: payerUsage.currentUsage,
    limit: payerUsage.limit,
  }

  if (payerUsage.isExceeded) {
    const formattedUsage = payerUsage.currentUsage.toFixed(2)
    const formattedLimit = payerUsage.limit.toFixed(2)
    const message =
      validatedAttribution.billingEntity.type === 'organization'
        ? `Organization usage limit exceeded: $${formattedUsage} pooled of $${formattedLimit} organization limit. Ask a team admin to raise the organization usage limit to continue.`
        : `Usage limit exceeded: $${formattedUsage} used of $${formattedLimit} limit. Please upgrade your plan or raise your usage limit to continue.`

    return {
      isExceeded: true,
      message,
      scope: 'payer',
      payerUsage: payerSnapshot,
    }
  }

  if (validatedAttribution.organizationId) {
    const memberUsage = await checkOrganizationMemberUsageLimit(
      validatedAttribution.actorUserId,
      validatedAttribution.organizationId,
      {
        start: new Date(validatedAttribution.billingPeriod.start),
        end: new Date(validatedAttribution.billingPeriod.end),
        ...(validatedAttribution.billingPeriod.source
          ? { source: validatedAttribution.billingPeriod.source }
          : {}),
      }
    )
    if (memberUsage.isExceeded) {
      return {
        isExceeded: true,
        message: memberUsage.message,
        scope: 'member',
        payerUsage: payerSnapshot,
        memberUsage: {
          currentUsage: memberUsage.currentUsage,
          limit: memberUsage.limit,
        },
      }
    }

    return {
      isExceeded: false,
      payerUsage: payerSnapshot,
      memberUsage: {
        currentUsage: memberUsage.currentUsage,
        limit: memberUsage.limit,
      },
    }
  }

  return {
    isExceeded: false,
    payerUsage: payerSnapshot,
  }
}
