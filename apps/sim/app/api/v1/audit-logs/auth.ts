/**
 * Enterprise audit log authorization.
 *
 * Validates that the authenticated user is an admin/owner of an enterprise organization
 * and returns the organization context needed for scoped queries.
 */

import { db } from '@sim/db'
import { member, subscription } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'

const logger = createLogger('V1AuditLogsAuth')

export interface EnterpriseAuditContext {
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
 * 3. Organization has an active enterprise subscription
 *
 * Returns the organization ID and all member user IDs on success,
 * or an error response on failure.
 */
export async function validateEnterpriseAuditAccess(userId: string): Promise<AuthResult> {
  const [membership] = await db
    .select({ organizationId: member.organizationId, role: member.role })
    .from(member)
    .where(eq(member.userId, userId))
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

  const [orgSub, orgMembers] = await Promise.all([
    db
      .select({ id: subscription.id })
      .from(subscription)
      .where(
        and(
          eq(subscription.referenceId, membership.organizationId),
          eq(subscription.plan, 'enterprise'),
          eq(subscription.status, 'active')
        )
      )
      .limit(1),
    db
      .select({ userId: member.userId })
      .from(member)
      .where(eq(member.organizationId, membership.organizationId)),
  ])

  if (orgSub.length === 0) {
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
