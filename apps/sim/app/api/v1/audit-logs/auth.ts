/**
 * Enterprise audit log authorization.
 *
 * Validates that the authenticated user is an admin/owner of an enterprise organization
 * and returns the organization context needed for scoped queries.
 */

import { db } from '@sim/db'
import { member, subscription } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, inArray } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { isOrganizationBillingBlocked } from '@/lib/billing/core/access'
import { USABLE_SUBSCRIPTION_STATUSES } from '@/lib/billing/subscriptions/utils'
import { isAuditLogsEnabled, isBillingEnabled } from '@/lib/core/config/env-flags'

const logger = createLogger('V1AuditLogsAuth')

interface EnterpriseAuditContext {
  organizationId: string
  orgMemberIds: string[]
}

type AuthResult =
  | { success: true; context: EnterpriseAuditContext }
  | { success: false; response: NextResponse }

/**
 * Structured enterprise audit-access result shared by the v1 and v2 surfaces so
 * each version can render the failure in its own response envelope.
 */
export type EnterpriseAuditAccessResult =
  | { success: true; context: EnterpriseAuditContext }
  | { success: false; status: number; message: string }

/**
 * Core enterprise audit-access check (no response rendering).
 *
 * Checks:
 * 1. User belongs to an organization (the target one when
 *    `targetOrganizationId` is given)
 * 2. User has admin or owner role
 * 3. The organization is entitled to audit logs — an active enterprise
 *    subscription when billing runs, otherwise the deployment's audit-logs
 *    entitlement
 *
 * The subscription query is skipped entirely with billing off. Requiring it
 * there made audit logs unreachable on every self-hosted deployment, since no
 * subscription row is ever written without billing.
 *
 * Returns the organization ID and all member user IDs on success.
 */
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
    return { success: false, status: 403, message: 'Not a member of any organization' }
  }

  if (membership.role !== 'admin' && membership.role !== 'owner') {
    return { success: false, status: 403, message: 'Organization admin or owner role required' }
  }

  if (isBillingEnabled) {
    const billingBlocked = await isOrganizationBillingBlocked(membership.organizationId)
    if (billingBlocked) {
      return { success: false, status: 403, message: 'Active enterprise subscription required' }
    }
  } else if (!isAuditLogsEnabled) {
    return {
      success: false,
      status: 403,
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
    return { success: false, status: 403, message: 'Active enterprise subscription required' }
  }

  const orgMemberIds = orgMembers.map((m) => m.userId)

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

/**
 * v1 wrapper: renders {@link resolveEnterpriseAuditAccess} as the v1 `{ error }`
 * response body.
 */
export async function validateEnterpriseAuditAccess(
  userId: string,
  targetOrganizationId?: string
): Promise<AuthResult> {
  const result = await resolveEnterpriseAuditAccess(userId, targetOrganizationId)
  if (result.success) return { success: true, context: result.context }
  return {
    success: false,
    response: NextResponse.json({ error: result.message }, { status: result.status }),
  }
}
