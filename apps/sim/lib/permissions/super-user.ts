import { cache } from 'react'
import { db, dbReplica } from '@sim/db'
import { settings, user } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'

/**
 * Verifies if a user is an effective super user (database flag AND settings toggle).
 * This should be used for features that can be disabled by the user's settings toggle.
 *
 * @param userId - The ID of the user to check
 * @returns Object with effectiveSuperUser boolean and component values
 */
export async function verifyEffectiveSuperUser(
  userId: string,
  executor: DbOrTx = db
): Promise<{
  effectiveSuperUser: boolean
  isSuperUser: boolean
  superUserModeEnabled: boolean
}> {
  const [currentUser] = await executor
    .select({ role: user.role })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)

  const [userSettings] = await executor
    .select({ superUserModeEnabled: settings.superUserModeEnabled })
    .from(settings)
    .where(eq(settings.userId, userId))
    .limit(1)

  const isSuperUser = currentUser?.role === 'admin'
  const superUserModeEnabled = userSettings?.superUserModeEnabled ?? false

  return {
    effectiveSuperUser: isSuperUser && superUserModeEnabled,
    isSuperUser,
    superUserModeEnabled,
  }
}

/**
 * Reads platform-admin status from the supplied transaction or, by default, the replica.
 * Request-memoized by viewer and executor so transactions never reuse another connection's result.
 */
export const isPlatformAdmin = cache(
  async (userId: string, executor: DbOrTx = dbReplica): Promise<boolean> => {
    const [row] = await executor
      .select({ role: user.role })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1)

    return row?.role === 'admin'
  }
)
