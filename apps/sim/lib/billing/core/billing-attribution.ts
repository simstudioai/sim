import { db } from '@sim/db'
import { workspace } from '@sim/db/schema'
import { generateId, isValidUuid } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import { eq } from 'drizzle-orm'
import {
  checkBillingBlocked,
  checkBillingEntityBlocked,
  checkOrganizationMemberUsageLimit,
  checkUsageStatus,
} from '@/lib/billing/calculations/usage-monitor'
import { getOrganizationSubscription } from '@/lib/billing/core/billing'
import { defaultBillingPeriod } from '@/lib/billing/core/billing-period'
import { getHighestPriorityPersonalSubscription } from '@/lib/billing/core/plan'
import type { BillingContext, BillingEntity } from '@/lib/billing/core/usage-log'
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
}

export interface BillingPeriodSnapshot {
  readonly start: string
  readonly end: string
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
  readonly workspaceId: string
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

  return Object.freeze({
    id: subscription.id,
    referenceId: subscription.referenceId,
    plan: subscription.plan,
    status: subscription.status,
    seats: subscription.seats ?? null,
    periodStart: subscription.periodStart?.toISOString() ?? null,
    periodEnd: subscription.periodEnd?.toISOString() ?? null,
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
    !isNonEmptyString(raw.workspaceId) ||
    !isNonEmptyString(raw.billedAccountUserId)
  ) {
    throw new Error('Billing attribution snapshot is missing actor, workspace, or billed account')
  }
  if (raw.organizationId !== null && !isNonEmptyString(raw.organizationId)) {
    throw new Error('Billing attribution organization must be a non-empty string or null')
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

    payerSubscription = {
      id: subscription.id,
      referenceId: subscription.referenceId,
      plan: subscription.plan,
      status: subscription.status as string | null,
      seats: subscription.seats as number | null,
      periodStart: subscriptionStart?.toISOString() ?? null,
      periodEnd: subscriptionEnd?.toISOString() ?? null,
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

function parseBillingAttributionHeader(
  headers: Pick<Headers, 'get'>,
  expected: ResolveBillingAttributionParams
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

  const attribution = assertBillingAttributionSnapshot(parsed)
  if (
    attribution.actorUserId !== expected.actorUserId ||
    attribution.workspaceId !== expected.workspaceId
  ) {
    throw new Error('Billing attribution header does not match the authenticated request scope')
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
  expected: ResolveBillingAttributionParams
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

  return Object.freeze({
    userId: value.userId,
    billingEntity: Object.freeze({
      type: value.billingEntity.type,
      id: value.billingEntity.id,
    }),
    billingPeriod: Object.freeze({
      start: start.toISOString(),
      end: end.toISOString(),
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

function toUsageSubscription(attribution: BillingAttributionSnapshot) {
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
  }
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
  workspaceId: string
  billedAccountUserId: string
  organizationId: string | null
  payerSubscription: ResolvedPayerSubscription
}): BillingAttributionSnapshot {
  const { actorUserId, workspaceId, billedAccountUserId, organizationId, payerSubscription } =
    params
  const period =
    payerSubscription?.periodStart && payerSubscription.periodEnd
      ? { start: payerSubscription.periodStart, end: payerSubscription.periodEnd }
      : defaultBillingPeriod()
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

/**
 * Resolves markerless old-Go (`legacy-v0`) traffic from the workspace visible
 * at this request boundary, falling back to account billing when the workspace
 * is absent from this Sim deployment.
 *
 * Unlike modern attributed-v1/direct-v1 envelopes, this decision is mutable:
 * old Go allocates its callback billing ID after admission and returns no payer
 * material, so admission and callback must independently resolve current state.
 * Keep this compatibility semantic confined to markerless legacy-v0 paths.
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
    toUsageSubscription(validatedAttribution)
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
