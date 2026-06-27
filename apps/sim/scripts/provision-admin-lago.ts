/**
 * Re-provisions Lago billing for platform admin user.
 */
import { db } from '@sim/db'
import { user } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { provisionLagoBillingForUser } from '@/lib/billing/lago/provision'

const email = (process.env.SEED_ADMIN_EMAIL ?? 'info@aacflow.io').trim().toLowerCase()

async function main(): Promise<void> {
  const rows = await db.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1)
  const row = rows[0]
  if (!row) {
    throw new Error(`User not found: ${email}`)
  }
  await provisionLagoBillingForUser(row.id)
  console.log(`Lago provisioned for ${email}`)
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
