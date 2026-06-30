import { db, dbReplica } from '@sim/db'
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

/**
 * True when the user is a platform admin (`role === 'admin'`). A single-column read
 * served from the replica: this gates features, not security-critical auth, so it
 * tolerates the replica's bounded staleness (admin role rarely changes). Falls back
 * to the primary when no replica is configured.
 */
export async function isPlatformAdmin(userId: string): Promise<boolean> {
  const [row] = await dbReplica
    .select({ role: user.role })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)

  return row?.role === 'admin'
}
