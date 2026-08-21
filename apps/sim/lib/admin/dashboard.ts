import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import {
  member,
  organization,
  organizationMemberUsageLimit,
  outboxEvent,
  permissions,
  subscription,
  usageLog,
  user,
  userStats,
  workspace,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import {
  and,
  count,
  countDistinct,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lt,
  notExists,
  or,
  sql,
} from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import {
  getOrganizationUsageLimitFallbackDollars,
  getTeamOrganizationEconomics,
} from '@/lib/admin/organization-economics'
import { parseBillingConcurrencyLimit } from '@/lib/billing/concurrency-defaults'
import { getBillingConcurrencyLimit } from '@/lib/billing/concurrency-limits'
import { getHighestPrioritySubscription } from '@/lib/billing/core/plan'
import {
  type ResolvedUsagePeriod,
  resolveEnterpriseReportingPeriod,
  resolveSubscriptionUsagePeriodOrDefault,
} from '@/lib/billing/core/reporting-period'
import { creditsToDollars, dollarsToCredits } from '@/lib/billing/credits/conversion'
import {
  ENTERPRISE_METADATA_SYNC_EVENT_TYPE,
  enterpriseMetadataSyncPayloadSchema,
  resolveEnterpriseMetadataIntent,
} from '@/lib/billing/enterprise-outbox'
import {
  type EnterpriseProvisioningView,
  getLatestEnterpriseProvisionings,
} from '@/lib/billing/enterprise-provisioning'
import {
  parseWorkflowExecutionTimeoutSeconds,
  resolveEnterpriseWorkflowExecutionTimeoutFallbackSeconds,
} from '@/lib/billing/execution-timeout-defaults'
import { acquireUserBillingIdentityLock } from '@/lib/billing/organizations/billing-identity-lock'
import { setOrgMemberUsageLimit } from '@/lib/billing/organizations/member-limits'
import {
  acquireOrganizationMutationLock,
  getOrganizationTransferCredentialDependencies,
  removeUserFromOrganization,
  transferOrganizationOwnership,
} from '@/lib/billing/organizations/membership'
import { reconcileOrganizationSeats } from '@/lib/billing/organizations/seats'
import {
  ENTITLED_SUBSCRIPTION_STATUSES,
  getPerUserMinimumLimit,
  hasPaidSubscriptionStatus,
  isOrgScopedSubscription,
} from '@/lib/billing/subscriptions/utils'
import { toDecimal } from '@/lib/billing/utils/decimal'
import { countPendingSeatInvitations } from '@/lib/billing/validation/seat-management'
import { env } from '@/lib/core/config/env'
import { executeTransactionallyIdempotent } from '@/lib/core/idempotency/transaction'
import { enqueueOutboxEvent } from '@/lib/core/outbox/service'
import type { DbOrTx } from '@/lib/db/types'
import { ownedAttachableWorkspacesWhere } from '@/lib/workspaces/organization-workspaces'

interface PaginationInput {
  search: string
  limit: number
  offset: number
}

const MAX_ADMIN_MEMBER_WORKSPACE_SELECTION = 1_000

export interface AdminMutationActor {
  id: string | null
  name: string
  email: string | null
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return isRecordLike(value) ? (value as Record<string, unknown>) : {}
}

function metadataNumber(metadata: Record<string, unknown>, key: string): number | null {
  const value = metadata[key]
  const numeric =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isFinite(numeric) ? numeric : null
}

async function enqueueEnterpriseMetadataIntent(
  tx: DbOrTx,
  params: {
    subscriptionId: string
    appliedMetadata: unknown
    buildDesiredMetadata: (current: Record<string, unknown>) => Record<string, unknown>
    terms?: { invoiceAmountCents: number; billingInterval: 'month' | 'year' } | null
  }
): Promise<{ version: number; desiredMetadata: Record<string, unknown> }> {
  const intent = await resolveEnterpriseMetadataIntent(
    tx,
    params.subscriptionId,
    params.appliedMetadata
  )
  if (intent.hasUnappliedIntent) {
    throw new Error(
      intent.configurationUpdate?.providerAccepted
        ? 'Stripe accepted the previous Enterprise update, but Sim has not reconciled it. Retry that update before making another change.'
        : 'An Enterprise configuration update is already in progress. Wait for it to apply before making another change.'
    )
  }
  const {
    simConfigRevision: _appliedRevision,
    simConfigOperationId: _appliedOperationId,
    simConfigDeliveryRevision: _appliedDeliveryRevision,
    simConfigDeliveryAttempt: _appliedDeliveryAttempt,
    ...current
  } = {
    ...intent.desiredMetadata,
  }
  const desiredMetadata = params.buildDesiredMetadata(current)
  const desiredTerms = params.terms === undefined ? intent.desiredTerms : params.terms
  const version = intent.latestRevision + 1

  await enqueueOutboxEvent(tx, ENTERPRISE_METADATA_SYNC_EVENT_TYPE, {
    subscriptionId: params.subscriptionId,
    revision: version,
    deliveryRevision: 0,
    metadata: desiredMetadata,
    ...(desiredTerms ? { terms: desiredTerms } : {}),
  })
  return { version, desiredMetadata }
}

function planLabel(plan: string | null): string {
  if (!plan) return 'No plan'
  if (plan === 'enterprise') return 'Enterprise'
  if (plan === 'team_6000') return 'Pro'
  if (plan === 'team_25000') return 'Max'
  return plan
}

async function getLatestSubscription(organizationId: string) {
  const [row] = await db
    .select()
    .from(subscription)
    .where(eq(subscription.referenceId, organizationId))
    .orderBy(
      sql`case when ${subscription.status} in ('active', 'past_due') then 0 else 1 end`,
      sql`coalesce(${subscription.endedAt}, ${subscription.canceledAt}, ${subscription.periodEnd}, ${subscription.periodStart}) desc nulls last`,
      desc(subscription.id)
    )
    .limit(1)
  return row ?? null
}

interface DashboardOrganizationSummaryInput {
  org: Pick<typeof organization.$inferSelect, 'id' | 'name' | 'orgUsageLimit' | 'creditBalance'>
  memberCount: number
  externalCollaboratorCount: number
  latestSubscription: typeof subscription.$inferSelect | null
  provisioning: EnterpriseProvisioningView | null
  owner: { id: string; name: string; email: string } | null
  usageDollars: number
  workflowRuns: number
  usagePeriod: ResolvedUsagePeriod
}

interface DashboardOrganizationUsageContext {
  organizationId: string
  period: ResolvedUsagePeriod
}

interface DashboardOrganizationUsage {
  total: number
  byUser: Map<string, number>
  workflowRuns: number
  workflowRunsByUser: Map<string, number>
}

function resolveDashboardUsagePeriod(
  latestSubscription: typeof subscription.$inferSelect | null
): ResolvedUsagePeriod {
  return resolveSubscriptionUsagePeriodOrDefault(latestSubscription ?? {})
}

async function getDashboardOrganizationUsage(
  contexts: DashboardOrganizationUsageContext[],
  options: { includeUserBreakdown?: boolean; userIds?: string[] } = {}
): Promise<Map<string, DashboardOrganizationUsage>> {
  const result = new Map<string, DashboardOrganizationUsage>()
  for (const context of contexts) {
    result.set(context.organizationId, {
      total: 0,
      byUser: new Map(),
      workflowRuns: 0,
      workflowRunsByUser: new Map(),
    })
  }
  if (contexts.length === 0) return result

  const includeUserBreakdown = options.includeUserBreakdown ?? true
  if (options.userIds?.length === 0) return result
  const ledgerPeriodWhere = or(
    ...contexts.map((context) =>
      and(
        eq(usageLog.billingEntityType, 'organization'),
        eq(usageLog.billingEntityId, context.organizationId),
        ...(context.period.source === 'reporting'
          ? [
              gte(usageLog.createdAt, context.period.start),
              lt(usageLog.createdAt, context.period.end),
            ]
          : [
              eq(usageLog.billingPeriodStart, context.period.start),
              eq(usageLog.billingPeriodEnd, context.period.end),
            ])
      )
    )
  )

  if (!includeUserBreakdown) {
    const ledgerTotals = await db
      .select({
        organizationId: usageLog.billingEntityId,
        cost: sql<string>`coalesce(sum(${usageLog.cost}), 0)`,
        workflowRuns:
          sql<number>`count(distinct ${usageLog.executionId}) filter (where ${usageLog.source} = 'workflow')`.mapWith(
            Number
          ),
      })
      .from(usageLog)
      .where(ledgerPeriodWhere)
      .groupBy(usageLog.billingEntityId)
    for (const row of ledgerTotals) {
      if (!row.organizationId) continue
      const usage = result.get(row.organizationId)
      if (usage) {
        usage.total += Number(row.cost)
        usage.workflowRuns += row.workflowRuns
      }
    }

    const legacyOrganizationIds = contexts
      .filter((context) => context.period.source !== 'reporting')
      .map((context) => context.organizationId)
    if (legacyOrganizationIds.length > 0) {
      const baselineTotals = await db
        .select({
          organizationId: member.organizationId,
          cost: sql<string>`coalesce(sum(${userStats.currentPeriodCost}), 0)`,
        })
        .from(member)
        .leftJoin(userStats, eq(userStats.userId, member.userId))
        .where(inArray(member.organizationId, legacyOrganizationIds))
        .groupBy(member.organizationId)
      for (const row of baselineTotals) {
        const usage = result.get(row.organizationId)
        if (usage) usage.total += Number(row.cost)
      }
    }
    return result
  }

  const ledgerRows = await db
    .select({
      organizationId: usageLog.billingEntityId,
      userId: usageLog.userId,
      cost: sql<string>`coalesce(sum(${usageLog.cost}), 0)`,
      workflowRuns:
        sql<number>`count(distinct ${usageLog.executionId}) filter (where ${usageLog.source} = 'workflow')`.mapWith(
          Number
        ),
    })
    .from(usageLog)
    .where(
      options.userIds
        ? and(ledgerPeriodWhere, inArray(usageLog.userId, options.userIds))
        : ledgerPeriodWhere
    )
    .groupBy(usageLog.billingEntityId, usageLog.userId)

  for (const row of ledgerRows) {
    if (!row.organizationId) continue
    const usage = result.get(row.organizationId)
    if (!usage) continue
    const amount = Number(row.cost)
    usage.total += amount
    usage.byUser.set(row.userId, (usage.byUser.get(row.userId) ?? 0) + amount)
    usage.workflowRuns += row.workflowRuns
    usage.workflowRunsByUser.set(
      row.userId,
      (usage.workflowRunsByUser.get(row.userId) ?? 0) + row.workflowRuns
    )
  }

  const legacyOrganizationIds = contexts
    .filter((context) => context.period.source !== 'reporting')
    .map((context) => context.organizationId)
  if (legacyOrganizationIds.length > 0) {
    const baselineRows = await db
      .select({
        organizationId: member.organizationId,
        userId: member.userId,
        cost: userStats.currentPeriodCost,
      })
      .from(member)
      .leftJoin(userStats, eq(userStats.userId, member.userId))
      .where(
        options.userIds
          ? and(
              inArray(member.organizationId, legacyOrganizationIds),
              inArray(member.userId, options.userIds)
            )
          : inArray(member.organizationId, legacyOrganizationIds)
      )
    for (const row of baselineRows) {
      const usage = result.get(row.organizationId)
      if (!usage) continue
      const amount = Number(row.cost ?? 0)
      usage.total += amount
      usage.byUser.set(row.userId, (usage.byUser.get(row.userId) ?? 0) + amount)
    }
  }
  return result
}

const historicalUsageMember = alias(member, 'historical_usage_member')
const historicalUsagePermission = alias(permissions, 'historical_usage_permission')
const historicalUsageWorkspace = alias(workspace, 'historical_usage_workspace')

async function getHistoricalActorUsage(
  organizationId: string,
  period: ResolvedUsagePeriod
): Promise<{ usedDollars: number; usedCredits: number; workflowRuns: number; actorCount: number }> {
  const currentMember = db
    .select({ value: sql`1` })
    .from(historicalUsageMember)
    .where(
      and(
        eq(historicalUsageMember.organizationId, organizationId),
        eq(historicalUsageMember.userId, usageLog.userId)
      )
    )
  const currentCollaborator = db
    .select({ value: sql`1` })
    .from(historicalUsagePermission)
    .innerJoin(
      historicalUsageWorkspace,
      and(
        eq(historicalUsagePermission.entityType, 'workspace'),
        eq(historicalUsagePermission.entityId, historicalUsageWorkspace.id)
      )
    )
    .where(
      and(
        eq(historicalUsageWorkspace.organizationId, organizationId),
        eq(historicalUsagePermission.userId, usageLog.userId)
      )
    )
  const [row] = await db
    .select({
      usedDollars: sql<string>`coalesce(sum(${usageLog.cost}), 0)`,
      workflowRuns:
        sql<number>`count(distinct ${usageLog.executionId}) filter (where ${usageLog.source} = 'workflow')`.mapWith(
          Number
        ),
      actorCount: countDistinct(usageLog.userId),
    })
    .from(usageLog)
    .where(
      and(
        eq(usageLog.billingEntityType, 'organization'),
        eq(usageLog.billingEntityId, organizationId),
        ...(period.source === 'reporting'
          ? [gte(usageLog.createdAt, period.start), lt(usageLog.createdAt, period.end)]
          : [
              eq(usageLog.billingPeriodStart, period.start),
              eq(usageLog.billingPeriodEnd, period.end),
            ]),
        notExists(currentMember),
        notExists(currentCollaborator)
      )
    )
  const usedDollars = Number(row?.usedDollars ?? 0)
  return {
    usedDollars,
    usedCredits: dollarsToCredits(usedDollars),
    workflowRuns: row?.workflowRuns ?? 0,
    actorCount: row?.actorCount ?? 0,
  }
}

export function toDashboardProvisioning(view: EnterpriseProvisioningView) {
  const { usageLimitCredits, ...rest } = view
  return {
    ...rest,
    usageLimitDollars: creditsToDollars(usageLimitCredits),
  }
}

function buildDashboardOrganizationSummary({
  org,
  memberCount,
  externalCollaboratorCount,
  latestSubscription,
  provisioning,
  owner,
  usageDollars,
  workflowRuns,
  usagePeriod,
}: DashboardOrganizationSummaryInput) {
  const metadata = metadataRecord(latestSubscription?.metadata)
  const teamEconomics = getTeamOrganizationEconomics(latestSubscription?.plan, memberCount)
  const invoiceAmountCents = metadataNumber(metadata, 'invoiceAmountCents')
  const monthlyPrice = metadataNumber(metadata, 'monthlyPrice')
  const usageLimitDollars = Math.max(0, Number(org.orgUsageLimit ?? 0))
  const planAllowanceDollars = teamEconomics?.planAllowanceDollars ?? null
  const reportingPeriod = usagePeriod
  const seats =
    latestSubscription?.plan === 'enterprise'
      ? Math.max(0, Math.round(metadataNumber(metadata, 'seats') ?? 0))
      : memberCount
  const concurrencyLimit =
    latestSubscription?.plan === 'enterprise'
      ? getBillingConcurrencyLimit(
          latestSubscription.plan,
          parseBillingConcurrencyLimit(metadata.concurrencyLimit)
        )
      : null
  const workflowExecutionTimeoutSeconds =
    latestSubscription?.plan === 'enterprise'
      ? (parseWorkflowExecutionTimeoutSeconds(metadata.workflowExecutionTimeoutSeconds) ??
        resolveEnterpriseWorkflowExecutionTimeoutFallbackSeconds(
          env.EXECUTION_TIMEOUT_ASYNC_ENTERPRISE
        ))
      : null

  return {
    id: org.id,
    name: org.name,
    owner,
    isActive: hasPaidSubscriptionStatus(latestSubscription?.status),
    subscriptionStatus: latestSubscription?.status ?? null,
    plan: latestSubscription?.plan ?? null,
    planLabel: planLabel(latestSubscription?.plan ?? null),
    memberCount,
    externalCollaboratorCount,
    seats,
    concurrencyLimit,
    workflowExecutionTimeoutSeconds,
    planAllowanceDollars,
    usageLimitDollars,
    effectiveUsageLimitDollars: usageLimitDollars,
    prepaidBalanceDollars: Number(org.creditBalance ?? 0),
    invoiceAmountUsd:
      latestSubscription?.plan === 'enterprise'
        ? invoiceAmountCents !== null
          ? invoiceAmountCents / 100
          : (monthlyPrice ?? null)
        : (teamEconomics?.monthlyInvoiceAmountUsd ?? null),
    billingInterval:
      latestSubscription?.billingInterval === 'year' ||
      latestSubscription?.billingInterval === 'month'
        ? latestSubscription.billingInterval
        : teamEconomics
          ? 'month'
          : null,
    reportingPeriod: {
      anchorDate: reportingPeriod.anchorDate,
      interval: reportingPeriod.interval,
      currentStart: reportingPeriod.start.toISOString(),
      currentEnd: reportingPeriod.end.toISOString(),
      source: reportingPeriod.source,
    },
    usage: {
      usedDollars: Math.max(0, usageDollars),
      limitDollars: usageLimitDollars,
      usedCredits: dollarsToCredits(Math.max(0, usageDollars)),
      limitCredits: dollarsToCredits(usageLimitDollars),
      workflowRuns,
    },
    provisioning: provisioning ? toDashboardProvisioning(provisioning) : null,
    subscription: latestSubscription,
  }
}

export function toDashboardConfigurationUpdate(
  intent: Awaited<ReturnType<typeof resolveEnterpriseMetadataIntent>> | null,
  prepaidBalanceDollars = 0
) {
  const update = intent?.configurationUpdate
  if (!update) return null
  const metadata = update.requestedMetadata
  const terms = update.requestedTerms
  const usageLimitCredits = metadataNumber(metadata, 'usageLimitCredits')
  const seats = metadataNumber(metadata, 'seats')
  const concurrencyLimit = metadataNumber(metadata, 'concurrencyLimit')
  const workflowExecutionTimeoutSeconds = metadataNumber(
    metadata,
    'workflowExecutionTimeoutSeconds'
  )

  return {
    id: update.id,
    status: update.status,
    requestedUsageLimitDollars:
      usageLimitCredits === null
        ? null
        : creditsToDollars(usageLimitCredits) + prepaidBalanceDollars,
    requestedInvoiceAmountUsd: terms ? terms.invoiceAmountCents / 100 : null,
    requestedBillingInterval: terms?.billingInterval ?? null,
    requestedReportingPeriodAnchorDate:
      typeof metadata.reportingPeriodAnchorDate === 'string'
        ? metadata.reportingPeriodAnchorDate
        : null,
    requestedSeats: seats === null ? null : Math.round(seats),
    requestedConcurrencyLimit: concurrencyLimit === null ? null : Math.round(concurrencyLimit),
    requestedWorkflowExecutionTimeoutSeconds:
      workflowExecutionTimeoutSeconds === null ? null : Math.round(workflowExecutionTimeoutSeconds),
    providerAccepted: update.providerAccepted,
    error: update.error,
  }
}

export async function listDashboardUsers({ search, limit, offset }: PaginationInput) {
  const trimmed = search.trim()
  // Mirror Better Auth's active-ban semantics: permanent bans and temporary
  // bans whose expiry is still in the future stay out of the Users dashboard,
  // while an expired temporary ban is treated as lifted. Keep this predicate
  // in the database query so pagination totals cannot leak or count hidden rows.
  const visibleUser = sql<boolean>`NOT (
    coalesce(${user.banned}, false)
    AND (
      ${user.banExpires} IS NULL
      OR ${user.banExpires} > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
    )
  )`
  const searchMatch = trimmed
    ? or(ilike(user.name, `%${trimmed}%`), ilike(user.email, `%${trimmed}%`), eq(user.id, trimmed))
    : undefined
  const where = searchMatch ? and(visibleUser, searchMatch) : visibleUser
  const [totalRow, rows] = await Promise.all([
    db.select({ total: count() }).from(user).where(where),
    db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        organizationId: organization.id,
        organizationName: organization.name,
      })
      .from(user)
      .leftJoin(member, eq(member.userId, user.id))
      .leftJoin(organization, eq(organization.id, member.organizationId))
      .where(where)
      .orderBy(user.name, user.email)
      .limit(limit)
      .offset(offset),
  ])
  const organizationIds = [...new Set(rows.flatMap((row) => row.organizationId ?? []))]
  const personalUserIds = rows.filter((row) => !row.organizationId).map((row) => row.id)
  const [organizationSubscriptions, personalSubscriptions] = await Promise.all([
    organizationIds.length === 0
      ? Promise.resolve([])
      : db
          .selectDistinctOn([subscription.referenceId])
          .from(subscription)
          .where(inArray(subscription.referenceId, organizationIds))
          .orderBy(
            subscription.referenceId,
            sql`case when ${subscription.status} in ('active', 'past_due') then 0 else 1 end`,
            sql`coalesce(${subscription.endedAt}, ${subscription.canceledAt}, ${subscription.periodEnd}, ${subscription.periodStart}) desc nulls last`,
            desc(subscription.id)
          ),
    personalUserIds.length === 0
      ? Promise.resolve([])
      : db
          .selectDistinctOn([subscription.referenceId])
          .from(subscription)
          .where(inArray(subscription.referenceId, personalUserIds))
          .orderBy(
            subscription.referenceId,
            sql`case when ${subscription.status} in ('active', 'past_due') then 0 else 1 end`,
            sql`coalesce(${subscription.endedAt}, ${subscription.canceledAt}, ${subscription.periodEnd}, ${subscription.periodStart}) desc nulls last`,
            desc(subscription.id)
          ),
  ])
  const organizationSubscriptionMap = new Map(
    organizationSubscriptions.map((row) => [row.referenceId, row])
  )
  const organizationUsage = await getDashboardOrganizationUsage(
    organizationIds.map((organizationId) => ({
      organizationId,
      period: resolveDashboardUsagePeriod(organizationSubscriptionMap.get(organizationId) ?? null),
    })),
    { userIds: rows.map((row) => row.id) }
  )
  const personalSubscriptionMap = new Map(
    personalSubscriptions.map((row) => [row.referenceId, row])
  )
  const personalPeriods = new Map(
    personalUserIds.map((userId) => [
      userId,
      resolveDashboardUsagePeriod(personalSubscriptionMap.get(userId) ?? null),
    ])
  )
  const personalLedgerRows =
    personalUserIds.length === 0
      ? []
      : await db
          .select({
            userId: usageLog.billingEntityId,
            cost: sql<string>`coalesce(sum(${usageLog.cost}), 0)`,
            workflowRuns:
              sql<number>`count(distinct ${usageLog.executionId}) filter (where ${usageLog.source} = 'workflow')`.mapWith(
                Number
              ),
          })
          .from(usageLog)
          .where(
            or(
              ...personalUserIds.map((userId) => {
                const period = personalPeriods.get(userId) as ResolvedUsagePeriod
                return and(
                  eq(usageLog.billingEntityType, 'user'),
                  eq(usageLog.billingEntityId, userId),
                  ...(period.source === 'reporting'
                    ? [gte(usageLog.createdAt, period.start), lt(usageLog.createdAt, period.end)]
                    : [
                        eq(usageLog.billingPeriodStart, period.start),
                        eq(usageLog.billingPeriodEnd, period.end),
                      ])
                )
              })
            )
          )
          .groupBy(usageLog.billingEntityId)
  const personalUsage = new Map(
    personalLedgerRows.flatMap((row) =>
      row.userId
        ? ([[row.userId, { dollars: Number(row.cost), workflowRuns: row.workflowRuns }]] as const)
        : []
    )
  )
  const legacyPersonalIds = personalUserIds.filter(
    (userId) => personalPeriods.get(userId)?.source !== 'reporting'
  )
  if (legacyPersonalIds.length > 0) {
    const baselineRows = await db
      .select({ userId: userStats.userId, cost: userStats.currentPeriodCost })
      .from(userStats)
      .where(inArray(userStats.userId, legacyPersonalIds))
    for (const row of baselineRows) {
      const current = personalUsage.get(row.userId) ?? { dollars: 0, workflowRuns: 0 }
      personalUsage.set(row.userId, {
        ...current,
        dollars: current.dollars + Number(row.cost ?? 0),
      })
    }
  }

  return {
    data: rows.map((row) => {
      const organization = row.organizationId
        ? organizationUsage.get(row.organizationId)
        : undefined
      const usageDollars = row.organizationId
        ? (organization?.byUser.get(row.id) ?? 0)
        : (personalUsage.get(row.id)?.dollars ?? 0)
      return {
        id: row.id,
        name: row.name,
        email: row.email,
        activeOrganization:
          row.organizationId && row.organizationName
            ? { id: row.organizationId, name: row.organizationName }
            : null,
        usageDollars,
        usageCredits: dollarsToCredits(usageDollars),
        workflowRuns: row.organizationId
          ? (organization?.workflowRunsByUser.get(row.id) ?? 0)
          : (personalUsage.get(row.id)?.workflowRuns ?? 0),
      }
    }),
    pagination: {
      total: totalRow[0]?.total ?? 0,
      limit,
      offset,
      hasMore: offset + rows.length < (totalRow[0]?.total ?? 0),
    },
  }
}

