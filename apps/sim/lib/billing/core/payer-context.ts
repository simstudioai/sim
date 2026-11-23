import { db, dbReplica } from '@sim/db'
import { member, userStats, workspace } from '@sim/db/schema'
import { and, asc, eq, isNull } from 'drizzle-orm'
import type { DbClient } from '@/lib/db/types'

export interface BillingBlockState {
  billingBlocked: boolean
  billingBlockedReason: 'payment_failed' | 'dispute' | null
  blockedByOrgOwner: boolean
}

type PayerTarget = { type: 'user'; id: string } | { type: 'organization'; id: string }

/** The `workspace` rows whose host billing identity is `payer`: an organization's, or a person's own. */
export function workspacesPaidBy(payer: PayerTarget) {
  return payer.type === 'organization'
    ? eq(workspace.organizationId, payer.id)
    : and(eq(workspace.billedAccountUserId, payer.id), isNull(workspace.organizationId))
}

/** Finds an active workspace whose host billing identity is the requested payer. */
export async function getUpgradeWorkspaceId(
  target: PayerTarget,
  executor: DbClient = db
): Promise<string | null> {
  const targetPredicate = workspacesPaidBy(target)

  const [record] = await executor
    .select({ id: workspace.id })
    .from(workspace)
    .where(and(targetPredicate, isNull(workspace.archivedAt)))
    .orderBy(asc(workspace.createdAt), asc(workspace.id))
    .limit(1)

  return record?.id ?? null
}

/** Reads the organization's payer block from its owner, never from the viewer. */
export async function getOrganizationBillingBlockState(
  organizationId: string,
  viewerUserId: string,
  executor: DbClient = dbReplica
): Promise<BillingBlockState> {
  const [owner] = await executor
    .select({
      userId: member.userId,
      billingBlocked: userStats.billingBlocked,
      billingBlockedReason: userStats.billingBlockedReason,
    })
    .from(member)
    .leftJoin(userStats, eq(userStats.userId, member.userId))
    .where(and(eq(member.organizationId, organizationId), eq(member.role, 'owner')))
    .limit(1)

  const billingBlocked = Boolean(owner?.billingBlocked)
  return {
    billingBlocked,
    billingBlockedReason: billingBlocked ? (owner?.billingBlockedReason ?? null) : null,
    blockedByOrgOwner: billingBlocked && owner?.userId !== viewerUserId,
  }
}
