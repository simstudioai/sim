import { db } from '@sim/db'
import {
  billingClaim,
  billingClaimUsage,
  member,
  organization,
  subscription as subscriptionTable,
  usageLog,
  userStats,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { eq, inArray, type SQL, sql } from 'drizzle-orm'
import { BILLING_CLAIM_COVERED_OVERAGE_STATUSES } from '@/lib/billing/claims/status'
import { DAILY_REFRESH_RATE } from '@/lib/billing/constants'
import { getHighestPrioritySubscription } from '@/lib/billing/core/plan'
import {
  getPlanTierDollars,
  isPooledOrganizationPlan,
  sqlOrganizationSubscriptionOwnsMemberUsage,
} from '@/lib/billing/plan-helpers'
import {
  ENTITLED_SUBSCRIPTION_STATUSES,
  getPlanPricing,
  isOrgScopedSubscription,
} from '@/lib/billing/subscriptions/utils'
import { toDecimal, toNumber } from '@/lib/billing/utils/decimal'
import { OUTBOX_EVENT_TYPES } from '@/lib/billing/webhooks/outbox-types'
import { enqueueOutboxEvent } from '@/lib/core/outbox/service'

const logger = createLogger('UsageLedger')
const MS_PER_DAY = 86_400_000

export type BillingEntityType = 'user' | 'organization'
export type BillingClaimKind = 'threshold' | 'final'
type OrganizationUsageFallbackMode = 'none' | 'all-members' | 'billing-contacts'

interface SqlExecutor {
  execute(query: SQL): Promise<Iterable<Record<string, unknown>>>
}

export interface UsageBillingAttribution {
  entityType: BillingEntityType
  entityId: string
}

export interface UsageBillingContext {
  attribution: UsageBillingAttribution
  subscriptionId: string | null
}

export interface SubscriptionForLedger {
  id: string
  plan: string | null
  referenceId: string
  seats?: number | null
  periodStart?: Date | null
  periodEnd?: Date | null
  stripeCustomerId?: string | null
  stripeSubscriptionId?: string | null
}

export interface LedgerOverageSummary {
  entityType: BillingEntityType
  entityId: string
  periodStart: Date
  periodEnd: Date | null
  usageCutoff: Date | null
  billingPeriod: string
  grossUsage: number
  dailyRefreshDeduction: number
  effectiveUsage: number
  baseSubscriptionAmount: number
  legacyDepartedUsage: number
  totalOverage: number
}

export interface LedgerUsageSummary {
  entityType: BillingEntityType
  entityId: string
  periodStart: Date
  periodEnd: Date | null
  usageCutoff: Date | null
  billingPeriod: string
  grossUsage: number
  dailyRefreshDeduction: number
  effectiveUsage: number
  legacyDepartedUsage: number
  sourceTotals: Record<string, number>
  memberIds: string[]
}

export interface UserUsageActivitySummary {
  grossUsage: number
  sourceTotals: Record<string, number>
  totalTokens: number
  copilotTokens: number
  copilotCalls: number
}

export interface CreateOverageClaimParams {
  subscription: SubscriptionForLedger
  claimType: BillingClaimKind
  threshold?: number
  periodStart: Date
  periodEnd: Date
  usageCutoff: Date
  skipIfLocked?: boolean
  customerId?: string | null
  stripeSubscriptionId?: string | null
  description?: string
  itemDescription?: string
  metadata?: Record<string, string>
  enqueueStripeInvoice?: boolean
}

export interface OverageClaimResult {
  claimed: boolean
  lockSkipped?: boolean
  claimId?: string
  outboxEventId?: string
  amountToBill: number
  creditApplied: number
  overageAmount: number
  priorCoveredOverage: number
  grossUsage: number
  usageLogIds: string[]
}

export async function resolveUsageBillingAttribution(
  userId: string
): Promise<UsageBillingAttribution> {
  return (await resolveUsageBillingContext(userId)).attribution
}

export async function resolveUsageBillingContext(userId: string): Promise<UsageBillingContext> {
  const sub = await getHighestPrioritySubscription(userId)
  if (!sub) {
    return {
      attribution: { entityType: 'user', entityId: userId },
      subscriptionId: null,
    }
  }

  const orgScoped = isOrgScopedSubscription(sub, userId)
  return {
    attribution: {
      entityType: orgScoped ? 'organization' : 'user',
      entityId: sub.referenceId,
    },
    subscriptionId: sub.id,
  }
}

export async function attributeLegacyOrganizationUsageForPeriod(params: {
  executor?: SqlExecutor
  organizationId: string
  periodStart: Date
  periodEnd: Date | null
  usageCutoff?: Date | null
}): Promise<number> {
  const executor = params.executor ?? db
  const queryEnd = getQueryEnd(params.periodEnd, params.usageCutoff ?? null)
  const rows = await executeRows<{ id: string }>(
    executor,
    sql`
      UPDATE ${usageLog}
      SET
        ${usageLog.billingEntityType} = 'organization',
        ${usageLog.billingEntityId} = ${params.organizationId}
      FROM ${member}
      WHERE ${usageLog.userId} = ${member.userId}
        AND ${member.organizationId} = ${params.organizationId}
        AND ${usageLog.billingEntityType} IS NULL
        AND ${usageLog.createdAt} >= ${params.periodStart}
        AND ${usageLog.createdAt} >= ${member.createdAt}
        AND ${queryEnd ? sql`${usageLog.createdAt} < ${queryEnd}` : sql`TRUE`}
      RETURNING ${usageLog.id} AS id
    `
  )
  return rows.length
}

export async function calculateLedgerOverageForSubscription(
  sub: SubscriptionForLedger,
  executor: SqlExecutor = db,
  options: { periodStart?: Date | null; periodEnd?: Date | null; usageCutoff?: Date | null } = {}
): Promise<LedgerOverageSummary> {
  const { entityType, entityId } = await resolveBillingEntityForSubscription(sub, executor)
  const periodStart = options.periodStart ?? sub.periodStart ?? new Date(0)
  const periodEnd = options.periodEnd ?? sub.periodEnd ?? null
  const usageCutoff = options.usageCutoff ?? null

  const usage = await calculateLedgerUsageForBillingEntity({
    executor,
    entityType,
    entityId,
    periodStart,
    periodEnd,
    usageCutoff,
    plan: sub.plan,
    seats: sub.seats ?? 1,
  })

  const { basePrice } = getPlanPricing(sub.plan ?? '')
  const baseSubscriptionAmount = (sub.seats || 1) * basePrice
  const totalOverage = Math.max(0, usage.effectiveUsage - baseSubscriptionAmount)

  return {
    entityType: usage.entityType,
    entityId: usage.entityId,
    periodStart: usage.periodStart,
    periodEnd: usage.periodEnd,
    usageCutoff: usage.usageCutoff,
    billingPeriod: usage.billingPeriod,
    grossUsage: usage.grossUsage,
    dailyRefreshDeduction: usage.dailyRefreshDeduction,
    effectiveUsage: usage.effectiveUsage,
    baseSubscriptionAmount,
    legacyDepartedUsage: usage.legacyDepartedUsage,
    totalOverage,
  }
}

export async function calculateCurrentLedgerUsageForSubscription(
  sub: SubscriptionForLedger,
  executor: SqlExecutor = db,
  options: { periodStart?: Date | null; periodEnd?: Date | null; usageCutoff?: Date | null } = {}
): Promise<LedgerUsageSummary> {
  const { entityType, entityId } = await resolveBillingEntityForSubscription(sub, executor)
  return calculateLedgerUsageForBillingEntity({
    executor,
    entityType,
    entityId,
    periodStart: options.periodStart ?? sub.periodStart ?? new Date(0),
    periodEnd: options.periodEnd ?? sub.periodEnd ?? null,
    usageCutoff: options.usageCutoff ?? null,
    plan: sub.plan,
    seats: sub.seats ?? 1,
  })
}

export async function calculateCurrentLedgerUsageForUser(
  userId: string,
  sub: SubscriptionForLedger | null | undefined,
  executor: SqlExecutor = db,
  options: { periodStart?: Date | null; periodEnd?: Date | null; usageCutoff?: Date | null } = {}
): Promise<LedgerUsageSummary> {
  const orgScoped = isOrgScopedSubscription(sub, userId)
  return calculateLedgerUsageForBillingEntity({
    executor,
    entityType: orgScoped && sub ? 'organization' : 'user',
    entityId: orgScoped && sub ? sub.referenceId : userId,
    periodStart: options.periodStart ?? sub?.periodStart ?? new Date(0),
    periodEnd: options.periodEnd ?? sub?.periodEnd ?? null,
    usageCutoff: options.usageCutoff ?? null,
    plan: sub?.plan ?? null,
    seats: sub?.seats ?? 1,
  })
}

export async function calculateAllTimeUsageActivityForUser(
  userId: string,
  executor: SqlExecutor = db,
  options: {
    periodStart?: Date | null
    periodEnd?: Date | null
  } = {}
): Promise<UserUsageActivitySummary> {
  const periodStart = options.periodStart ?? new Date(0)
  const periodEnd = options.periodEnd ?? null

  const [summaryRows, sourceTotals] = await Promise.all([
    executeRows<{
      total: string
      total_tokens: string
      copilot_tokens: string
      copilot_calls: number
    }>(
      executor,
      sql`
        SELECT
          COALESCE(SUM(${usageLog.cost}), 0)::text AS total,
          COALESCE(SUM(
            COALESCE(NULLIF(${usageLog.metadata}->>'inputTokens', '')::numeric, 0) +
            COALESCE(NULLIF(${usageLog.metadata}->>'outputTokens', '')::numeric, 0)
          ), 0)::text AS total_tokens,
          COALESCE(SUM(
            CASE WHEN ${usageLog.source} IN ('copilot', 'mcp_copilot') THEN
              COALESCE(NULLIF(${usageLog.metadata}->>'inputTokens', '')::numeric, 0) +
              COALESCE(NULLIF(${usageLog.metadata}->>'outputTokens', '')::numeric, 0)
            ELSE 0 END
          ), 0)::text AS copilot_tokens,
          COUNT(*) FILTER (WHERE ${usageLog.source} IN ('copilot', 'mcp_copilot'))::int AS copilot_calls
        FROM ${usageLog}
        WHERE ${usageLog.userId} = ${userId}
          AND ${periodFilter(periodStart, periodEnd)}
      `
    ),
    sumUsageBySourceForUser({
      executor,
      userId,
      periodStart,
      periodEnd,
    }),
  ])

  return {
    grossUsage: toNumber(toDecimal(summaryRows[0]?.total ?? '0')),
    sourceTotals,
    totalTokens: Math.round(toNumber(toDecimal(summaryRows[0]?.total_tokens ?? '0'))),
    copilotTokens: Math.round(toNumber(toDecimal(summaryRows[0]?.copilot_tokens ?? '0'))),
    copilotCalls: Number(summaryRows[0]?.copilot_calls ?? 0),
  }
}

export async function calculateOrganizationMemberLedgerUsage(
  organizationId: string,
  options: { periodStart?: Date | null; periodEnd?: Date | null; memberIds?: string[] } = {},
  executor: SqlExecutor = db
): Promise<Record<string, number>> {
  if (options.memberIds && options.memberIds.length === 0) return {}
  if (!options.periodStart) {
    return Object.fromEntries((options.memberIds ?? []).map((memberId) => [memberId, 0]))
  }

  const periodStart = options.periodStart
  const memberIdFilter = options.memberIds
    ? sql`AND ${usageLog.userId} IN (${sql.join(
        options.memberIds.map((id) => sql`${id}`),
        sql`, `
      )})`
    : sql``
  const rows = await executeRows<{ user_id: string; total: string }>(
    executor,
    sql`
      SELECT ${usageLog.userId} AS user_id, COALESCE(SUM(${usageLog.cost}), 0)::text AS total
      FROM ${usageLog}
      INNER JOIN ${member}
        ON ${member.userId} = ${usageLog.userId}
        AND ${member.organizationId} = ${organizationId}
      WHERE ${periodFilter(periodStart, options.periodEnd ?? null)}
        ${memberIdFilter}
        AND (
          (${usageLog.billingEntityType} = 'organization' AND ${usageLog.billingEntityId} = ${organizationId})
          OR (${usageLog.billingEntityType} IS NULL AND ${usageLog.createdAt} >= ${member.createdAt})
        )
      GROUP BY ${usageLog.userId}
    `
  )

  return Object.fromEntries(rows.map((row) => [row.user_id, toNumber(toDecimal(row.total ?? '0'))]))
}

export async function createOverageBillingClaim(
  params: CreateOverageClaimParams
): Promise<OverageClaimResult> {
  return db.transaction(async (tx) => {
    const { entityType, entityId } = await resolveBillingEntityForSubscription(
      params.subscription,
      tx
    )
    const periodStart = params.periodStart
    const periodEnd = params.periodEnd
    const usageCutoff = params.usageCutoff
    if (!periodStart || !periodEnd || !usageCutoff) {
      throw new Error('Billing claim periodStart, periodEnd, and usageCutoff are required')
    }
    const lockKey = [
      'billing-claim',
      entityType,
      entityId,
      periodStart.toISOString(),
      periodEnd?.toISOString() ?? 'open',
    ].join(':')
    const lockRows = await executeRows<{ locked: boolean }>(
      tx,
      params.skipIfLocked
        ? sql`SELECT pg_try_advisory_xact_lock(hashtext(${lockKey})) AS locked`
        : sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey})) IS NULL AS locked`
    )
    if (params.skipIfLocked && !lockRows[0]?.locked) {
      return {
        claimed: false,
        lockSkipped: true,
        amountToBill: 0,
        creditApplied: 0,
        overageAmount: 0,
        priorCoveredOverage: 0,
        grossUsage: 0,
        usageLogIds: [],
      }
    }

    const summary = await calculateLedgerOverageForSubscription(params.subscription, tx, {
      periodStart,
      periodEnd,
      usageCutoff,
    })

    const ledgerCoveredOverage = await sumCoveredOverage({
      executor: tx,
      entityType: summary.entityType,
      entityId: summary.entityId,
      periodStart: summary.periodStart,
      periodEnd: summary.periodEnd,
    })
    const legacyCoveredOverage = await sumLegacyCoveredOverage({
      executor: tx,
      entityType: summary.entityType,
      entityId: summary.entityId,
    })
    const priorCoveredOverage = ledgerCoveredOverage + legacyCoveredOverage
    const overageAmount = Math.max(0, summary.totalOverage - priorCoveredOverage)
    if (overageAmount <= 0 || overageAmount < (params.threshold ?? 0)) {
      return {
        claimed: false,
        amountToBill: 0,
        creditApplied: 0,
        overageAmount,
        priorCoveredOverage,
        grossUsage: summary.grossUsage,
        usageLogIds: [],
      }
    }

    const includedAmount = summary.baseSubscriptionAmount + summary.dailyRefreshDeduction
    const departedOverageAmount = Math.max(0, summary.legacyDepartedUsage - includedAmount)
    const legacyDepartedClaimAmount = Math.min(
      overageAmount,
      Math.max(0, departedOverageAmount - priorCoveredOverage)
    )
    const currentUsageSkipAmount =
      Math.max(0, includedAmount - summary.legacyDepartedUsage) +
      Math.max(0, priorCoveredOverage - departedOverageAmount)
    const currentUsageTargetAmount = Math.max(0, overageAmount - legacyDepartedClaimAmount)

    const usageRows = await selectUsageRowsForClaim({
      executor: tx,
      entityType: summary.entityType,
      entityId: summary.entityId,
      periodStart: summary.periodStart,
      periodEnd: getQueryEnd(summary.periodEnd, summary.usageCutoff),
      organizationFallbackMode: getOrganizationUsageFallbackMode(
        summary.entityType,
        params.subscription.plan
      ),
    })
    const allocations = buildClaimUsageAllocations({
      rows: usageRows,
      skipAmount: currentUsageSkipAmount,
      targetAmount: currentUsageTargetAmount,
    })
    const allocatedOverageAmount = allocations.reduce(
      (total, allocation) => total + allocation.allocatedAmount,
      0
    )
    const claimOverageAmount = allocatedOverageAmount + legacyDepartedClaimAmount

    if (claimOverageAmount <= 0) {
      return {
        claimed: false,
        amountToBill: 0,
        creditApplied: 0,
        overageAmount,
        priorCoveredOverage,
        grossUsage: summary.grossUsage,
        usageLogIds: [],
      }
    }

    const creditApplied = await deductCredits({
      executor: tx,
      entityType: summary.entityType,
      entityId: summary.entityId,
      amount: claimOverageAmount,
    })
    const amountToBill = Math.max(0, claimOverageAmount - creditApplied)
    const claimId = generateId()
    const now = new Date()

    await tx.insert(billingClaim).values({
      id: claimId,
      entityType: summary.entityType,
      entityId: summary.entityId,
      subscriptionId: params.subscription.id,
      claimType: params.claimType,
      status: amountToBill > 0 ? 'claimed' : 'paid',
      billingPeriod: summary.billingPeriod,
      periodStart: summary.periodStart,
      periodEnd: summary.periodEnd,
      grossUsage: summary.grossUsage.toString(),
      dailyRefreshDeduction: summary.dailyRefreshDeduction.toString(),
      priorCoveredOverage: priorCoveredOverage.toString(),
      overageAmount: claimOverageAmount.toString(),
      creditApplied: creditApplied.toString(),
      amountToBill: amountToBill.toString(),
      stripeCustomerId: params.customerId ?? null,
      stripeSubscriptionId: params.stripeSubscriptionId ?? null,
      metadata: params.metadata ?? null,
      createdAt: now,
      updatedAt: now,
    })

    if (allocations.length > 0) {
      await tx.insert(billingClaimUsage).values(
        allocations.map((allocation) => ({
          id: generateId(),
          claimId,
          usageLogId: allocation.usageLogId,
          allocatedAmount: allocation.allocatedAmount.toString(),
        }))
      )
    }

    let outboxEventId: string | undefined
    if (params.enqueueStripeInvoice && amountToBill > 0) {
      if (!params.customerId || !params.stripeSubscriptionId) {
        throw new Error('Stripe customer and subscription ids are required for billable claims')
      }

      const amountCents = Math.round(amountToBill * 100)
      outboxEventId = await enqueueOutboxEvent(
        tx,
        OUTBOX_EVENT_TYPES.STRIPE_THRESHOLD_OVERAGE_INVOICE,
        {
          claimId,
          customerId: params.customerId,
          stripeSubscriptionId: params.stripeSubscriptionId,
          amountCents,
          description: params.description ?? `Usage overage - ${summary.billingPeriod}`,
          itemDescription: params.itemDescription ?? `Usage overage ($${amountToBill.toFixed(2)})`,
          billingPeriod: summary.billingPeriod,
          invoiceIdemKeyStem: `overage-invoice:${claimId}`,
          itemIdemKeyStem: `overage-item:${claimId}`,
          metadata: {
            type:
              params.claimType === 'threshold' ? 'overage_threshold_billing' : 'overage_billing',
            claimId,
            billingPeriod: summary.billingPeriod,
            entityType: summary.entityType,
            entityId: summary.entityId,
            ...(params.metadata ?? {}),
          },
        }
      )

      await tx
        .update(billingClaim)
        .set({ outboxEventId, updatedAt: new Date() })
        .where(eq(billingClaim.id, claimId))
    }

    logger.info('Created overage billing claim', {
      claimId,
      entityType: summary.entityType,
      entityId: summary.entityId,
      claimType: params.claimType,
      amountToBill,
      creditApplied,
      usageRows: allocations.length,
    })

    return {
      claimed: true,
      claimId,
      outboxEventId,
      amountToBill,
      creditApplied,
      overageAmount: claimOverageAmount,
      priorCoveredOverage,
      grossUsage: summary.grossUsage,
      usageLogIds: allocations.map((allocation) => allocation.usageLogId),
    }
  })
}

async function resolveBillingEntityForSubscription(
  sub: SubscriptionForLedger,
  executor: SqlExecutor
): Promise<{ entityType: BillingEntityType; entityId: string }> {
  const rows = await executeRows<{ id: string }>(
    executor,
    sql`SELECT id FROM organization WHERE id = ${sub.referenceId} LIMIT 1`
  )
  const isOrg = rows.length > 0
  return {
    entityType: isOrg ? 'organization' : 'user',
    entityId: sub.referenceId,
  }
}

async function calculateLedgerUsageForBillingEntity(params: {
  executor: SqlExecutor
  entityType: BillingEntityType
  entityId: string
  periodStart: Date
  periodEnd: Date | null
  usageCutoff: Date | null
  plan: string | null
  seats: number
}): Promise<LedgerUsageSummary> {
  const queryEnd = getQueryEnd(params.periodEnd, params.usageCutoff)
  const organizationFallbackMode = getOrganizationUsageFallbackMode(params.entityType, params.plan)
  const [grossUsage, dailyRefreshDeduction, sourceTotals, memberIds] = await Promise.all([
    sumUsageForBillingEntity({
      executor: params.executor,
      entityType: params.entityType,
      entityId: params.entityId,
      periodStart: params.periodStart,
      periodEnd: queryEnd,
      organizationFallbackMode,
    }),
    computeBillingEntityDailyRefresh({
      executor: params.executor,
      entityType: params.entityType,
      entityId: params.entityId,
      periodStart: params.periodStart,
      periodEnd: queryEnd,
      plan: params.plan,
      seats: params.seats,
      organizationFallbackMode,
    }),
    sumUsageBySourceForBillingEntity({
      executor: params.executor,
      entityType: params.entityType,
      entityId: params.entityId,
      periodStart: params.periodStart,
      periodEnd: queryEnd,
      organizationFallbackMode,
    }),
    getBillingEntityMemberIds(
      params.executor,
      params.entityType,
      params.entityId,
      organizationFallbackMode
    ),
  ])
  const departedMemberUsage =
    params.entityType === 'organization' && organizationFallbackMode === 'all-members'
      ? await getDepartedMemberUsage(params.executor, params.entityId)
      : 0
  const totalGrossUsage = grossUsage + departedMemberUsage

  return {
    entityType: params.entityType,
    entityId: params.entityId,
    periodStart: params.periodStart,
    periodEnd: params.periodEnd,
    usageCutoff: params.usageCutoff,
    billingPeriod: getBillingPeriod(params.periodEnd),
    grossUsage: totalGrossUsage,
    dailyRefreshDeduction,
    effectiveUsage: Math.max(0, totalGrossUsage - dailyRefreshDeduction),
    legacyDepartedUsage: departedMemberUsage,
    sourceTotals,
    memberIds,
  }
}

function getBillingPeriod(periodEnd: Date | null): string {
  const anchor = periodEnd ?? new Date()
  return anchor.toISOString().slice(0, 7)
}

function getQueryEnd(periodEnd: Date | null, usageCutoff: Date | null): Date | null {
  if (!periodEnd) return usageCutoff
  if (!usageCutoff) return periodEnd
  return usageCutoff < periodEnd ? usageCutoff : periodEnd
}

function billingEntityFilter(
  entityType: BillingEntityType,
  entityId: string,
  organizationFallbackMode: OrganizationUsageFallbackMode
): SQL {
  const attributed = sql`(${usageLog.billingEntityType} = ${entityType} AND ${usageLog.billingEntityId} = ${entityId})`
  if (entityType === 'user') {
    return sql`(${attributed} OR (
      ${usageLog.billingEntityType} IS NULL
      AND ${usageLog.userId} = ${entityId}
      AND NOT EXISTS (
        SELECT 1
        FROM ${member}
        INNER JOIN ${subscriptionTable}
          ON ${subscriptionTable.referenceId} = ${member.organizationId}
          AND ${inArray(subscriptionTable.status, ENTITLED_SUBSCRIPTION_STATUSES)}
          AND ${sqlOrganizationSubscriptionOwnsMemberUsage(subscriptionTable.plan, member.role)}
        WHERE ${member.userId} = ${usageLog.userId}
          AND ${usageLog.createdAt} >= ${member.createdAt}
          AND ${subscriptionTable.periodStart} IS NOT NULL
          AND ${usageLog.createdAt} >= ${subscriptionTable.periodStart}
          AND (${subscriptionTable.periodEnd} IS NULL OR ${usageLog.createdAt} < ${subscriptionTable.periodEnd})
      )
    ))`
  }
  if (organizationFallbackMode === 'none') {
    return attributed
  }
  const roleFilter =
    organizationFallbackMode === 'billing-contacts'
      ? sql`AND (${member.role} = 'owner' OR ${member.role} = 'admin')`
      : sql``
  return sql`(${attributed} OR (${usageLog.billingEntityType} IS NULL AND EXISTS (
    SELECT 1
    FROM ${member}
    WHERE ${member.organizationId} = ${entityId}
      AND ${member.userId} = ${usageLog.userId}
      AND ${usageLog.createdAt} >= ${member.createdAt}
      ${roleFilter}
  )))`
}

function getOrganizationUsageFallbackMode(
  entityType: BillingEntityType,
  plan: string | null | undefined
): OrganizationUsageFallbackMode {
  if (entityType !== 'organization') return 'none'
  if (isPooledOrganizationPlan(plan)) return 'all-members'
  if (plan === 'pro' || plan?.startsWith('pro_')) return 'billing-contacts'
  return 'none'
}

function periodFilter(periodStart: Date, periodEnd: Date | null): SQL {
  return periodEnd
    ? sql`${usageLog.createdAt} >= ${periodStart} AND ${usageLog.createdAt} < ${periodEnd}`
    : sql`${usageLog.createdAt} >= ${periodStart}`
}

async function sumUsageForBillingEntity(params: {
  executor: SqlExecutor
  entityType: BillingEntityType
  entityId: string
  periodStart: Date
  periodEnd: Date | null
  organizationFallbackMode: OrganizationUsageFallbackMode
}): Promise<number> {
  const rows = await executeRows<{ total: string }>(
    params.executor,
    sql`
    SELECT COALESCE(SUM(${usageLog.cost}), 0)::text AS total
    FROM ${usageLog}
    WHERE ${billingEntityFilter(
      params.entityType,
      params.entityId,
      params.organizationFallbackMode
    )}
      AND ${periodFilter(params.periodStart, params.periodEnd)}
  `
  )
  return toNumber(toDecimal(rows[0]?.total ?? '0'))
}

async function sumUsageBySourceForBillingEntity(params: {
  executor: SqlExecutor
  entityType: BillingEntityType
  entityId: string
  periodStart: Date
  periodEnd: Date | null
  organizationFallbackMode: OrganizationUsageFallbackMode
}): Promise<Record<string, number>> {
  const rows = await executeRows<{ source: string; total: string }>(
    params.executor,
    sql`
    SELECT ${usageLog.source}::text AS source, COALESCE(SUM(${usageLog.cost}), 0)::text AS total
    FROM ${usageLog}
    WHERE ${billingEntityFilter(
      params.entityType,
      params.entityId,
      params.organizationFallbackMode
    )}
      AND ${periodFilter(params.periodStart, params.periodEnd)}
    GROUP BY ${usageLog.source}
  `
  )

  return Object.fromEntries(rows.map((row) => [row.source, toNumber(toDecimal(row.total ?? '0'))]))
}

async function sumUsageBySourceForUser(params: {
  executor: SqlExecutor
  userId: string
  periodStart: Date
  periodEnd: Date | null
}): Promise<Record<string, number>> {
  const rows = await executeRows<{ source: string; total: string }>(
    params.executor,
    sql`
    SELECT ${usageLog.source}::text AS source, COALESCE(SUM(${usageLog.cost}), 0)::text AS total
    FROM ${usageLog}
    WHERE ${usageLog.userId} = ${params.userId}
      AND ${periodFilter(params.periodStart, params.periodEnd)}
    GROUP BY ${usageLog.source}
  `
  )

  return Object.fromEntries(rows.map((row) => [row.source, toNumber(toDecimal(row.total ?? '0'))]))
}

async function getBillingEntityMemberIds(
  executor: SqlExecutor,
  entityType: BillingEntityType,
  entityId: string,
  organizationFallbackMode: OrganizationUsageFallbackMode
): Promise<string[]> {
  if (entityType === 'user') return [entityId]

  const roleFilter =
    organizationFallbackMode === 'billing-contacts'
      ? sql`AND (${member.role} = 'owner' OR ${member.role} = 'admin')`
      : sql``
  const rows = await executeRows<{ user_id: string }>(
    executor,
    sql`
    SELECT ${member.userId} AS user_id
    FROM ${member}
    WHERE ${member.organizationId} = ${entityId}
      ${roleFilter}
  `
  )
  return rows.map((row) => row.user_id)
}

async function getDepartedMemberUsage(
  executor: SqlExecutor,
  organizationId: string
): Promise<number> {
  const rows = await executeRows<{ departed_member_usage: string }>(
    executor,
    sql`
    SELECT ${organization.departedMemberUsage}::text AS departed_member_usage
    FROM ${organization}
    WHERE ${organization.id} = ${organizationId}
    LIMIT 1
  `
  )
  return toNumber(toDecimal(rows[0]?.departed_member_usage ?? '0'))
}

async function computeBillingEntityDailyRefresh(params: {
  executor: SqlExecutor
  entityType: BillingEntityType
  entityId: string
  periodStart: Date
  periodEnd: Date | null
  plan: string | null
  seats: number
  organizationFallbackMode: OrganizationUsageFallbackMode
}): Promise<number> {
  const planDollars = getPlanTierDollars(params.plan)
  if (planDollars <= 0) return 0

  const now = new Date()
  const cap = params.periodEnd && params.periodEnd < now ? params.periodEnd : now
  if (cap <= params.periodStart) return 0

  const dayCount = Math.ceil((cap.getTime() - params.periodStart.getTime()) / MS_PER_DAY)
  if (dayCount <= 0) return 0

  const periodStartSeconds = Math.floor(params.periodStart.getTime() / 1000)
  const rows = await executeRows<{ day_total: string }>(
    params.executor,
    sql`
    SELECT COALESCE(SUM(${usageLog.cost}), 0)::text AS day_total
    FROM ${usageLog}
    WHERE ${billingEntityFilter(
      params.entityType,
      params.entityId,
      params.organizationFallbackMode
    )}
      AND ${usageLog.createdAt} >= ${params.periodStart}
      AND ${usageLog.createdAt} < ${cap}
    GROUP BY FLOOR((EXTRACT(EPOCH FROM ${usageLog.createdAt}) - ${periodStartSeconds}) / 86400)
  `
  )

  const dailyRefreshDollars = planDollars * DAILY_REFRESH_RATE * params.seats
  return rows.reduce((total, row) => {
    const dayUsage = toNumber(toDecimal(row.day_total ?? '0'))
    return total + Math.min(dayUsage, dailyRefreshDollars)
  }, 0)
}

async function sumCoveredOverage(params: {
  executor: SqlExecutor
  entityType: BillingEntityType
  entityId: string
  periodStart: Date
  periodEnd: Date | null
}): Promise<number> {
  const rows = await executeRows<{ total: string }>(
    params.executor,
    sql`
    SELECT COALESCE(SUM(${billingClaim.amountToBill} + ${billingClaim.creditApplied}), 0)::text AS total
    FROM ${billingClaim}
    WHERE ${billingClaim.entityType} = ${params.entityType}
      AND ${billingClaim.entityId} = ${params.entityId}
      AND ${inArray(billingClaim.status, BILLING_CLAIM_COVERED_OVERAGE_STATUSES)}
      AND ${billingClaim.periodStart} = ${params.periodStart}
      AND ${billingClaim.periodEnd} IS NOT DISTINCT FROM ${params.periodEnd}
  `
  )
  return toNumber(toDecimal(rows[0]?.total ?? '0'))
}

async function sumLegacyCoveredOverage(params: {
  executor: SqlExecutor
  entityType: BillingEntityType
  entityId: string
}): Promise<number> {
  const rows =
    params.entityType === 'organization'
      ? await executeRows<{ total: string }>(
          params.executor,
          sql`
            SELECT COALESCE(MAX(${userStats.billedOverageThisPeriod}), 0)::text AS total
            FROM ${member}
            INNER JOIN ${userStats} ON ${userStats.userId} = ${member.userId}
            WHERE ${member.organizationId} = ${params.entityId}
              AND ${member.role} = 'owner'
          `
        )
      : await executeRows<{ total: string }>(
          params.executor,
          sql`
            SELECT COALESCE(${userStats.billedOverageThisPeriod}, 0)::text AS total
            FROM ${userStats}
            WHERE ${userStats.userId} = ${params.entityId}
            LIMIT 1
          `
        )

  return toNumber(toDecimal(rows[0]?.total ?? '0'))
}

async function selectUsageRowsForClaim(params: {
  executor: SqlExecutor
  entityType: BillingEntityType
  entityId: string
  periodStart: Date
  periodEnd: Date | null
  organizationFallbackMode: OrganizationUsageFallbackMode
}): Promise<{ id: string; cost: string; allocatedAmount: string }[]> {
  const rows = await executeRows<{ id: string; cost: string; allocated_amount: string }>(
    params.executor,
    sql`
    SELECT
      ${usageLog.id} AS id,
      ${usageLog.cost}::text AS cost,
      COALESCE((
        SELECT SUM(${billingClaimUsage.allocatedAmount})
        FROM ${billingClaimUsage}
        INNER JOIN ${billingClaim} ON ${billingClaim.id} = ${billingClaimUsage.claimId}
        WHERE ${billingClaimUsage.usageLogId} = ${usageLog.id}
          AND ${inArray(billingClaim.status, BILLING_CLAIM_COVERED_OVERAGE_STATUSES)}
      ), 0)::text AS allocated_amount
    FROM ${usageLog}
    WHERE ${billingEntityFilter(
      params.entityType,
      params.entityId,
      params.organizationFallbackMode
    )}
      AND ${periodFilter(params.periodStart, params.periodEnd)}
    ORDER BY ${usageLog.createdAt}, ${usageLog.id}
    FOR UPDATE OF ${usageLog} SKIP LOCKED
  `
  )
  return rows.map((row) => ({
    id: row.id,
    cost: row.cost,
    allocatedAmount: row.allocated_amount,
  }))
}

function buildClaimUsageAllocations(params: {
  rows: { id: string; cost: string; allocatedAmount: string }[]
  skipAmount: number
  targetAmount: number
}): { usageLogId: string; allocatedAmount: number }[] {
  const allocations: { usageLogId: string; allocatedAmount: number }[] = []
  let remainingSkip = params.skipAmount
  let remainingTarget = params.targetAmount

  for (const row of params.rows) {
    if (remainingTarget <= 0) break

    const rowCost = toNumber(toDecimal(row.cost))
    if (rowCost <= 0) continue

    const rowAlreadyAllocated = toNumber(toDecimal(row.allocatedAmount))
    const rowSkipAmount = Math.max(remainingSkip, rowAlreadyAllocated)

    if (rowSkipAmount >= rowCost) {
      remainingSkip = Math.max(0, remainingSkip - rowCost)
      continue
    }

    const claimableAmount = rowCost - Math.max(0, rowSkipAmount)
    remainingSkip = 0

    const allocatedAmount = Math.min(claimableAmount, remainingTarget)
    if (allocatedAmount <= 0) continue

    allocations.push({ usageLogId: row.id, allocatedAmount })
    remainingTarget -= allocatedAmount
  }

  return allocations
}

async function deductCredits(params: {
  executor: SqlExecutor
  entityType: BillingEntityType
  entityId: string
  amount: number
}): Promise<number> {
  if (params.amount <= 0) return 0
  const amount = params.amount.toString()
  const table = params.entityType === 'organization' ? organization : userStats
  const idColumn = params.entityType === 'organization' ? organization.id : userStats.userId
  const result = await executeRows<{ old_balance: string }>(
    params.executor,
    sql`
    WITH old_balance AS (
      SELECT ${table.creditBalance} AS credit_balance
      FROM ${table}
      WHERE ${idColumn} = ${params.entityId}
      FOR UPDATE
    )
    UPDATE ${table}
    SET credit_balance = CASE
      WHEN credit_balance >= ${amount}::decimal THEN credit_balance - ${amount}::decimal
      ELSE 0
    END
    WHERE ${idColumn} = ${params.entityId}
    RETURNING (SELECT credit_balance FROM old_balance)::text AS old_balance
  `
  )
  const oldBalance = toNumber(toDecimal(result[0]?.old_balance ?? '0'))
  return Math.min(oldBalance, params.amount)
}

async function executeRows<T extends Record<string, unknown>>(
  executor: SqlExecutor,
  query: SQL
): Promise<T[]> {
  const rows = await executor.execute(query)
  return Array.from(rows) as T[]
}