async function getDashboardOrganizationSummary(organizationId: string) {
  const [[org], [memberCountRow], [externalCountRow], latestSubscription, provisionings] =
    await Promise.all([
      db.select().from(organization).where(eq(organization.id, organizationId)).limit(1),
      db.select({ value: count() }).from(member).where(eq(member.organizationId, organizationId)),
      db
        .select({ value: countDistinct(permissions.userId) })
        .from(permissions)
        .innerJoin(
          workspace,
          and(
            eq(permissions.entityType, 'workspace'),
            eq(permissions.entityId, workspace.id),
            eq(workspace.organizationId, organizationId)
          )
        )
        .leftJoin(
          member,
          and(eq(member.userId, permissions.userId), eq(member.organizationId, organizationId))
        )
        .where(isNull(member.id)),
      getLatestSubscription(organizationId),
      getLatestEnterpriseProvisionings([organizationId], {
        includeWorkspaceMoveFailures: true,
      }),
    ])
  if (!org) return null

  const [owner] = await db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(member.organizationId, organizationId), eq(member.role, 'owner')))
    .limit(1)
  const memberCount = memberCountRow?.value ?? 0
  const period = resolveDashboardUsagePeriod(latestSubscription)
  const usage = await getDashboardOrganizationUsage([{ organizationId, period }], {
    includeUserBreakdown: false,
  })
  return {
    ...buildDashboardOrganizationSummary({
      org,
      memberCount,
      externalCollaboratorCount: externalCountRow?.value ?? 0,
      latestSubscription,
      provisioning: provisionings.get(organizationId) ?? null,
      owner: owner ?? null,
      usageDollars: usage.get(organizationId)?.total ?? 0,
      workflowRuns: usage.get(organizationId)?.workflowRuns ?? 0,
      usagePeriod: period,
    }),
    usagePeriod: period,
  }
}

