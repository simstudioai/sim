import { recordAudit } from '@sim/audit'
import * as schema from '@sim/db/schema'
import { createDeferred, resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const { databaseUrl, select, transaction } = vi.hoisted(() => {
  const databaseUrl = process.env.TEST_DATABASE_URL
  if (databaseUrl && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(databaseUrl).hostname)) {
    throw new Error('Usage integration tests require a disposable local database')
  }
  return { databaseUrl, select: vi.fn(), transaction: vi.fn() }
})
vi.mock('@/lib/core/config/env-flags', async () => (await import('@sim/testing')).envFlagsMock)
vi.mock('@sim/db', () => ({ db: { select, transaction }, dbReplica: { select } }))
vi.mock('@sim/audit', async (original) => ({
  ...(await original<typeof import('@sim/audit')>()),
  recordAudit: vi.fn(),
}))
vi.mock('@/lib/billing/core/billing', () => ({ getOrganizationSubscription: vi.fn() }))

import {
  type UpdateOrganizationMemberUsageLimitInput,
  updateOrganizationMemberUsageLimit,
} from '@/lib/billing/application/member-usage-limits/use-cases'
import { isOrgMemberUsageLimitTarget } from '@/lib/billing/organizations/member-limits'
import { acquireOrganizationUserMutationLocks } from '@/lib/billing/organizations/membership'

const schemaName = `member_limits_${generateId().replaceAll('-', '')}`
const connection = databaseUrl
  ? postgres(databaseUrl, {
      max: 3,
      prepare: false,
      connection: { search_path: schemaName, application_name: schemaName },
      onnotice: () => undefined,
    })
  : undefined

const database = connection ? drizzle(connection, { schema }) : undefined

beforeAll(async () => {
  if (!connection) return
  await connection.unsafe(`CREATE SCHEMA "${schemaName}"`)
  await connection.unsafe(`
    CREATE TABLE member (id text PRIMARY KEY, organization_id text, user_id text, role text DEFAULT 'member');
    CREATE TABLE workspace (id text PRIMARY KEY, organization_id text, archived_at timestamp);
    CREATE TABLE permissions (id text PRIMARY KEY, user_id text, entity_type text, entity_id text);
    CREATE TABLE "user" (id text PRIMARY KEY);
    INSERT INTO "user" VALUES ('unrelated');
    INSERT INTO member (id, organization_id, user_id) VALUES
      ('m1', 'org', 'member'), ('m2', 'other', 'external'), ('m3', 'other', 'foreign-member');
    INSERT INTO member VALUES ('actor', 'org', 'actor', 'admin');
    CREATE TABLE organization_member_usage_limit (
      id text PRIMARY KEY, organization_id text, user_id text, usage_limit numeric,
      set_by text, created_at timestamp DEFAULT now(), updated_at timestamp DEFAULT now(),
      UNIQUE(organization_id, user_id)
    );
    INSERT INTO workspace VALUES
      ('local', 'org', null), ('foreign', 'other', null), ('archived', 'org', now());
    INSERT INTO permissions VALUES
      ('p1', 'external', 'workspace', 'local'),
      ('p2', 'archived-external', 'workspace', 'archived'),
      ('p3', 'foreign-external', 'workspace', 'foreign'),
      ('p4', 'workflow-only', 'workflow', 'local'),
      ('p5', 'missing-workspace', 'workspace', 'missing'),
      ('p6', 'revoked', 'workspace', 'local');
  `)
  select.mockImplementation((fields) => database!.select(fields))
  transaction.mockImplementation((callback) => database!.transaction(callback))
  setEnvFlags({ isHosted: true })
})

afterAll(async () => {
  resetEnvFlagsMock()
  if (!connection) return
  await connection.unsafe(`DROP SCHEMA "${schemaName}" CASCADE`)
  await connection.end()
})

