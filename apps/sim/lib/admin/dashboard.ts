import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import {
  member,
  organization,
  organizationMemberUsageLimit,
  permissions,
  subscription,
  user,
  userStats,
  workspace,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, count, countDistinct, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm'
import {
  creditGrantDollars,
  getOrganizationUsageLimitFallbackDollars,
  getTeamOrganizationEconomics,
} from '@/lib/admin/organization-economics'
import { getHighestPrioritySubscription } from '@/lib/billing/core/plan'
import { creditsToDollars, dollarsToCredits } from '@/lib/billing/credits/conversion'
import {
  ENTERPRISE_METADATA_SYNC_EVENT_TYPE,
  resolveEnterpriseMetadataIntent,
} from '@/lib/billing/enterprise-outbox'
import { getLatestEnterpriseProvisionings } from '@/lib/billing/enterprise-provisioning'
import { setOrgMemberUsageLimit } from '@/lib/billing/organizations/member-limits'
import {
  acquireOrganizationMutationLock,
  ensureUserInOrganizationTx,
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
import { executeTransactionallyIdempotent } from '@/lib/core/idempotency/transaction'
import { enqueueOutboxEvent } from '@/lib/core/outbox/service'
import type { DbOrTx } from '@/lib/db/types'

interface PaginationInput {
  search: string
  limit: number
  offset: number
}

export interface AdminMutationActor {
  id: string | null
  name: string
  email: string | null
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
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
  }
): Promise<{ version: number; desiredMetadata: Record<string, unknown> }> {
  const intent = await resolveEnterpriseMetadataIntent(
    tx,
    params.subscriptionId,
    params.appliedMetadata
  )
  const {
    simConfigRevision: _appliedRevision,
    simConfigOperationId: _appliedOperationId,
    ...current
  } = {
    ...intent.desiredMetadata,
  }
  const desiredMetadata = params.buildDesiredMetadata(current)
  const version = intent.latestRevision + 1

  await enqueueOutboxEvent(tx, ENTERPRISE_METADATA_SYNC_EVENT_TYPE, {
    subscriptionId: params.subscriptionId,
    revision: version,
    deliveryRevision: 0,
    metadata: desiredMetadata,
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

export async function listDashboardUsers({ search, limit, offset }: PaginationInput) {
  const trimmed = search.trim()
  const where = trimmed
    ? or(ilike(user.name, `%${trimmed}%`), ilike(user.email, `%${trimmed}%`), eq(user.id, trimmed))
    : undefined
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
  return {
    data: rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      activeOrganization:
        row.organizationId && row.organizationName
          ? { id: row.organizationId, name: row.organizationName }
          : null,
    })),
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
        .where(and(isNull(member.id), isNull(workspace.archivedAt))),
      getLatestSubscription(organizationId),
      getLatestEnterpriseProvisionings([organizationId]),
    ])
  if (!org) return null

  const [owner] = await db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(member.organizationId, organizationId), eq(member.role, 'owner')))
    .limit(1)
  const metadata = metadataRecord(latestSubscription?.metadata)
  const memberCount = memberCountRow?.value ?? 0
  const teamEconomics = getTeamOrganizationEconomics(latestSubscription?.plan, memberCount)
  const includedMonthlyCredits =
    teamEconomics?.includedMonthlyCredits ??
    Math.max(0, Math.round(metadataNumber(metadata, 'includedMonthlyCredits') ?? 0))
  const invoiceAmountCents = metadataNumber(metadata, 'invoiceAmountCents')
  const monthlyPrice = metadataNumber(metadata, 'monthlyPrice')
  const effectiveUsageLimitCredits = dollarsToCredits(Number(org.orgUsageLimit ?? 0))
  const metadataUsageLimitCredits = metadataNumber(metadata, 'usageLimitCredits')
  const usageLimitCredits = Math.max(
    0,
    metadataUsageLimitCredits === null
      ? effectiveUsageLimitCredits
      : Math.round(metadataUsageLimitCredits)
  )
  const seats =
    latestSubscription?.plan === 'enterprise'
      ? Math.max(0, Math.round(metadataNumber(metadata, 'seats') ?? 0))
      : memberCount

  return {
    id: org.id,
    name: org.name,
    owner: owner ?? null,
    isActive: hasPaidSubscriptionStatus(latestSubscription?.status),
    subscriptionStatus: latestSubscription?.status ?? null,
    plan: latestSubscription?.plan ?? null,
    planLabel: planLabel(latestSubscription?.plan ?? null),
    memberCount,
    externalCollaboratorCount: externalCountRow?.value ?? 0,
    seats,
    includedMonthlyCredits,
    usageLimitCredits,
    effectiveUsageLimitCredits,
    prepaidCredits: dollarsToCredits(Number(org.creditBalance ?? 0)),
    monthlyInvoiceAmountUsd:
      latestSubscription?.plan === 'enterprise'
        ? invoiceAmountCents !== null
          ? invoiceAmountCents / 100
          : (monthlyPrice ?? null)
        : (teamEconomics?.monthlyInvoiceAmountUsd ?? null),
    provisioning: provisionings.get(organizationId) ?? null,
    subscription: latestSubscription,
  }
}