export async function listDashboardOrganizations({ search, limit, offset }: PaginationInput) {
  const trimmed = search.trim()
  const where = trimmed
    ? or(ilike(organization.name, `%${trimmed}%`), eq(organization.id, trimmed))
    : undefined
  const [totalRow, orgRows] = await Promise.all([
    db.select({ total: count() }).from(organization).where(where),
    db
      .select({
        id: organization.id,
        name: organization.name,
        orgUsageLimit: organization.orgUsageLimit,
        creditBalance: organization.creditBalance,
      })
      .from(organization)
      .where(where)
      .orderBy(organization.name, organization.id)
      .limit(limit)
      .offset(offset),
  ])
  const organizationIds = orgRows.map((row) => row.id)
  if (organizationIds.length === 0) {
    return {
      data: [],
      pagination: { total: totalRow[0]?.total ?? 0, limit, offset, hasMore: false },
    }
  }

  const [membershipRows, externalRows, subscriptionRows, provisionings] = await Promise.all([
    db
      .select({
        organizationId: member.organizationId,
        memberCount: count(),
        ownerId: sql<string | null>`max(${user.id}) filter (where ${member.role} = 'owner')`,
        ownerName: sql<string | null>`max(${user.name}) filter (where ${member.role} = 'owner')`,
        ownerEmail: sql<string | null>`max(${user.email}) filter (where ${member.role} = 'owner')`,
      })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(inArray(member.organizationId, organizationIds))
      .groupBy(member.organizationId),
    db
      .select({
        organizationId: workspace.organizationId,
        externalCollaboratorCount: countDistinct(permissions.userId),
      })
      .from(permissions)
      .innerJoin(
        workspace,
        and(eq(permissions.entityType, 'workspace'), eq(permissions.entityId, workspace.id))
      )
      .leftJoin(
        member,
        and(
          eq(member.userId, permissions.userId),
          eq(member.organizationId, workspace.organizationId)
        )
      )
      .where(and(inArray(workspace.organizationId, organizationIds), isNull(member.id)))
      .groupBy(workspace.organizationId),
    db
      .selectDistinctOn([subscription.referenceId])
      .from(subscription)
      .where(inArray(subscription.referenceId, organizationIds))
      .orderBy(
        subscription.referenceId,
        sql`case when ${subscription.status} in ('active', 'past_due') then 0 else 1 end`,
        sql`coalesce(${subscription.endedAt}, ${subscription.canceledAt}, ${subscription.periodEnd}, ${subscription.periodStart}) desc nulls last`,
        desc(subscription.id)
      ),
    getLatestEnterpriseProvisionings(organizationIds),
  ])

  const membershipsByOrganization = new Map(membershipRows.map((row) => [row.organizationId, row]))
  const externalCountByOrganization = new Map(
    externalRows.flatMap((row) =>
      row.organizationId ? [[row.organizationId, row.externalCollaboratorCount] as const] : []
    )
  )
  const subscriptionByOrganization = new Map(subscriptionRows.map((row) => [row.referenceId, row]))
  const usagePeriodsByOrganization = new Map(
    organizationIds.map(
      (organizationId) =>
        [
          organizationId,
          resolveDashboardUsagePeriod(subscriptionByOrganization.get(organizationId) ?? null),
        ] as const
    )
  )
  const usageByOrganization = await getDashboardOrganizationUsage(
    organizationIds.map((organizationId) => ({
      organizationId,
      period: usagePeriodsByOrganization.get(organizationId)!,
    })),
    { includeUserBreakdown: false }
  )
  const data = orgRows.map((org) => {
    const membership = membershipsByOrganization.get(org.id)
    const owner =
      membership?.ownerId && membership.ownerName && membership.ownerEmail
        ? {
            id: membership.ownerId,
            name: membership.ownerName,
            email: membership.ownerEmail,
          }
        : null
    const { subscription: _subscription, ...summary } = buildDashboardOrganizationSummary({
      org,
      memberCount: membership?.memberCount ?? 0,
      externalCollaboratorCount: externalCountByOrganization.get(org.id) ?? 0,
      latestSubscription: subscriptionByOrganization.get(org.id) ?? null,
      provisioning: provisionings.get(org.id) ?? null,
      owner,
      usageDollars: usageByOrganization.get(org.id)?.total ?? 0,
      workflowRuns: usageByOrganization.get(org.id)?.workflowRuns ?? 0,
      usagePeriod: usagePeriodsByOrganization.get(org.id)!,
    })
    return summary
  })
  return {
    data,
    pagination: {
      total: totalRow[0]?.total ?? 0,
      limit,
      offset,
      hasMore: offset + data.length < (totalRow[0]?.total ?? 0),
    },
  }
}