/** The use case's `execute` is typed by its operation's input, which omits the cap itself. */
function limitInput(
  userId: string,
  creditLimit: number | null
): UpdateOrganizationMemberUsageLimitInput {
  return { organizationId: 'org', userId, creditLimit }
}
describe.skipIf(!databaseUrl)('organization credit-limit target SQL', () => {
  it.each([
    ['member', true],
    ['external', true],
    ['archived-external', true],
    ['foreign-member', false],
    ['foreign-external', false],
    ['workflow-only', false],
    ['missing-workspace', false],
    ['unrelated', false],
    ['missing-user', false],
  ] as const)('resolves target %s within the organization', async (userId, expected) => {
    expect(await isOrgMemberUsageLimitTarget('org', userId)).toBe(expected)
  })

  it('requires a current relationship after external access is revoked', async () => {
    expect(await isOrgMemberUsageLimitTarget('org', 'revoked')).toBe(true)
    await connection!`DELETE FROM permissions WHERE user_id = 'revoked'`
    expect(await isOrgMemberUsageLimitTarget('org', 'revoked')).toBe(false)
  })
})

describe.skipIf(!databaseUrl)('organization credit-limit mutation races', () => {
  it.each(['member', 'external', 'archived-external'])(
    'sets and clears a cap for the eligible target %s',
    async (userId) => {
      const principal = { kind: 'session', userId: 'actor', sessionId: 'session' } as const
      await expect(
        updateOrganizationMemberUsageLimit.execute({
          principal,
          input: limitInput(userId, 400),
        })
      ).resolves.toEqual({ creditLimit: 400 })
      const [cap] =
        await connection!`SELECT usage_limit, set_by FROM organization_member_usage_limit WHERE user_id = ${userId}`
      expect(Number(cap.usage_limit)).toBe(2)
      expect(cap.set_by).toBe('actor')
      await expect(
        updateOrganizationMemberUsageLimit.execute({
          principal,
          input: limitInput(userId, null),
        })
      ).resolves.toEqual({ creditLimit: null })
      expect(
        await connection!`SELECT id FROM organization_member_usage_limit WHERE user_id = ${userId}`
      ).toHaveLength(0)
    }
  )

  it.each(['organization-removal', 'workspace-revocation'] as const)(
    'rejects a target revoked by %s while the update waits',
    async (removalKind) => {
      const userId = `target-${removalKind}`
      await connection!`INSERT INTO permissions VALUES (${userId}, ${userId}, 'workspace', 'local')`
      vi.mocked(recordAudit).mockClear()
      const ready = createDeferred<void>()
      const release = createDeferred<void>()
      const removal = database!.transaction(async (tx) => {
        if (removalKind === 'organization-removal') {
          await acquireOrganizationUserMutationLocks(tx, { userId, organizationIds: ['org'] })
        }
        await tx.delete(schema.permissions).where(eq(schema.permissions.userId, userId))
        ready.resolve()
        await release.promise
      })
      await ready.promise
      const update = updateOrganizationMemberUsageLimit
        .execute({
          principal: { kind: 'session', userId: 'actor', sessionId: 'session' },
          input: limitInput(userId, 400),
        })
        .then(
          (result) => ({ result }),
          (error: unknown) => ({ error })
        )
      try {
        await vi.waitFor(
          async () => {
            const [waiting] = await connection!`SELECT count(*)::int AS count FROM pg_stat_activity
            WHERE application_name = ${schemaName} AND wait_event_type = 'Lock'`
            expect(waiting.count).toBeGreaterThan(0)
          },
          { timeout: 2000 }
        )
      } finally {
        release.resolve()
        await removal
      }
      expect(await update).toMatchObject({ error: { code: 'not_found' } })
      const caps =
        await connection!`SELECT id FROM organization_member_usage_limit WHERE user_id = ${userId}`
      expect(caps).toHaveLength(0)
      expect(recordAudit).not.toHaveBeenCalled()
    }
  )
})
