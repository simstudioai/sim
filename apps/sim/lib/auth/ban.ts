import { db, user } from '@sim/db'
import { inArray, sql } from 'drizzle-orm'
import { getAccessControlConfig, isEmailBlockedByAccessControl } from '@/lib/auth/access-control'

/**
 * True when a ban is currently in effect. Mirrors better-auth admin-plugin
 * semantics: a ban whose `banExpires` is in the past is treated as lifted.
 */
export function isBanActive(row: { banned: boolean | null; banExpires: Date | null }): boolean {
  if (!row.banned) return false
  if (row.banExpires && row.banExpires.getTime() <= Date.now()) return false
  return true
}

/**
 * True when a raw email (e.g. an inbound sender) is blocked: it is in the
 * appconfig blocked-emails list, its domain is in the blocked-domains list,
 * or it belongs to an account with an active ban. Covers senders that don't
 * resolve to a known user id.
 */
export async function isEmailBlocked(email: string | null | undefined): Promise<boolean> {
  if (!email) return false
  const accessControl = await getAccessControlConfig()
  if (isEmailBlockedByAccessControl(email, accessControl)) return true
  const rows = await db
    .select({ banned: user.banned, banExpires: user.banExpires })
    .from(user)
    .where(sql`lower(${user.email}) = ${email.toLowerCase()}`)
  return rows.some(isBanActive)
}

/**
 * Returns the subset of the given user ids that are currently blocked: an
 * active account ban, or an email/domain in the appconfig blocked lists.
 * One user query plus the cached access-control fetch. Throws on db
 * failure — callers must fail closed.
 */
export async function getActivelyBannedUserIds(userIds: string[]): Promise<string[]> {
  const ids = [...new Set(userIds.filter(Boolean))]
  if (ids.length === 0) return []

  const [accessControl, rows] = await Promise.all([
    getAccessControlConfig(),
    db
      .select({ id: user.id, email: user.email, banned: user.banned, banExpires: user.banExpires })
      .from(user)
      .where(inArray(user.id, ids)),
  ])

  return rows
    .filter((row) => isBanActive(row) || isEmailBlockedByAccessControl(row.email, accessControl))
    .map((row) => row.id)
}