export async function getDashboardOrganization(
  organizationId: string,
  pagination: {
    limit: number
    memberOffset: number
    externalCollaboratorOffset: number
    workspaceOffset: number
  } = {
    limit: 50,
    memberOffset: 0,
    externalCollaboratorOffset: 0,
    workspaceOffset: 0,
  }
) {
  const summary = await getDashboardOrganizationSummary(organizationId)
  if (!summary) return null
  const { subscription: subscriptionRow, usagePeriod, ...base } = summary
  const memberQuery = () =>
    db
      .select({
        id: member.id,
        userId: user.id,
        name: user.name,
        email: user.email,
        role: member.role,
      })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(eq(member.organizationId, organizationId))
      .orderBy(user.name, user.id)
  const externalCollaboratorQuery = () =>
    db
      .select({
        userId: user.id,
        name: user.name,
        email: user.email,
        workspaceCount: countDistinct(workspace.id),
      })
      .from(permissions)
      .innerJoin(user, eq(user.id, permissions.userId))
      .innerJoin(
        workspace,
        and(
          eq(permissions.entityType, 'workspace'),
          eq(permissions.entityId, workspace.id),
          eq(workspace.organizationId, organizationId)
        )
      )
      .leftJoin(
        member,
        and(eq(member.userId, permissions.userId), eq(member.organizationId, organizationId))
      )
      .where(isNull(member.id))
      .groupBy(user.id, user.name, user.email)
      .orderBy(user.name, user.id)
  const workspaceQuery = () =>
    db
      .select({ id: workspace.id, name: workspace.name })
      .from(workspace)
      .where(eq(workspace.organizationId, organizationId))
      .orderBy(workspace.name, workspace.id)

  const [memberRows, externalRows, workspaceRows, workspaceCountRows, configurationIntent] =
    await Promise.all([
      memberQuery().limit(pagination.limit).offset(pagination.memberOffset),
      externalCollaboratorQuery()
        .limit(pagination.limit)
        .offset(pagination.externalCollaboratorOffset),
      workspaceQuery().limit(pagination.limit).offset(pagination.workspaceOffset),
      db
        .select({ value: count() })
        .from(workspace)
        .where(eq(workspace.organizationId, organizationId)),
      subscriptionRow?.plan === 'enterprise'
        ? resolveEnterpriseMetadataIntent(db, subscriptionRow.id, subscriptionRow.metadata)
        : Promise.resolve(null),
    ])
  const visibleUserIds = [
    ...new Set([...memberRows.map((row) => row.userId), ...externalRows.map((row) => row.userId)]),
  ]
  const [limitRows, usageByOrganization, historicalActorUsage] = await Promise.all([
    visibleUserIds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            userId: organizationMemberUsageLimit.userId,
            limit: organizationMemberUsageLimit.usageLimit,
          })
          .from(organizationMemberUsageLimit)
          .where(
            and(
              eq(organizationMemberUsageLimit.organizationId, organizationId),
              inArray(organizationMemberUsageLimit.userId, visibleUserIds)
            )
          ),
    getDashboardOrganizationUsage([{ organizationId, period: usagePeriod }], {
      userIds: visibleUserIds,
    }),
    getHistoricalActorUsage(organizationId, usagePeriod),
  ])
  const limits = new Map(limitRows.map((row) => [row.userId, Number(row.limit)]))
  const organizationUsage = usageByOrganization.get(organizationId)
  const usageByUser = organizationUsage?.byUser ?? new Map<string, number>()
  const workflowRunsByUser = organizationUsage?.workflowRunsByUser ?? new Map<string, number>()
  const workspaceTotal = workspaceCountRows[0]?.value ?? 0
  return {
    ...base,
    configurationUpdate: toDashboardConfigurationUpdate(
      configurationIntent,
      base.prepaidBalanceDollars
    ),
    historicalActorUsage,
    members: memberRows.map((row) => ({
      ...row,
      usageLimitDollars: limits.get(row.userId) ?? null,
      usageDollars: usageByUser.get(row.userId) ?? 0,
      usageCredits: dollarsToCredits(usageByUser.get(row.userId) ?? 0),
      workflowRuns: workflowRunsByUser.get(row.userId) ?? 0,
    })),
    externalCollaborators: externalRows.map((row) => ({
      ...row,
      workspaceCount: row.workspaceCount,
      usageLimitDollars: limits.get(row.userId) ?? null,
      usageDollars: usageByUser.get(row.userId) ?? 0,
      usageCredits: dollarsToCredits(usageByUser.get(row.userId) ?? 0),
      workflowRuns: workflowRunsByUser.get(row.userId) ?? 0,
    })),
    workspaces: workspaceRows,
    memberPagination: {
      total: base.memberCount,
      limit: pagination.limit,
      offset: pagination.memberOffset,
      hasMore: pagination.memberOffset + memberRows.length < base.memberCount,
    },
    externalCollaboratorPagination: {
      total: base.externalCollaboratorCount,
      limit: pagination.limit,
      offset: pagination.externalCollaboratorOffset,
      hasMore:
        pagination.externalCollaboratorOffset + externalRows.length <
        base.externalCollaboratorCount,
    },
    workspacePagination: {
      total: workspaceTotal,
      limit: pagination.limit,
      offset: pagination.workspaceOffset,
      hasMore: pagination.workspaceOffset + workspaceRows.length < workspaceTotal,
    },
    subscription: subscriptionRow
      ? {
          id: subscriptionRow.id,
          plan: subscriptionRow.plan,
          status: subscriptionRow.status,
          cancelAtPeriodEnd: subscriptionRow.cancelAtPeriodEnd,
          periodStart: subscriptionRow.periodStart?.toISOString() ?? null,
          periodEnd: subscriptionRow.periodEnd?.toISOString() ?? null,
          stripeSubscriptionId: subscriptionRow.stripeSubscriptionId,
          invoiceAmountUsd: base.invoiceAmountUsd,
        }
      : null,
  }
}

