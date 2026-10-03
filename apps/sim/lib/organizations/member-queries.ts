import { db } from '@sim/db'
import { member, user, userStats } from '@sim/db/schema'
import { count, eq, inArray } from 'drizzle-orm'
import type { CursorKey } from '@/lib/api/list-query'
import { getOrganizationMemberUsageSnapshot } from '@/lib/billing/core/organization'
import {
  listOrganizationMemberRecords,
  type OrganizationListOptions,
  type OrganizationMemberSortBy,
  organizationMemberSelection,
} from '@/lib/organizations/queries'

export type OrganizationMemberPageInput = OrganizationListOptions<OrganizationMemberSortBy> & {
  offset?: number
  includeUsage?: boolean
}
type MemberRecord = Awaited<ReturnType<typeof listOrganizationMemberRecords>>['data'][number]
export interface OrganizationMemberUsageRecord extends MemberRecord {
  currentUsageLimit?: string | null
  usageLimitUpdatedAt?: Date | null
  currentPeriodCost?: string
  billingPeriodStart?: Date | null
  billingPeriodEnd?: Date | null
}

/** Preserves offset pagination for the internal directory while public clients use keysets. */
export async function readOrganizationMemberPage(
  organizationId: string,
  input: OrganizationMemberPageInput
): Promise<{
  data: OrganizationMemberUsageRecord[]
  nextCursorKeys: CursorKey[] | null
  total?: number
}> {
  let data: OrganizationMemberUsageRecord[]
  let nextCursorKeys: CursorKey[] | null = null
  let total: number | undefined
  if (input.offset !== undefined) {
    const [rows, totals] = await Promise.all([
      db
        .select(organizationMemberSelection)
        .from(member)
        .innerJoin(user, eq(member.userId, user.id))
        .where(eq(member.organizationId, organizationId))
        .orderBy(user.name, user.id)
        .limit(input.limit)
        .offset(input.offset),
      db.select({ value: count() }).from(member).where(eq(member.organizationId, organizationId)),
    ])
    data = rows
    total = totals[0]?.value ?? 0
  } else {
    const page = await listOrganizationMemberRecords(organizationId, input)
    data = page.data
    nextCursorKeys = page.nextCursorKeys
  }
  if (input.includeUsage) {
    const ids = data.map((row) => row.userId)
    const [limits, snapshot] = await Promise.all([
      ids.length
        ? db
            .select({
              userId: userStats.userId,
              currentUsageLimit: userStats.currentUsageLimit,
              usageLimitUpdatedAt: userStats.usageLimitUpdatedAt,
            })
            .from(userStats)
            .where(inArray(userStats.userId, ids))
        : [],
      getOrganizationMemberUsageSnapshot(organizationId, { userIds: ids }),
    ])
    const byUser = new Map(limits.map((row) => [row.userId, row]))
    data = data.map((row) => ({
      ...row,
      currentUsageLimit: byUser.get(row.userId)?.currentUsageLimit ?? null,
      usageLimitUpdatedAt: byUser.get(row.userId)?.usageLimitUpdatedAt ?? null,
      currentPeriodCost: (snapshot.usageByUser.get(row.userId) ?? 0).toString(),
      billingPeriodStart: snapshot.billingPeriod?.start ?? null,
      billingPeriodEnd: snapshot.billingPeriod?.end ?? null,
    }))
  }
  return { data, nextCursorKeys, total }
}
