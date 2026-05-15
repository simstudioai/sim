import { db } from '@sim/db'
import { user } from '@sim/db/schema'
import { and, eq, inArray } from 'drizzle-orm'

/**
 * Returns true when the user has the platform-level `admin` role. Platform
 * admins are Sim employees with elevated access; many subscription gates are
 * bypassed for them so internal usage isn't paywalled.
 */
export async function isPlatformAdmin(userId: string): Promise<boolean> {
  const [row] = await db.select({ role: user.role }).from(user).where(eq(user.id, userId)).limit(1)
  return row?.role === 'admin'
}

/**
 * Bulk variant. Returns the set of userIds (from the input) that are platform
 * admins. Used by callers that need to evaluate many users at once (e.g.
 * listing every workspace a user can see and resolving invite policy).
 */
export async function getPlatformAdminUserIds(userIds: string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set()
  const rows = await db
    .select({ id: user.id })
    .from(user)
    .where(and(inArray(user.id, userIds), eq(user.role, 'admin')))
  return new Set(rows.map((r) => r.id))
}
