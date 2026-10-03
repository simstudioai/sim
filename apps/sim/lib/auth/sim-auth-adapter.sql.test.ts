import type { BetterAuthOptions } from 'better-auth'
import { organization } from 'better-auth/plugins'
import { drizzle } from 'drizzle-orm/pg-proxy'
import { describe, expect, it, vi } from 'vitest'
import type { AuthDatabase } from '@/lib/auth/oauth-provider-adapter-guard'
import { createSimAuthAdapter } from '@/lib/auth/sim-auth-adapter'

vi.unmock('@sim/db/schema')
vi.unmock('drizzle-orm')

/** Guard behavior is covered separately; these tests exercise the real adapter and SQL builder. */
vi.mock('@/lib/auth/oauth-provider-adapter-guard', () => ({
  guardOAuthProviderWrites: (adapter: object) => adapter,
}))
vi.mock('@/lib/auth/stripe-adapter-guard', () => ({
  guardSubscriptionPlanWrites: (adapter: object) => adapter,
}))

const OPTIONS: BetterAuthOptions = { plugins: [organization()] }
type Adapter = ReturnType<typeof createSimAuthAdapter>
type AdapterSurface = Omit<Adapter, 'transaction'>
const WHERE = [{ field: 'id', value: 'organization-1' }]
const OPERATIONS: { name: string; run: (adapter: AdapterSurface) => Promise<unknown> }[] = [
  {
    name: 'findOne',
    run: (adapter) => adapter.findOne({ model: 'organization', where: WHERE }),
  },
  {
    name: 'findMany',
    run: (adapter) => adapter.findMany({ model: 'organization' }),
  },
  {
    name: 'create',
    run: (adapter) =>
      adapter.create({
        model: 'organization',
        data: { name: 'Example', slug: 'example', createdAt: new Date('2026-01-01T00:00:00Z') },
      }),
  },
  {
    name: 'update',
    run: (adapter) =>
      adapter.update({ model: 'organization', where: WHERE, update: { name: 'Updated' } }),
  },
  {
    name: 'delete',
    run: (adapter) => adapter.delete({ model: 'organization', where: WHERE }),
  },
]

describe('Better Auth organization SQL', () => {
  it.each(OPERATIONS)('excludes retired columns from $name', async (operation) => {
    const execute = vi.fn(async (_query: string) => ({ rows: [] }))
    const database = drizzle(execute)
    const adapter = createSimAuthAdapter(OPTIONS, database as unknown as AuthDatabase)

    await operation.run(adapter)

    const queries = execute.mock.calls.map(([query]) => query)
    expect(
      queries.some((query) => query.includes('"organization"')),
      operation.name
    ).toBe(true)
    for (const query of queries) {
      expect(query, operation.name).not.toContain('"departed_member_usage"')
    }
  })
})
