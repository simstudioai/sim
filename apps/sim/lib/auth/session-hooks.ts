import { member, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import type { Session } from 'better-auth'
import { APIError } from 'better-auth/api'
import { eq } from 'drizzle-orm'
import { getAccessControlConfig, isEmailBlockedByAccessControl } from '@/lib/auth/access-control'
import { getAuthDatabase } from '@/lib/auth/database-context'
import { clampExpiryForSession } from '@/lib/auth/session-policy'

const logger = createLogger('SessionHooks')

/** Rejects blocked accounts and applies membership policy using the adapter's current transaction. */
export async function prepareSessionForCreation<T extends Session>(session: T) {
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
    const [membership] = await executor
      .select({ organizationId: member.organizationId })
      .from(member)
      .where(eq(member.userId, session.userId))
      .limit(1)

    if (!membership) return { data: session }

    const expiresAt = await clampExpiryForSession(session, membership.organizationId, executor)
    return {
      data: { ...session, expiresAt, activeOrganizationId: membership.organizationId },
    }
  } catch (error) {
    logger.error('Error setting active organization', { error, userId: session.userId })
    return { data: session }
  }
}
