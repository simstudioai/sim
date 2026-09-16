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
 * How many of a person's organizations the sign-in requirement is evaluated against. People belong
 * to a handful, and the cap keeps one pathological account from scanning without bound.
 */
const MEMBERSHIP_SCAN_LIMIT = 50

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

  try {
    const memberships = await executor
      .select({ organizationId: member.organizationId, role: member.role })
      .from(member)
      .where(eq(member.userId, session.userId))
      .limit(MEMBERSHIP_SCAN_LIMIT)

    const [membership] = memberships
    if (!membership) return { data: session }

    await assertSsoRequirementSatisfied(session.userId, memberships, context?.path, executor)

    const expiresAt = await clampExpiryForSession(session, membership.organizationId, executor)
    return {
      data: { ...session, expiresAt, activeOrganizationId: membership.organizationId },
    }
  } catch (error) {
    /** A refused sign-in is the policy working; only unexpected failures fall through. */
    if (error instanceof APIError) throw error
    logger.error('Error setting active organization', { error, userId: session.userId })
    return { data: session }
  }
}
