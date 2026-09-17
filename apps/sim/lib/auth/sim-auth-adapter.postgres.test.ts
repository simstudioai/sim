/**
 * @vitest-environment node
 */
import * as schema from '@sim/db/schema'
import { withUtcTimestamps } from '@sim/db/timestamps'
import { generateId } from '@sim/utils/id'
import type { BetterAuthOptions } from 'better-auth'
import { organization } from 'better-auth/plugins'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { describe, expect, it, vi } from 'vitest'
import { createSimAuthAdapter } from '@/lib/auth/sim-auth-adapter'

vi.unmock('@sim/db/schema')
vi.unmock('drizzle-orm')

/** The guard suites cover authorization; this exercises adapter SQL against the real table shape. */
vi.mock('@/lib/auth/oauth-provider-adapter-guard', () => ({
  guardOAuthProviderWrites: (adapter: object) => adapter,
}))
vi.mock('@/lib/auth/stripe-adapter-guard', () => ({
  guardSubscriptionPlanWrites: (adapter: object) => adapter,
}))

const OPTIONS: BetterAuthOptions = { plugins: [organization()] }
const databaseUrl = process.env.OAUTH_TOKEN_FAMILY_TEST_DATABASE_URL
type AdapterSurface = Omit<ReturnType<typeof createSimAuthAdapter>, 'transaction'>

async function exerciseOrganization(adapter: AdapterSurface) {
  const id = generateId()
  const data = { id, name: 'Example', slug: id, createdAt: new Date('2026-01-01T00:00:00Z') }
  const where = [{ field: 'id', value: id }]

  await expect(
    adapter.create({ model: 'organization', data, forceAllowId: true })
  ).resolves.toMatchObject(data)
  await expect(adapter.findOne({ model: 'organization', where })).resolves.toMatchObject(data)
  await expect(adapter.findMany({ model: 'organization', where })).resolves.toEqual([
    expect.objectContaining(data),
  ])
  await expect(
    adapter.update({ model: 'organization', where, update: { name: 'Renamed' } })
  ).resolves.toMatchObject({ id, name: 'Renamed' })
  await adapter.delete({ model: 'organization', where })
  await expect(adapter.findOne({ model: 'organization', where })).resolves.toBeNull()
}

describe.skipIf(!databaseUrl)('Better Auth across the organization column drop', () => {
  it.each([false, true])('preserves CRUD with transaction=%s', async (transaction) => {
    const client = postgres(
      databaseUrl!,
      withUtcTimestamps({ max: 1, prepare: false, fetch_types: false })
    )
    try {
      /** The connection-local copy lets other integration suites keep using the public table. */
      await client`CREATE TEMP TABLE organization (LIKE public.organization INCLUDING ALL)`
      const database = drizzle(client, { schema })
      const adapter = createSimAuthAdapter(OPTIONS, database)
      const exercise = () =>
        transaction
          ? adapter.transaction((tx) => exerciseOrganization(tx))
          : exerciseOrganization(adapter)

      await client`ALTER TABLE pg_temp.organization ADD COLUMN departed_member_usage numeric NOT NULL DEFAULT 0`
      await exercise()
      await client`ALTER TABLE pg_temp.organization DROP COLUMN departed_member_usage`

      await exercise()
    } finally {
      await client.end()
    }
  })
})
