import { db } from '@sim/db'
import { settings, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateShortId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { env } from '@/lib/core/config/env'

const logger = createLogger('PlatformAdmin')

function parsePlatformAdminEmails(): string[] {
  const raw = env.PLATFORM_ADMIN_EMAILS?.trim()
  if (!raw) return []
  return raw
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
}

async function enableSuperUserMode(userId: string): Promise<void> {
  await db
    .insert(settings)
    .values({
      id: generateShortId(),
      userId,
      superUserModeEnabled: true,
    })
    .onConflictDoUpdate({
      target: settings.userId,
      set: { superUserModeEnabled: true },
    })
}

/**
 * Promotes configured emails to platform admin (`user.role = 'admin'`).
 */
export async function promotePlatformAdminByEmail(email: string | null | undefined): Promise<void> {
  if (!email) return

  const admins = parsePlatformAdminEmails()
  if (admins.length === 0) return

  const normalized = email.trim().toLowerCase()
  if (!admins.includes(normalized)) return

  const rows = await db
    .select({ id: user.id, role: user.role })
    .from(user)
    .where(eq(user.email, normalized))
    .limit(1)

  const row = rows[0]
  if (!row) return

  if (row.role !== 'admin') {
    await db.update(user).set({ role: 'admin' }).where(eq(user.id, row.id))
    logger.info('Promoted user to platform admin', { userId: row.id, email: normalized })
  }

  await enableSuperUserMode(row.id)
}

/**
 * Backfills platform admin role for all configured admin emails.
 */
export async function promoteAllPlatformAdmins(): Promise<number> {
  const admins = parsePlatformAdminEmails()
  if (admins.length === 0) return 0

  const rows = await db
    .select({ id: user.id, email: user.email, role: user.role })
    .from(user)
    .where(inArray(user.email, admins))

  let promoted = 0
  for (const row of rows) {
    if (row.role !== 'admin') {
      await db.update(user).set({ role: 'admin' }).where(eq(user.id, row.id))
      promoted += 1
    }
    await enableSuperUserMode(row.id)
  }

  logger.info('Platform admin backfill complete', { promoted, matched: rows.length })
  return promoted
}