export async function renameDashboardOrganization(
  organizationId: string,
  name: string,
  actor: AdminMutationActor
) {
  const normalizedName = name.trim()
  if (!normalizedName || normalizedName.length > 120) {
    throw new Error('Organization name must be between 1 and 120 characters')
  }
  const previousName = await db.transaction(async (tx) => {
    await acquireOrganizationMutationLock(tx, organizationId)
    const [row] = await tx
      .select({ name: organization.name })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .for('update')
      .limit(1)
    if (!row) throw new Error('Organization not found')
    if (row.name !== normalizedName) {
      await tx
        .update(organization)
        .set({ name: normalizedName, updatedAt: new Date() })
        .where(eq(organization.id, organizationId))
    }
    return row.name
  })

  if (previousName !== normalizedName) {
    recordAudit({
      actorId: actor.id,
      actorName: actor.name,
      actorEmail: actor.email,
      action: AuditAction.ORGANIZATION_UPDATED,
      resourceType: AuditResourceType.ORGANIZATION,
      resourceId: organizationId,
      resourceName: normalizedName,
      description: `Admin renamed organization from ${previousName} to ${normalizedName}`,
      metadata: { previousName, name: normalizedName },
    })
  }
}

export async function updateDashboardEnterpriseSeats(
  organizationId: string,
  seats: number,
  actor: AdminMutationActor
) {
  await db.transaction(async (tx) => {
    await acquireOrganizationMutationLock(tx, organizationId)
    const [subscriptionRow] = await tx
      .select()
      .from(subscription)
      .where(
        and(
          eq(subscription.referenceId, organizationId),
          eq(subscription.plan, 'enterprise'),
          inArray(subscription.status, ENTITLED_SUBSCRIPTION_STATUSES)
        )
      )
      .for('update')
      .limit(1)
    if (!subscriptionRow) throw new Error('Active Enterprise subscription not found')
    const [memberCountRow] = await tx
      .select({ value: count() })
      .from(member)
      .where(eq(member.organizationId, organizationId))
    const pendingSeats = await countPendingSeatInvitations(organizationId, tx)
    const requiredSeats = (memberCountRow?.value ?? 0) + pendingSeats
    if (seats < requiredSeats) {
      throw new Error(
        `Seat capacity cannot be below ${requiredSeats} occupied or reserved seats (${memberCountRow?.value ?? 0} members and ${pendingSeats} pending invitations)`
      )
    }
    await enqueueEnterpriseMetadataIntent(tx, {
      subscriptionId: subscriptionRow.id,
      appliedMetadata: subscriptionRow.metadata,
      buildDesiredMetadata: (current) => ({ ...current, seats }),
    })
  })
  recordAudit({
    actorId: actor.id,
    actorName: actor.name,
    actorEmail: actor.email,
    action: AuditAction.ORG_SEAT_PROVISIONED,
    resourceType: AuditResourceType.ORGANIZATION,
    resourceId: organizationId,
    description: `Admin requested Enterprise seat capacity ${seats}`,
    metadata: { seats },
  })
}

interface DashboardEnterpriseBillingTerms {
  invoiceAmountUsd: number
  billingInterval: 'month' | 'year'
  reportingPeriodAnchorDate: string
}

function validateDashboardEnterpriseBillingTerms(values: DashboardEnterpriseBillingTerms) {
  const invoiceAmountCents = Math.round(values.invoiceAmountUsd * 100)
  if (
    invoiceAmountCents <= 0 ||
    !Number.isSafeInteger(invoiceAmountCents) ||
    Math.abs(values.invoiceAmountUsd * 100 - invoiceAmountCents) > 1e-8
  ) {
    throw new Error('Invoice amount must be at least $0.01 and use whole cents')
  }
  const reportingPeriod = resolveEnterpriseReportingPeriod(
    values.reportingPeriodAnchorDate,
    values.billingInterval
  )
  if (!reportingPeriod) {
    throw new Error('Contract start must be a valid UTC date that is not in the future')
  }
  return { invoiceAmountCents, reportingPeriod }
}

