/**
 * Backfills Lago billing for every existing customer (users + organizations).
 *
 * For each entity this ensures, idempotently:
 *  - a Lago customer exists,
 *  - a local + Lago free subscription exists,
 *  - a prepaid wallet exists, seeded with LAGO_SIGNUP_GRANTED_CREDITS granted credits.
 *
 * Entities provisioned before Lago was enabled (or before wallets shipped) have no
 * wallet; this script brings them in line with newly-registered customers. Existing
 * wallets/subscriptions are left untouched (Lago returns 422 → treated as "already
 * exists"). Run it from the deployment that can reach LAGO_API_URL:
 *
 *   bun run apps/sim/scripts/backfill-lago-wallets.ts
 */
import { db } from '@sim/db'
import { member, organization, user } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { hasValidLagoCredentials } from '@/lib/billing/lago/client'
import { provisionLagoBillingEntity } from '@/lib/billing/lago/provision'
import { isBillingEnabled, isLagoBillingProvider } from '@/lib/core/config/env-flags'

interface BackfillCounts {
  total: number
  succeeded: number
  failed: number
}

async function provisionAll<T extends { id: string }>(
  rows: T[],
  resolve: (row: T) => Promise<void>,
  label: string
): Promise<BackfillCounts> {
  const counts: BackfillCounts = { total: rows.length, succeeded: 0, failed: 0 }
  for (const row of rows) {
    try {
      await resolve(row)
      counts.succeeded += 1
    } catch (error) {
      counts.failed += 1
      console.error(`Failed to provision ${label} ${row.id}:`, error)
    }
  }
  return counts
}

async function findOrganizationOwnerEmail(organizationId: string): Promise<string | null> {
  const rows = await db
    .select({ email: user.email })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(and(eq(member.organizationId, organizationId), eq(member.role, 'owner')))
    .limit(1)
  return rows[0]?.email ?? null
}

async function main(): Promise<void> {
  if (!isBillingEnabled || !isLagoBillingProvider || !hasValidLagoCredentials()) {
    console.error(
      'Lago billing is not active (need BILLING_ENABLED=true, BILLING_PROVIDER=lago, and valid LAGO_API_URL/LAGO_API_KEY). Aborting.'
    )
    process.exit(1)
  }

  const users = await db.select({ id: user.id, name: user.name, email: user.email }).from(user)
  console.log(`Backfilling ${users.length} user(s)...`)
  const userCounts = await provisionAll(
    users,
    (row) =>
      provisionLagoBillingEntity({
        entityType: 'user',
        entityId: row.id,
        name: row.name,
        email: row.email,
        planName: 'free',
      }),
    'user'
  )

  const organizations = await db
    .select({ id: organization.id, name: organization.name })
    .from(organization)
  console.log(`Backfilling ${organizations.length} organization(s)...`)
  const orgCounts = await provisionAll(
    organizations,
    async (row) =>
      provisionLagoBillingEntity({
        entityType: 'organization',
        entityId: row.id,
        name: row.name,
        email: await findOrganizationOwnerEmail(row.id),
        planName: 'free',
      }),
    'organization'
  )

  console.log(
    `Done. Users: ${userCounts.succeeded}/${userCounts.total} ok (${userCounts.failed} failed). ` +
      `Orgs: ${orgCounts.succeeded}/${orgCounts.total} ok (${orgCounts.failed} failed).`
  )
  process.exit(userCounts.failed + orgCounts.failed > 0 ? 1 : 0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
