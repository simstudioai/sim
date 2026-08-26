import { db } from '@sim/db'
import { member, subscription } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, inArray } from 'drizzle-orm'
import { isOrganizationBillingBlocked } from '@/lib/billing/core/access'
import { USABLE_SUBSCRIPTION_STATUSES } from '@/lib/billing/subscriptions/utils'
import type { ForbiddenDetailCode } from '@/lib/core/application'
import { isAuditLogsEnabled, isBillingEnabled } from '@/lib/core/config/env-flags'

const logger = createLogger('AuditLogAuthorization')

export interface EnterpriseAuditContext {
  organizationId: string
  orgMemberIds: string[]
}

/**
 * A refusal names its cause as well as its wording. This resolver distinguishes
 * four of them — not a member, not an admin, no enterprise plan, audit logging
 * switched off — and each has a different remedy, so collapsing them into one
 * status forced callers to match on the message text.
 */
export type EnterpriseAuditAccessResult =
  | { success: true; context: EnterpriseAuditContext }
  | { success: false; status: 403; code: ForbiddenDetailCode; message: string }

/**
 * The organization an actor belongs to, when it did not name one.
 *
 * `organizationId` is the only input these endpoints cannot be called without,
 * and no API-key-reachable surface publishes one — the v1 audit-log rows carry
 * no organization id, `GET /api/organizations` is session-gated, and the admin
 * organization list needs an admin key. Deriving it from the caller, the way v1
 * always has, is what makes the resource reachable at all.
 *
 * There is no ambiguous case to represent: `member` carries
 * `uniqueIndex('member_user_id_unique').on(member.userId)`, so an actor holds
 * at most one membership row and the derivation is either that row or nothing.
 */
export type DefaultAuditOrganization =
  | { kind: 'resolved'; organizationId: string }
  | { kind: 'none' }

/** Resolves the organization an actor's audit-log read applies to when it named none. */
export async function resolveDefaultAuditOrganization(
  userId: string
): Promise<DefaultAuditOrganization> {
  const [membership] = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, userId))
    .limit(1)

  if (!membership) return { kind: 'none' }
  return { kind: 'resolved', organizationId: membership.organizationId }
}

/** Resolves transport-neutral enterprise audit-log access for an organization administrator. */
export async function resolveEnterpriseAuditAccess(
  userId: string,
  targetOrganizationId?: string
): Promise<EnterpriseAuditAccessResult> {
  const [membership] = await db
    .select({ organizationId: member.organizationId, role: member.role })
    .from(member)
    .where(
      targetOrganizationId
        ? and(eq(member.userId, userId), eq(member.organizationId, targetOrganizationId))
        : eq(member.userId, userId)
    )
    .limit(1)

  if (!membership) {
    return {
      success: false,
      status: 403,
      code: 'ORGANIZATION_MEMBERSHIP_REQUIRED',
      message: targetOrganizationId
        ? 'Not a member of the requested organization'
        : 'Not a member of any organization',
    }
  }

  if (membership.role !== 'admin' && membership.role !== 'owner') {
    return {
      success: false,
      status: 403,
      code: 'ORGANIZATION_ADMIN_REQUIRED',
      message: 'Organization admin or owner role required',
    }
  }

  if (isBillingEnabled) {
    const billingBlocked = await isOrganizationBillingBlocked(membership.organizationId)
    if (billingBlocked) {
      return {
        success: false,
        status: 403,
        code: 'ENTERPRISE_PLAN_REQUIRED',
        message: 'Active enterprise subscription required',
      }
    }
  } else if (!isAuditLogsEnabled) {
    return {
      success: false,
      status: 403,
      code: 'AUDIT_LOGS_DISABLED',
      message:
        'Audit logs are disabled. Set ENTERPRISE_ENABLED or AUDIT_LOGS_ENABLED to enable them.',
    }
  }

  const [orgSub, orgMembers] = await Promise.all([
    isBillingEnabled
      ? db
          .select({ id: subscription.id })
          .from(subscription)
          .where(
            and(
              eq(subscription.referenceId, membership.organizationId),
              eq(subscription.plan, 'enterprise'),
              inArray(subscription.status, USABLE_SUBSCRIPTION_STATUSES)
            )
          )
          .limit(1)
      : Promise.resolve([]),
    db
      .select({ userId: member.userId })
      .from(member)
      .where(eq(member.organizationId, membership.organizationId)),
  ])

  if (isBillingEnabled && orgSub.length === 0) {
    return {
      success: false,
      status: 403,
      code: 'ENTERPRISE_PLAN_REQUIRED',
      message: 'Active enterprise subscription required',
    }
  }

  const orgMemberIds = orgMembers.map((organizationMember) => organizationMember.userId)
  logger.info('Enterprise audit access validated', {
    userId,
    organizationId: membership.organizationId,
    memberCount: orgMemberIds.length,
  })

  return {
    success: true,
    context: { organizationId: membership.organizationId, orgMemberIds },
  }
}