export async function previewDashboardEnterpriseBillingTerms(
  organizationId: string,
  values: DashboardEnterpriseBillingTerms
) {
  const { reportingPeriod } = validateDashboardEnterpriseBillingTerms(values)
  const [[org], [subscriptionRow]] = await Promise.all([
    db
      .select({ orgUsageLimit: organization.orgUsageLimit })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1),
    db
      .select({ id: subscription.id })
      .from(subscription)
      .where(
        and(
          eq(subscription.referenceId, organizationId),
          eq(subscription.plan, 'enterprise'),
          inArray(subscription.status, ENTITLED_SUBSCRIPTION_STATUSES)
        )
      )
      .limit(1),
  ])
  if (!org || !subscriptionRow) throw new Error('Active Enterprise subscription not found')
  const usage = await getDashboardOrganizationUsage([{ organizationId, period: reportingPeriod }], {
    includeUserBreakdown: false,
  })
  const usedDollars = usage.get(organizationId)?.total ?? 0
  const workflowRuns = usage.get(organizationId)?.workflowRuns ?? 0
  const limitDollars = Number(org.orgUsageLimit ?? 0)
  return {
    reportingPeriod: {
      anchorDate: reportingPeriod.anchorDate,
      interval: reportingPeriod.interval,
      currentStart: reportingPeriod.start.toISOString(),
      currentEnd: reportingPeriod.end.toISOString(),
      source: reportingPeriod.source,
    },
    usage: {
      usedDollars,
      limitDollars,
      usedCredits: dollarsToCredits(usedDollars),
      limitCredits: dollarsToCredits(limitDollars),
      workflowRuns,
    },
    exceedsLimit: usedDollars > limitDollars,
  }
}

export async function updateDashboardEnterpriseBillingTerms(
  organizationId: string,
  values: DashboardEnterpriseBillingTerms,
  actor: AdminMutationActor
) {
  const { invoiceAmountCents } = validateDashboardEnterpriseBillingTerms(values)
  await db.transaction(async (tx) => {
    await acquireOrganizationMutationLock(tx, organizationId)
    const [subscriptionRow] = await tx
      .select()
      .from(subscription)
      .where(
        and(
          eq(subscription.referenceId, organizationId),
          eq(subscription.plan, 'enterprise'),
          inArray(subscription.status, ENTITLED_SUBSCRIPTION_STATUSES)
        )
      )
      .for('update')
      .limit(1)
    if (!subscriptionRow?.stripeSubscriptionId) {
      throw new Error('Active Stripe-backed Enterprise subscription not found')
    }
    const appliedMetadata = metadataRecord(subscriptionRow.metadata)
    const appliedInvoiceAmountCents =
      metadataNumber(appliedMetadata, 'invoiceAmountCents') ??
      Math.round((metadataNumber(appliedMetadata, 'monthlyPrice') ?? 0) * 100)
    const appliedBillingInterval = subscriptionRow.billingInterval === 'year' ? 'year' : 'month'
    const termsChanged =
      appliedInvoiceAmountCents !== invoiceAmountCents ||
      appliedBillingInterval !== values.billingInterval
    await enqueueEnterpriseMetadataIntent(tx, {
      subscriptionId: subscriptionRow.id,
      appliedMetadata: subscriptionRow.metadata,
      terms: termsChanged ? { invoiceAmountCents, billingInterval: values.billingInterval } : null,
      buildDesiredMetadata: (current) => {
        const { monthlyPrice: _legacyMonthlyPrice, ...rest } = current
        return {
          ...rest,
          // Stripe metadata updates merge by default. An empty value removes
          // the legacy key after the neutral amount has been written.
          monthlyPrice: null,
          invoiceAmountCents,
          reportingPeriodAnchorDate: values.reportingPeriodAnchorDate,
        }
      },
    })
  })
  recordAudit({
    actorId: actor.id,
    actorName: actor.name,
    actorEmail: actor.email,
    action: AuditAction.ORGANIZATION_UPDATED,
    resourceType: AuditResourceType.ORGANIZATION,
    resourceId: organizationId,
    description: 'Admin requested Enterprise billing-term update',
    metadata: { ...values },
  })
}

export async function retryDashboardEnterpriseConfigurationUpdate(
  organizationId: string,
  operationId: string,
  actor: AdminMutationActor
) {
  await db.transaction(async (tx) => {
    await acquireOrganizationMutationLock(tx, organizationId)
    const [subscriptionRow] = await tx
      .select({ id: subscription.id })
      .from(subscription)
      .where(
        and(
          eq(subscription.referenceId, organizationId),
          eq(subscription.plan, 'enterprise'),
          inArray(subscription.status, ENTITLED_SUBSCRIPTION_STATUSES)
        )
      )
      .for('update')
      .limit(1)
    if (!subscriptionRow) throw new Error('Active Enterprise subscription not found')
    const [event] = await tx
      .select({ status: outboxEvent.status, payload: outboxEvent.payload })
      .from(outboxEvent)
      .where(
        and(
          eq(outboxEvent.id, operationId),
          eq(outboxEvent.eventType, ENTERPRISE_METADATA_SYNC_EVENT_TYPE)
        )
      )
      .for('update')
      .limit(1)
    const payload = enterpriseMetadataSyncPayloadSchema.safeParse(event?.payload)
    if (!event || !payload.success || payload.data.subscriptionId !== subscriptionRow.id) {
      throw new Error('Enterprise configuration update not found')
    }
    if (event.status !== 'dead_letter') {
      throw new Error('Only a failed Enterprise configuration update can be retried')
    }
    await tx
      .update(outboxEvent)
      .set({
        status: 'pending',
        attempts: 0,
        lastError: null,
        availableAt: new Date(),
        lockedAt: null,
        processedAt: null,
        payload: sql`((${outboxEvent.payload}::jsonb - 'acknowledgement') || ${JSON.stringify({ deliveryRevision: payload.data.deliveryRevision + 1 })}::jsonb)::json`,
      })
      .where(eq(outboxEvent.id, operationId))
  })
  recordAudit({
    actorId: actor.id,
    actorName: actor.name,
    actorEmail: actor.email,
    action: AuditAction.ORGANIZATION_UPDATED,
    resourceType: AuditResourceType.ORGANIZATION,
    resourceId: organizationId,
    description: 'Admin retried Enterprise configuration update',
    metadata: { operationId },
  })
}

export async function updateDashboardOrganizationLimits(
  organizationId: string,
  values: {
    usageLimitDollars?: number
    concurrencyLimit?: number | null
    workflowExecutionTimeoutSeconds?: number | null
  },
  actor: AdminMutationActor
) {
  const providerBacked = await db.transaction(async (tx) => {
    await acquireOrganizationMutationLock(tx, organizationId)
    const [org] = await tx
      .select()
      .from(organization)
      .where(eq(organization.id, organizationId))
      .for('update')
      .limit(1)
    if (!org) throw new Error('Organization not found')
    const [subscriptionRow] = await tx
      .select()
      .from(subscription)
      .where(eq(subscription.referenceId, organizationId))
      .orderBy(
        sql`case when ${subscription.status} in ('active', 'past_due') then 0 else 1 end`,
        sql`coalesce(${subscription.endedAt}, ${subscription.canceledAt}, ${subscription.periodEnd}, ${subscription.periodStart}) desc nulls last`,
        desc(subscription.id)
      )
      .for('update')
      .limit(1)
    const metadata = metadataRecord(subscriptionRow?.metadata)
    if (values.concurrencyLimit !== undefined && subscriptionRow?.plan !== 'enterprise') {
      throw new Error('Concurrency is editable only for Enterprise organizations')
    }
    if (
      values.workflowExecutionTimeoutSeconds !== undefined &&
      subscriptionRow?.plan !== 'enterprise'
    ) {
      throw new Error('Workflow execution timeout is editable only for Enterprise organizations')
    }

    if (subscriptionRow?.plan === 'enterprise') {
      if (!hasPaidSubscriptionStatus(subscriptionRow.status)) {
        throw new Error('Enterprise limits can be changed only for an active subscription')
      }
      const prepaidBalanceDollars = Number(org.creditBalance ?? 0)
      if (
        values.usageLimitDollars !== undefined &&
        values.usageLimitDollars < prepaidBalanceDollars
      ) {
        throw new Error('Enterprise usage limit cannot be below its prepaid balance')
      }
      await enqueueEnterpriseMetadataIntent(tx, {
        subscriptionId: subscriptionRow.id,
        appliedMetadata: subscriptionRow.metadata,
        buildDesiredMetadata: (current) => {
          const configuredUsageLimit =
            values.usageLimitDollars === undefined
              ? Math.round(
                  metadataNumber(current, 'usageLimitCredits') ??
                    dollarsToCredits(
                      Math.max(0, Number(org.orgUsageLimit ?? 0) - prepaidBalanceDollars)
                    )
                )
              : dollarsToCredits(values.usageLimitDollars - prepaidBalanceDollars)
          return {
            ...current,
            usageLimitCredits: configuredUsageLimit,
            ...(values.concurrencyLimit !== undefined
              ? { concurrencyLimit: values.concurrencyLimit }
              : {}),
            ...(values.workflowExecutionTimeoutSeconds !== undefined
              ? { workflowExecutionTimeoutSeconds: values.workflowExecutionTimeoutSeconds }
              : {}),
          }
        },
      })
      return true
    }

    const [memberCountRow] = await tx
      .select({ value: count() })
      .from(member)
      .where(eq(member.organizationId, organizationId))
    const teamEconomics = getTeamOrganizationEconomics(
      subscriptionRow?.plan,
      memberCountRow?.value ?? 0
    )
    const planAllowance = teamEconomics?.planAllowanceDollars ?? 0
    const prepaid = Number(org.creditBalance)
    const configuredUsageLimit =
      values.usageLimitDollars ??
      (metadataNumber(metadata, 'usageLimitCredits') === null
        ? Number(org.orgUsageLimit ?? 0)
        : creditsToDollars(metadataNumber(metadata, 'usageLimitCredits') ?? 0))
    const effective = Math.max(configuredUsageLimit, planAllowance + prepaid)
    await tx
      .update(organization)
      .set({ orgUsageLimit: effective.toString(), updatedAt: new Date() })
      .where(eq(organization.id, organizationId))
    if (subscriptionRow) {
      await tx
        .update(subscription)
        .set({
          metadata: {
            ...metadata,
            usageLimitCredits: dollarsToCredits(configuredUsageLimit),
          },
        })
        .where(eq(subscription.id, subscriptionRow.id))
    }
    return false
  })
  recordAudit({
    actorId: actor.id,
    actorName: actor.name,
    actorEmail: actor.email,
    action: AuditAction.ORGANIZATION_UPDATED,
    resourceType: AuditResourceType.ORGANIZATION,
    resourceId: organizationId,
    description: providerBacked
      ? 'Admin requested Enterprise organization-limit update'
      : 'Admin updated organization limits',
    metadata: values,
  })
}

