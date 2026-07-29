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
 * Validates enterprise audit log access for the given user.
 *
 * Checks:
 * 1. User belongs to an organization
 * 2. User has admin or owner role
 * 3. The organization is entitled to audit logs — an active enterprise
 *    subscription when billing runs, otherwise the deployment's audit-logs
 *    entitlement
 *
 * The subscription query is skipped entirely with billing off. Requiring it
 * there made audit logs unreachable on every self-hosted deployment, since no
 * subscription row is ever written without billing.
 *
 * Returns the organization ID and all member user IDs on success,
 * or an error response on failure.
 */
export async function validateEnterpriseAuditAccess(
  userId: string,
  targetOrganizationId?: string
): Promise<AuthResult> {
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
      response: NextResponse.json({ error: 'Not a member of any organization' }, { status: 403 }),
    }
  }

  if (membership.role !== 'admin' && membership.role !== 'owner') {
    return {
      success: false,
      response: NextResponse.json(
        { error: 'Organization admin or owner role required' },
        { status: 403 }
      ),
    }
  }

  if (isBillingEnabled) {
    const billingBlocked = await isOrganizationBillingBlocked(membership.organizationId)
    if (billingBlocked) {
      return {
        success: false,
        response: NextResponse.json(
          { error: 'Active enterprise subscription required' },
          { status: 403 }
        ),
      }
    }
  } else if (!isAuditLogsEnabled) {
    return {
      success: false,
      response: NextResponse.json(
        {
          error:
            'Audit logs are disabled. Set ENTERPRISE_ENABLED or AUDIT_LOGS_ENABLED to enable them.',
        },
        { status: 403 }
      ),
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
      response: NextResponse.json(
        { error: 'Active enterprise subscription required' },
        { status: 403 }
      ),
    }
  }

  const orgMemberIds = orgMembers.map((m) => m.userId)

  logger.info('Enterprise audit access validated', {
    userId,
    organizationId: membership.organizationId,
    memberCount: orgMemberIds.length,
  })

  return {
    success: true,
    context: {
      organizationId: membership.organizationId,
      orgMemberIds,
    },
  }
}