export async function listDashboardOrganizations({ search, limit, offset }: PaginationInput) {
  const trimmed = search.trim()
  const where = trimmed
    ? or(ilike(organization.name, `%${trimmed}%`), eq(organization.id, trimmed))
    : undefined
  const [totalRow, rows] = await Promise.all([
    db.select({ total: count() }).from(organization).where(where),
    db
      .select({ id: organization.id })
      .from(organization)
      .where(where)
      .orderBy(organization.name, organization.id)
      .limit(limit)
      .offset(offset),
  ])
  const summaries = await Promise.all(rows.map((row) => getDashboardOrganizationSummary(row.id)))
  const data = summaries.filter((row): row is NonNullable<typeof row> => row !== null)
  return {
    data: data.map(({ subscription: _subscription, ...summary }) => summary),
    pagination: {
      total: totalRow[0]?.total ?? 0,
      limit,
      offset,
      hasMore: offset + data.length < (totalRow[0]?.total ?? 0),
    },
  }
}

export async function getDashboardOrganization(organizationId: string) {
  const summary = await getDashboardOrganizationSummary(organizationId)
  if (!summary) return null
  const [memberRows, externalRows, workspaceRows, limitRows] = await Promise.all([
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
      .orderBy(user.name),
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
      .where(and(isNull(member.id), isNull(workspace.archivedAt)))
      .groupBy(user.id, user.name, user.email)
      .orderBy(user.name),
    db
      .select({ id: workspace.id, name: workspace.name })
      .from(workspace)
      .where(eq(workspace.organizationId, organizationId))
      .orderBy(workspace.name),
    db
      .select({
        userId: organizationMemberUsageLimit.userId,
        limit: organizationMemberUsageLimit.usageLimit,
      })
      .from(organizationMemberUsageLimit)
      .where(eq(organizationMemberUsageLimit.organizationId, organizationId)),
  ])
  const limits = new Map(limitRows.map((row) => [row.userId, dollarsToCredits(Number(row.limit))]))
  const { subscription: subscriptionRow, ...base } = summary
  return {
    ...base,
    members: memberRows.map((row) => ({
      ...row,
      usageLimitCredits: limits.get(row.userId) ?? null,
    })),
    externalCollaborators: externalRows.map((row) => ({
      ...row,
      workspaceCount: row.workspaceCount,
      usageLimitCredits: limits.get(row.userId) ?? null,
    })),
    workspaces: workspaceRows,
    subscription: subscriptionRow
      ? {
          id: subscriptionRow.id,
          plan: subscriptionRow.plan,
          status: subscriptionRow.status,
          periodStart: subscriptionRow.periodStart?.toISOString() ?? null,
          periodEnd: subscriptionRow.periodEnd?.toISOString() ?? null,
          stripeSubscriptionId: subscriptionRow.stripeSubscriptionId,
          invoiceAmountUsd: base.monthlyInvoiceAmountUsd,
        }
      : null,
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
    if (seats < (memberCountRow?.value ?? 0)) {
      throw new Error('Seat capacity cannot be below current internal membership')
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
    description: `Admin set Enterprise seat capacity to ${seats}`,
    metadata: { seats },
  })
}