export async function grantDashboardOrganizationBalance(
  organizationId: string,
  amountDollars: number,
  reason: string | undefined,
  operationId: string,
  actor: AdminMutationActor
) {
  const normalizedReason = reason?.trim() || null
  const outcome = await db.transaction(async (tx) => {
    await acquireOrganizationMutationLock(tx, organizationId)
    return executeTransactionallyIdempotent(tx, {
      namespace: 'admin-credit-grant',
      operationId,
      requestFingerprint: JSON.stringify({
        organizationId,
        amountDollars,
        reason: normalizedReason,
      }),
      operation: async () => {
        const [org] = await tx
          .select()
          .from(organization)
          .where(eq(organization.id, organizationId))
          .for('update')
          .limit(1)
        if (!org) throw new Error('Organization not found')
        const [subscriptionRow] = await tx
          .select({ plan: subscription.plan, metadata: subscription.metadata })
          .from(subscription)
          .where(eq(subscription.referenceId, organizationId))
          .orderBy(
            sql`case when ${subscription.status} in ('active', 'past_due') then 0 else 1 end`,
            sql`coalesce(${subscription.endedAt}, ${subscription.canceledAt}, ${subscription.periodEnd}, ${subscription.periodStart}) desc nulls last`,
            desc(subscription.id)
          )
          .limit(1)
        const [memberCountRow] = await tx
          .select({ value: count() })
          .from(member)
          .where(eq(member.organizationId, organizationId))
        const teamEconomics = getTeamOrganizationEconomics(
          subscriptionRow?.plan,
          memberCountRow?.value ?? 0
        )
        const planAllowanceDollars = teamEconomics?.planAllowanceDollars ?? 0
        const subscriptionMetadata = metadataRecord(subscriptionRow?.metadata)
        const configuredUsageLimitCredits = metadataNumber(
          subscriptionMetadata,
          'usageLimitCredits'
        )
        const configuredUsageLimitDollars =
          configuredUsageLimitCredits === null
            ? null
            : creditsToDollars(configuredUsageLimitCredits)
        const grantDollarDelta = toDecimal(amountDollars).toString()
        const usageLimitFallback = getOrganizationUsageLimitFallbackDollars({
          creditBalanceDollarsBeforeGrant: org.creditBalance,
          planAllowanceDollars,
          configuredUsageLimitDollars,
        })
        const [updated] = await tx
          .update(organization)
          .set({
            creditBalance: sql`${organization.creditBalance} + ${grantDollarDelta}::numeric`,
            orgUsageLimit: sql`greatest(coalesce(${organization.orgUsageLimit}, 0), ${usageLimitFallback}::numeric) + ${grantDollarDelta}::numeric`,
            updatedAt: new Date(),
          })
          .where(eq(organization.id, organizationId))
          .returning({
            creditBalance: organization.creditBalance,
            orgUsageLimit: organization.orgUsageLimit,
          })
        if (!updated || updated.orgUsageLimit === null) {
          throw new Error('Organization disappeared during credit grant')
        }
        return {
          prepaidBalanceDollars: Number(updated.creditBalance),
          usageLimitDollars: Number(updated.orgUsageLimit),
        }
      },
    })
  })
  if (outcome.isFirstTime) {
    recordAudit({
      actorId: actor.id,
      actorName: actor.name,
      actorEmail: actor.email,
      action: AuditAction.CREDIT_ISSUED,
      resourceType: AuditResourceType.BILLING,
      resourceId: organizationId,
      description: `Admin granted $${amountDollars} in prepaid balance to organization`,
      metadata: { amountDollars, reason: normalizedReason, operationId },
    })
  }
  return outcome.result
}

export async function grantDashboardUserBalance(
  userId: string,
  amountDollars: number,
  reason: string | undefined,
  operationId: string,
  actor: AdminMutationActor
) {
  const normalizedReason = reason?.trim() || null
  const outcome = await db.transaction(async (tx) => {
    await acquireUserBillingIdentityLock(tx, userId)
    const [account] = await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1)
    if (!account) throw new Error('User not found')

    const initialSubscription = await getHighestPrioritySubscription(userId, {
      executor: tx,
      onError: 'throw',
    })
    const [initialMembership] = await tx
      .select({ organizationId: member.organizationId })
      .from(member)
      .where(eq(member.userId, userId))
      .limit(1)
    const initialUsageLimit =
      initialMembership || isOrgScopedSubscription(initialSubscription, userId)
        ? null
        : getPerUserMinimumLimit(initialSubscription).toString()
    await tx
      .insert(userStats)
      .values({
        id: generateId(),
        userId,
        currentUsageLimit: initialUsageLimit,
        usageLimitUpdatedAt: new Date(),
      })
      .onConflictDoNothing({ target: userStats.userId })

    const [stats] = await tx
      .select({
        creditBalance: userStats.creditBalance,
        currentUsageLimit: userStats.currentUsageLimit,
      })
      .from(userStats)
      .where(eq(userStats.userId, userId))
      .for('update')
      .limit(1)
    if (!stats) throw new Error('User usage record not found')

    return executeTransactionallyIdempotent(tx, {
      namespace: 'admin-credit-grant',
      operationId,
      requestFingerprint: JSON.stringify({ userId, amountDollars, reason: normalizedReason }),
      operation: async () => {
        const [currentMembership] = await tx
          .select({ organizationId: member.organizationId })
          .from(member)
          .where(eq(member.userId, userId))
          .limit(1)
        if (currentMembership) {
          throw new Error(
            `User belongs to organization ${currentMembership.organizationId}; grant prepaid balance from Organizations instead`
          )
        }
        const billingSubscription = await getHighestPrioritySubscription(userId, {
          executor: tx,
          onError: 'throw',
        })
        if (isOrgScopedSubscription(billingSubscription, userId)) {
          throw new Error(
            'User is billed through an organization; grant prepaid balance from Organizations instead'
          )
        }

        const grantDollarDelta = toDecimal(amountDollars).toString()
        const usageLimitFallback = toDecimal(getPerUserMinimumLimit(billingSubscription))
          .plus(toDecimal(stats.creditBalance))
          .toString()
        const nextUsageLimit =
          billingSubscription && hasPaidSubscriptionStatus(billingSubscription.status)
            ? sql`greatest(coalesce(${userStats.currentUsageLimit}, 0), ${usageLimitFallback}::numeric) + ${grantDollarDelta}::numeric`
            : sql`${usageLimitFallback}::numeric + ${grantDollarDelta}::numeric`
        const [updated] = await tx
          .update(userStats)
          .set({
            creditBalance: sql`${userStats.creditBalance} + ${grantDollarDelta}::numeric`,
            currentUsageLimit: nextUsageLimit,
            usageLimitUpdatedAt: new Date(),
          })
          .where(eq(userStats.userId, userId))
          .returning({
            creditBalance: userStats.creditBalance,
            currentUsageLimit: userStats.currentUsageLimit,
          })
        if (!updated || updated.currentUsageLimit === null) {
          throw new Error('User disappeared during credit grant')
        }
        return {
          prepaidBalanceDollars: Number(updated.creditBalance),
          usageLimitDollars: Number(updated.currentUsageLimit),
        }
      },
    })
  })

  if (outcome.isFirstTime) {
    recordAudit({
      actorId: actor.id,
      actorName: actor.name,
      actorEmail: actor.email,
      action: AuditAction.CREDIT_ISSUED,
      resourceType: AuditResourceType.BILLING,
      resourceId: userId,
      description: `Admin granted $${amountDollars} in prepaid balance to user`,
      metadata: { amountDollars, reason: normalizedReason, operationId },
    })
  }
  return outcome.result
}

