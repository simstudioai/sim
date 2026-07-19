/**
 * Seeds Sim platform super admins from PLATFORM_ADMIN_EMAILS (falls back to
 * SEED_ADMIN_EMAIL). For each configured admin email this:
 *  - creates the account if missing (email/password from SEED_ADMIN_PASSWORD),
 *  - promotes it to platform admin (`user.role = 'admin'` + super-user mode),
 *  - grants a personal Enterprise plan and an effectively unlimited usage limit.
 *
 * Idempotent: existing users are reused, the subscription is upserted, and the
 * usage limit is overwritten each run.
 *
 * Usage: bun --env-file=.env run scripts/seed-super-admin-user.ts
 */
import { db } from '@sim/db'
import { settings, subscription, user, userStats } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { handleNewUser } from '@/lib/billing/core/usage'
import { provisionLagoBillingForUser } from '@/lib/billing/lago/provision'
import { promotePlatformAdminByEmail } from '@/lib/billing/platform-admin'
import { env } from '@/lib/core/config/env'
import { isLagoBillingProvider } from '@/lib/core/config/env-flags'

const DEFAULT_NAME = process.env.SEED_ADMIN_NAME ?? 'Sim Admin'
const DEFAULT_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'AACFlow2026!'
/** Effectively unlimited personal usage cap ($1,000,000). */
const UNLIMITED_USAGE_LIMIT = 1_000_000

function adminEmails(): string[] {
  const raw = env.PLATFORM_ADMIN_EMAILS?.trim() || process.env.SEED_ADMIN_EMAIL?.trim() || ''
  return raw
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
}

/** Returns the user id, creating the account when it does not yet exist. */
async function ensureUser(email: string): Promise<string | null> {
  const existing = await db.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1)
  if (existing[0]) {
    console.log(`User ${email} already exists (id=${existing[0].id})`)
    return existing[0].id
  }

  const result = await auth.api.signUpEmail({
    body: { email, password: DEFAULT_PASSWORD, name: DEFAULT_NAME },
  })
  const id = result?.user?.id
  if (!id) {
    console.warn(`Failed to create ${email} via Better Auth — skipping`)
    return null
  }
  console.log(`Created user ${email} (id=${id})`)

  try {
    await handleNewUser(id)
  } catch (error) {
    console.warn('handleNewUser failed (non-fatal):', error)
  }
  if (isLagoBillingProvider) {
    try {
      await provisionLagoBillingForUser(id)
    } catch (error) {
      console.warn('Lago provision failed (non-fatal):', error)
    }
  }
  return id
}

/**
 * Grants a personal Enterprise plan and an effectively unlimited usage limit.
 * The subscription stays personally-scoped (`referenceId === userId`), so
 * `isOrgScopedSubscription` is false and the usage limit resolves from
 * `userStats.currentUsageLimit` rather than an organization. `metadata` is
 * required by the `check_enterprise_metadata` constraint.
 */
async function grantEnterpriseUnlimited(userId: string, email: string): Promise<void> {
  const metadata = {
    plan: 'enterprise',
    referenceId: userId,
    monthlyPrice: UNLIMITED_USAGE_LIMIT,
    seats: 1000,
  }

  const existing = await db
    .select({ id: subscription.id })
    .from(subscription)
    .where(eq(subscription.referenceId, userId))
    .limit(1)

  if (existing[0]) {
    await db
      .update(subscription)
      .set({ plan: 'enterprise', status: 'active', seats: 1, metadata })
      .where(eq(subscription.id, existing[0].id))
  } else {
    await db.insert(subscription).values({
      id: generateId(),
      plan: 'enterprise',
      referenceId: userId,
      status: 'active',
      seats: 1,
      billingProvider: isLagoBillingProvider ? 'lago' : 'stripe',
      metadata,
    })
  }

  await db
    .update(userStats)
    .set({
      currentUsageLimit: UNLIMITED_USAGE_LIMIT.toString(),
      usageLimitUpdatedAt: new Date(),
    })
    .where(eq(userStats.userId, userId))

  console.log(`Granted Enterprise + $${UNLIMITED_USAGE_LIMIT} usage limit to ${email}`)
}

async function main(): Promise<void> {
  const emails = adminEmails()
  if (emails.length === 0) {
    throw new Error('No admin emails configured (set PLATFORM_ADMIN_EMAILS or SEED_ADMIN_EMAIL)')
  }

  for (const email of emails) {
    const userId = await ensureUser(email)
    if (!userId) continue

    await promotePlatformAdminByEmail(email)
    await grantEnterpriseUnlimited(userId, email)

    const [row] = await db
      .select({ id: user.id, email: user.email, role: user.role })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1)
    const [settingsRow] = await db
      .select({ superUserModeEnabled: settings.superUserModeEnabled })
      .from(settings)
      .where(eq(settings.userId, userId))
      .limit(1)
    console.log('Admin ready:', { ...row, superUser: settingsRow?.superUserModeEnabled ?? false })
  }

  console.log('Done.')
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