export async function updateDashboardOrganizationLimits(
  organizationId: string,
  values: { includedMonthlyCredits?: number; usageLimitCredits?: number },
  actor: AdminMutationActor
) {
  await db.transaction(async (tx) => {
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
    if (values.includedMonthlyCredits !== undefined && subscriptionRow?.plan !== 'enterprise') {
      throw new Error('Included allowance is editable only for Enterprise organizations')
    }

    if (subscriptionRow?.plan === 'enterprise') {
      if (!hasPaidSubscriptionStatus(subscriptionRow.status)) {
        throw new Error('Enterprise limits can be changed only for an active subscription')
      }
      await enqueueEnterpriseMetadataIntent(tx, {
        subscriptionId: subscriptionRow.id,
        appliedMetadata: subscriptionRow.metadata,
        buildDesiredMetadata: (current) => {
          const included =
            values.includedMonthlyCredits ??
            Math.round(metadataNumber(current, 'includedMonthlyCredits') ?? 0)
          const configuredUsageLimit =
            values.usageLimitCredits ??
            Math.round(
              metadataNumber(current, 'usageLimitCredits') ??
                dollarsToCredits(Number(org.orgUsageLimit ?? 0))
            )
          return {
            ...current,
            includedMonthlyCredits: included,
            usageLimitCredits: configuredUsageLimit,
          }
        },
      })
      return
    }

    const [memberCountRow] = await tx
      .select({ value: count() })
      .from(member)
      .where(eq(member.organizationId, organizationId))
    const teamEconomics = getTeamOrganizationEconomics(
      subscriptionRow?.plan,
      memberCountRow?.value ?? 0
    )
    const included =
      values.includedMonthlyCredits ??
      (teamEconomics
        ? teamEconomics.includedMonthlyCredits
        : Math.round(metadataNumber(metadata, 'includedMonthlyCredits') ?? 0))
    const prepaid = dollarsToCredits(Number(org.creditBalance))
    const configuredUsageLimit =
      values.usageLimitCredits ??
      Math.round(
        metadataNumber(metadata, 'usageLimitCredits') ??
          dollarsToCredits(Number(org.orgUsageLimit ?? 0))
      )
    const effective = Math.max(configuredUsageLimit, included + prepaid)
    await tx
      .update(organization)
      .set({ orgUsageLimit: creditsToDollars(effective).toString(), updatedAt: new Date() })
      .where(eq(organization.id, organizationId))
    if (subscriptionRow) {
      await tx
        .update(subscription)
        .set({
          metadata: {
            ...metadata,
            ...(subscriptionRow.plan === 'enterprise' ? { includedMonthlyCredits: included } : {}),
            usageLimitCredits: configuredUsageLimit,
          },
        })
        .where(eq(subscription.id, subscriptionRow.id))
    }
  })
  recordAudit({
    actorId: actor.id,
    actorName: actor.name,
    actorEmail: actor.email,
    action: AuditAction.ORGANIZATION_UPDATED,
    resourceType: AuditResourceType.ORGANIZATION,
    resourceId: organizationId,
    description: 'Admin updated organization credit limits',
    metadata: values,
  })
}

export async function grantDashboardOrganizationCredits(
  organizationId: string,
  credits: number,
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
        credits,
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
        const included = teamEconomics
          ? teamEconomics.includedMonthlyCredits
          : Math.round(
              metadataNumber(metadataRecord(subscriptionRow?.metadata), 'includedMonthlyCredits') ??
                0
            )
        const subscriptionMetadata = metadataRecord(subscriptionRow?.metadata)
        const configuredUsageLimit = metadataNumber(subscriptionMetadata, 'usageLimitCredits')
        const grantDollarDelta = creditGrantDollars(credits)
        const usageLimitFallback = getOrganizationUsageLimitFallbackDollars({
          creditBalanceDollarsBeforeGrant: org.creditBalance,
          includedCredits: included,
          configuredUsageLimitCredits: configuredUsageLimit,
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
          prepaidCredits: dollarsToCredits(Number(updated.creditBalance)),
          usageLimitCredits: dollarsToCredits(Number(updated.orgUsageLimit)),
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
      description: `Admin granted ${credits} credits to organization`,
      metadata: { credits, reason: normalizedReason, operationId },
    })
  }
  return outcome.result
}