export async function getDashboardMemberTransferPreflight(
  destinationOrganizationId: string,
  userId: string,
  workspacePage: PaginationInput = { search: '', limit: 50, offset: 0 }
) {
  const search = workspacePage.search.trim()
  const limit = Math.min(Math.max(workspacePage.limit, 1), 250)
  const offset = Math.max(workspacePage.offset, 0)
  const allPersonalWorkspacesWhere = ownedAttachableWorkspacesWhere({
    userId,
    includeArchived: true,
  })
  const matchingPersonalWorkspacesWhere = and(
    allPersonalWorkspacesWhere,
    search ? or(eq(workspace.id, search), ilike(workspace.name, `%${search}%`)) : undefined
  )
  const [[destination], [target], personalWorkspaceCount, personalWorkspaces, selectionRows] =
    await Promise.all([
      db
        .select({ id: organization.id })
        .from(organization)
        .where(eq(organization.id, destinationOrganizationId))
        .limit(1),
      db
        .select({
          id: user.id,
          name: user.name,
          email: user.email,
          memberId: member.id,
          role: member.role,
          organizationId: member.organizationId,
          organizationName: organization.name,
        })
        .from(user)
        .leftJoin(member, eq(member.userId, user.id))
        .leftJoin(organization, eq(organization.id, member.organizationId))
        .where(eq(user.id, userId))
        .limit(1),
      db.select({ value: count() }).from(workspace).where(matchingPersonalWorkspacesWhere),
      db
        .select({ id: workspace.id, name: workspace.name, archivedAt: workspace.archivedAt })
        .from(workspace)
        .where(matchingPersonalWorkspacesWhere)
        .orderBy(workspace.name, workspace.id)
        .limit(limit)
        .offset(offset),
      db
        .select({
          id: workspace.id,
          name: workspace.name,
          archivedAt: workspace.archivedAt,
          total: sql<number>`count(*) over()`.mapWith(Number),
        })
        .from(workspace)
        .where(allPersonalWorkspacesWhere)
        .orderBy(workspace.id)
        .limit(MAX_ADMIN_MEMBER_WORKSPACE_SELECTION + 1),
    ])
  if (!destination) throw new Error('Destination organization not found')
  if (!target) throw new Error('User not found')

  const credentialDependencies = target.organizationId
    ? await getOrganizationTransferCredentialDependencies(userId, target.organizationId)
    : []
  const alreadyInDestination = target.organizationId === destinationOrganizationId
  const reason = alreadyInDestination
    ? 'User is already a member of this organization'
    : target.role === 'owner'
      ? 'Transfer organization ownership before moving this user'
      : credentialDependencies.length > 0
        ? 'Reconnect or remove source-organization credentials owned by this user before transfer'
        : null
  const matchingWorkspaceTotal = personalWorkspaceCount[0]?.value ?? 0
  const totalEligibleWorkspaces = selectionRows[0]?.total ?? 0
  const includesAllEligible = totalEligibleWorkspaces <= MAX_ADMIN_MEMBER_WORKSPACE_SELECTION

  return {
    user: { id: target.id, name: target.name, email: target.email },
    currentOrganization:
      target.organizationId && target.organizationName
        ? { id: target.organizationId, name: target.organizationName, role: target.role }
        : null,
    personalWorkspaces: personalWorkspaces.map((row) => ({
      id: row.id,
      name: row.name,
      archived: row.archivedAt !== null,
    })),
    workspacePagination: {
      total: matchingWorkspaceTotal,
      limit,
      offset,
      hasMore: offset + personalWorkspaces.length < matchingWorkspaceTotal,
    },
    workspaceSelection: {
      totalEligible: totalEligibleWorkspaces,
      defaultSelectedIds: includesAllEligible ? selectionRows.map((row) => row.id) : [],
      defaultSelectedWorkspaces: includesAllEligible
        ? selectionRows.map(({ total: _total, archivedAt, ...row }) => ({
            ...row,
            archived: archivedAt !== null,
          }))
        : [],
      includesAllEligible,
      limit: MAX_ADMIN_MEMBER_WORKSPACE_SELECTION,
    },
    credentialDependencies,
    canAdd: reason === null,
    reason,
  }
}

export async function updateDashboardOrganizationMember(
  organizationId: string,
  memberId: string,
  values: { role?: 'admin' | 'member'; usageLimitDollars?: number | null },
  actor: AdminMutationActor
) {
  const existing = await db.transaction(async (tx) => {
    await acquireOrganizationMutationLock(tx, organizationId)
    const [memberRow] = await tx
      .select()
      .from(member)
      .where(and(eq(member.id, memberId), eq(member.organizationId, organizationId)))
      .for('update')
      .limit(1)
    if (!memberRow) throw new Error('Member not found')
    if (memberRow.role === 'owner' && values.role) {
      throw new Error('Use ownership transfer for owners')
    }
    if (values.role) {
      await tx.update(member).set({ role: values.role }).where(eq(member.id, memberId))
    }
    if (values.usageLimitDollars !== undefined) {
      await setOrgMemberUsageLimit(
        organizationId,
        memberRow.userId,
        values.usageLimitDollars,
        actor.id ?? undefined,
        tx
      )
    }
    return memberRow
  })
  recordAudit({
    actorId: actor.id,
    actorName: actor.name,
    actorEmail: actor.email,
    action: AuditAction.ORG_MEMBER_ROLE_CHANGED,
    resourceType: AuditResourceType.ORGANIZATION,
    resourceId: organizationId,
    description: 'Admin updated organization member',
    metadata: { targetUserId: existing.userId, memberId, ...values },
  })
}

export async function removeDashboardOrganizationMember(
  organizationId: string,
  memberId: string,
  actor: AdminMutationActor
) {
  const [existing] = await db
    .select()
    .from(member)
    .where(and(eq(member.id, memberId), eq(member.organizationId, organizationId)))
    .limit(1)
  if (!existing) throw new Error('Member not found')
  const result = await removeUserFromOrganization({
    userId: existing.userId,
    organizationId,
    memberId,
  })
  if (!result.success) throw new Error(result.error ?? 'Failed to remove member')
  try {
    await reconcileOrganizationSeats({
      organizationId,
      reason: 'admin-member-removed',
      actorId: actor.id ?? undefined,
    })
  } catch {
    // See add path: reconciliation is retry-safe and must not turn a committed
    // membership mutation into an API failure.
  }
  recordAudit({
    actorId: actor.id,
    actorName: actor.name,
    actorEmail: actor.email,
    action: AuditAction.ORG_MEMBER_REMOVED,
    resourceType: AuditResourceType.ORGANIZATION,
    resourceId: organizationId,
    description: 'Admin removed organization member',
    metadata: { targetUserId: existing.userId, memberId },
  })
}

export async function transferDashboardOrganizationOwnership(
  organizationId: string,
  newOwnerUserId: string,
  actor: AdminMutationActor
) {
  const [currentOwner] = await db
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.role, 'owner')))
    .limit(1)
  if (!currentOwner) throw new Error('Organization owner not found')
  const [target] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, newOwnerUserId)))
    .limit(1)
  if (!target) throw new Error('New owner must already be an internal member')
  const result = await transferOrganizationOwnership({
    organizationId,
    currentOwnerUserId: currentOwner.userId,
    newOwnerUserId,
  })
  if (!result.success) throw new Error(result.error ?? 'Ownership transfer failed')
  recordAudit({
    actorId: actor.id,
    actorName: actor.name,
    actorEmail: actor.email,
    action: AuditAction.ORG_MEMBER_ROLE_CHANGED,
    resourceType: AuditResourceType.ORGANIZATION,
    resourceId: organizationId,
    description: 'Admin transferred organization ownership',
    metadata: { previousOwnerUserId: currentOwner.userId, newOwnerUserId },
  })
}
