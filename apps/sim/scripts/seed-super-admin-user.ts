/**
 * Creates info@aacflow.io as Sim platform super admin (if missing).
 * Usage: bun --env-file=.env run scripts/seed-super-admin-user.ts
 */
import { db } from '@sim/db'
import { user } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { handleNewUser } from '@/lib/billing/core/usage'
import { provisionLagoBillingForUser } from '@/lib/billing/lago/provision'
import { promotePlatformAdminByEmail } from '@/lib/billing/platform-admin'
import { isLagoBillingProvider } from '@/lib/core/config/env-flags'

const ADMIN_EMAIL = (process.env.SEED_ADMIN_EMAIL ?? 'info@aacflow.io').trim().toLowerCase()
const ADMIN_NAME = process.env.SEED_ADMIN_NAME ?? 'AACFlow.io'
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'AACFlow2026!'

async function main(): Promise<void> {
  const existing = await db
    .select({ id: user.id, email: user.email, role: user.role })
    .from(user)
    .where(eq(user.email, ADMIN_EMAIL))
    .limit(1)

  if (existing.length === 0) {
    const result = await auth.api.signUpEmail({
      body: {
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
        name: ADMIN_NAME,
      },
    })

    if (!result?.user?.id) {
      throw new Error('Failed to create admin user via Better Auth')
    }

    console.log(`Created user ${ADMIN_EMAIL} (id=${result.user.id})`)

    try {
      await handleNewUser(result.user.id)
    } catch (error) {
      console.warn('handleNewUser failed (non-fatal):', error)
    }

    if (isLagoBillingProvider) {
      try {
        await provisionLagoBillingForUser(result.user.id)
      } catch (error) {
        console.warn('Lago provision failed (non-fatal):', error)
      }
    }
  } else {
    console.log(`User ${ADMIN_EMAIL} already exists (id=${existing[0].id})`)
  }

  await promotePlatformAdminByEmail(ADMIN_EMAIL)

  const updated = await db
    .select({ id: user.id, email: user.email, role: user.role })
    .from(user)
    .where(eq(user.email, ADMIN_EMAIL))
    .limit(1)

  console.log('Super admin ready:', updated[0])
  console.log(`Login: http://localhost:3000 — ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
