import type { SessionPrincipal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { session } from '@sim/db/schema'
import { and, eq, gt } from 'drizzle-orm'
import { isAuthDisabled } from '@/lib/core/config/env-flags'

/**
 * Whether the session behind a principal still exists and has not expired. Sign-out
 * and every revocation path delete the row, so a long-lived connection authenticated
 * once at open re-reads this to learn its credential is gone. With auth disabled the
 * anonymous session has no row and cannot be revoked, so it is always active.
 */
export async function isSessionActive({ userId, sessionId }: SessionPrincipal): Promise<boolean> {
  if (isAuthDisabled) return true
  const [row] = await db
    .select({ id: session.id })
    .from(session)
    .where(
      and(eq(session.id, sessionId), eq(session.userId, userId), gt(session.expiresAt, new Date()))
    )
    .limit(1)
  return Boolean(row)
}