export async function grantDashboardUserCredits(
  userId: string,
  credits: number,
  reason: string | undefined,
  operationId: string,
  actor: AdminMutationActor
) {
  const normalizedReason = reason?.trim() || null
  const outcome = await db.transaction(async (tx) => {
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
      requestFingerprint: JSON.stringify({ userId, credits, reason: normalizedReason }),
      operation: async () => {
        const [currentMembership] = await tx
          .select({ organizationId: member.organizationId })
          .from(member)
          .where(eq(member.userId, userId))
          .limit(1)
        if (currentMembership) {
          throw new Error(
            `User belongs to organization ${currentMembership.organizationId}; grant credits from Organizations instead`
          )
        }
        const billingSubscription = await getHighestPrioritySubscription(userId, {
          executor: tx,
          onError: 'throw',
        })
        if (isOrgScopedSubscription(billingSubscription, userId)) {
          throw new Error(
            'User is billed through an organization; grant credits from Organizations instead'
          )
        }

        const grantDollarDelta = creditGrantDollars(credits)
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
          prepaidCredits: dollarsToCredits(Number(updated.creditBalance)),
          usageLimitCredits: dollarsToCredits(Number(updated.currentUsageLimit)),
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
      description: `Admin granted ${credits} credits to user`,
      metadata: { credits, reason: normalizedReason, operationId },
    })
  }
  return outcome.result
}

export async function addDashboardOrganizationMember(
  organizationId: string,
  values: { userId: string; role: 'admin' | 'member'; usageLimitCredits?: number | null },
  actor: AdminMutationActor
) {
  const result = await db.transaction(async (tx) => {
    await acquireOrganizationMutationLock(tx, organizationId)
    const [organizationSubscription] = await tx
      .select({ plan: subscription.plan })
      .from(subscription)
      .where(
        and(
          eq(subscription.referenceId, organizationId),
          inArray(subscription.status, ENTITLED_SUBSCRIPTION_STATUSES)
        )
      )
      .orderBy(desc(subscription.periodStart))
      .limit(1)
    const membershipResult = await ensureUserInOrganizationTx(tx, {
      userId: values.userId,
      organizationId,
      role: values.role,
      skipSeatValidation: organizationSubscription?.plan.startsWith('team') ?? false,
    })
    if (membershipResult.success && values.usageLimitCredits !== undefined) {
      await setOrgMemberUsageLimit(
        organizationId,
        values.userId,
        values.usageLimitCredits === null ? null : creditsToDollars(values.usageLimitCredits),
        actor.id ?? undefined,
        tx
      )
    }
    return membershipResult
  })
  if (!result.success || !result.memberId || result.alreadyMember) {
    throw new Error(
      result.alreadyMember ? 'User is already a member' : (result.error ?? 'Failed to add member')
    )
  }
  try {
    await reconcileOrganizationSeats({
      organizationId,
      reason: 'admin-member-added',
      actorId: actor.id ?? undefined,
    })
  } catch {
    // Membership is canonical; Team seat reconciliation is idempotent and the
    // next membership mutation retries it. Do not report the committed add as failed.
  }
  recordAudit({
    actorId: actor.id,
    actorName: actor.name,
    actorEmail: actor.email,
    action: AuditAction.ORG_MEMBER_ADDED,
    resourceType: AuditResourceType.ORGANIZATION,
    resourceId: organizationId,
    description: `Admin added organization member as ${values.role}`,
    metadata: { targetUserId: values.userId, memberId: result.memberId },
  })
  return result.memberId
}

export async function updateDashboardOrganizationMember(
  organizationId: string,
  memberId: string,
  values: { role?: 'admin' | 'member'; usageLimitCredits?: number | null },
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
    if (values.usageLimitCredits !== undefined) {
      await setOrgMemberUsageLimit(
        organizationId,
        memberRow.userId,
        values.usageLimitCredits === null ? null : creditsToDollars(values.usageLimitCredits),
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
