import { member, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import type { Session } from 'better-auth'
import { APIError } from 'better-auth/api'
import { eq } from 'drizzle-orm'
import { getAccessControlConfig, isEmailBlockedByAccessControl } from '@/lib/auth/access-control'
import { getAuthDatabase } from '@/lib/auth/database-context'
import { clampExpiryForSession } from '@/lib/auth/session-policy'
import { assertSsoRequirementSatisfied } from '@/lib/auth/sso-policy'

const logger = createLogger('SessionHooks')

/**
 * Rejects blocked accounts and applies membership policy using the adapter's current transaction.
 * `context` is the endpoint creating the session; its path is what tells an organization's sign-in
 * requirement whether this session came from the identity provider.
 */
export async function prepareSessionForCreation<T extends Session>(
  session: T,
  context?: { path?: string } | null
) {
  const executor = getAuthDatabase()
  const accessControl = await getAccessControlConfig()
  const [sessionUser] = await executor
    .select({ email: user.email, suspendedAt: user.suspendedAt })
    .from(user)
    .where(eq(user.id, session.userId))
    .limit(1)

  if (sessionUser?.suspendedAt) {
    logger.warn('Blocking session creation for suspended account', { userId: session.userId })
    throw new APIError('FORBIDDEN', {
      message: 'This account is suspended. Please contact your administrator.',
    })
  }

  if (isEmailBlockedByAccessControl(sessionUser?.email, accessControl)) {
    logger.warn('Blocking session creation for blocked account', { userId: session.userId })
    throw new APIError('FORBIDDEN', {
      message: 'Access restricted. Please contact your administrator.',
    })
  }

  /** Users belong to at most one organization, the same assumption the expiry clamp below makes. */
  const [membership] = await executor
    .select({ organizationId: member.organizationId, role: member.role })
    .from(member)
    .where(eq(member.userId, session.userId))
    .limit(1)

  if (!membership) return { data: session }

  /**
   * Outside the fallback below on purpose: a requirement that cannot be read is not a requirement
   * that does not apply, and admitting a password sign-in because a lookup failed is exactly the
   * bypass the setting exists to prevent. The read runs on the transaction that is creating the
   * session, so a failure here means that write is failing too.
   */
  await assertSsoRequirementSatisfied(
    { userId: session.userId, ...membership },
    context?.path,
    executor
  )

  try {
    const expiresAt = await clampExpiryForSession(session, membership.organizationId, executor)
    return {
      data: { ...session, expiresAt, activeOrganizationId: membership.organizationId },
    }
  } catch (error) {
    /** Session policy is an expiry clamp; failing to read it must not cost a valid sign-in. */
    logger.error('Error clamping session expiry', { error, userId: session.userId })
    return { data: { ...session, activeOrganizationId: membership.organizationId } }
  }
}
