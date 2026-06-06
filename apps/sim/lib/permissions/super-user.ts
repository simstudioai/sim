import { db } from '@sim/db'
import { settings, user } from '@sim/db/schema'
import { eq } from 'drizzle-orm'

/**
 * Verifies if a user is an effective super user (database flag AND settings toggle).
 * This should be used for features that can be disabled by the user's settings toggle.
 *
 * @param userId - The ID of the user to check
 * @returns Object with effectiveSuperUser boolean and component values
 */
export async function verifyEffectiveSuperUser(userId: string): Promise<{
  effectiveSuperUser: boolean
  isSuperUser: boolean
  superUserModeEnabled: boolean
}> {
  const [currentUser] = await db
    .select({ role: user.role })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)

  const [userSettings] = await db
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
