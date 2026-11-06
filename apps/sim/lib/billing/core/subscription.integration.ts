import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import postgres, { type Sql } from 'postgres'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  schema: `enterprise_entitlement_${process.pid}`,
  client: null as Sql | null,
  organizationId: null as string | null,
}))

vi.mock('@sim/db', async () => {
  const { drizzle } = await import('drizzle-orm/postgres-js')
  const { default: postgres } = await import('postgres')
  const { readTestDatabaseUrl } = await import('@sim/db/testing/test-infrastructure')
  fixture.client = postgres(readTestDatabaseUrl(), {
    max: 1,
    prepare: false,
    connection: { search_path: fixture.schema },
  })
  return { db: drizzle(fixture.client) }
})
vi.mock('@/lib/core/config/env-flags', () => ({
  isHosted: true,
  isBillingEnabled: true,
  isAccessControlEnabled: false,
  isInboxEnabled: false,
  isSandboxDeploymentEntitled: false,
  isSandboxesEnabled: false,
}))
vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getWorkspaceWithOwner: async () => ({
    id: 'fixture-workspace',
    billedAccountUserId: 'fixture-owner',
    organizationId: fixture.organizationId,
  }),
}))
vi.mock('@/lib/billing/core/access', () => ({
  isOrganizationBillingBlocked: async () => false,
  getEffectiveBillingStatus: async () => ({ billingBlocked: false }),
}))

import { isWorkspaceOnEnterprisePlan } from '@/lib/billing/core/subscription'

/** Real subscription reads must distinguish ineligibility from an unavailable billing database. */
describe('enterprise BYOK entitlement', () => {
  const admin = postgres(readTestDatabaseUrl(), {
    max: 1,
    connection: { search_path: fixture.schema },
    onnotice: () => {},
  })

  beforeAll(async () => {
    await admin`CREATE SCHEMA ${admin(fixture.schema)}`
  })

  beforeEach(async () => {
    await admin`CREATE TABLE subscription (LIKE public.subscription)`
  })

  afterEach(async () => {
    await admin`DROP TABLE IF EXISTS subscription`
  })

  afterAll(async () => {
    await fixture.client?.end({ timeout: 1 })
    await admin`DROP SCHEMA IF EXISTS ${admin(fixture.schema)} CASCADE`
    await admin.end()
  })

  it.each(['organization', 'personal'] as const)(
    'propagates %s subscription read failures instead of declaring BYOK ineligible',
    async (scope) => {
      fixture.organizationId = scope === 'organization' ? 'fixture-org' : null
      const payerId = fixture.organizationId ?? 'fixture-owner'
      await admin`INSERT INTO subscription (id, plan, reference_id, status, metadata)
        VALUES ('fixture-sub', 'enterprise', ${payerId}, 'active', '{"workspaces":"unlimited"}')`
      await expect(isWorkspaceOnEnterprisePlan('fixture-workspace')).resolves.toBe(true)

      await admin`TRUNCATE subscription`
      await expect(isWorkspaceOnEnterprisePlan('fixture-workspace')).resolves.toBe(false)

      await admin`DROP TABLE subscription`
      await expect(isWorkspaceOnEnterprisePlan('fixture-workspace')).rejects.toThrow()
    }
  )
})
