/** @vitest-environment node */

import { generateId } from '@sim/utils/id'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const { databaseUrl, select } = vi.hoisted(() => {
  const databaseUrl = process.env.BILLING_USAGE_TEST_DATABASE_URL
  if (databaseUrl && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(databaseUrl).hostname)) {
    throw new Error('Usage integration tests require a disposable local database')
  }
  return { databaseUrl, select: vi.fn() }
})
vi.unmock('drizzle-orm')
vi.unmock('@sim/db/schema')
vi.mock('@sim/db', () => ({ db: { select }, dbReplica: { select } }))
vi.mock('@/lib/billing/core/billing', () => ({ getOrganizationSubscription: vi.fn() }))

import { isOrgMemberUsageLimitTarget } from '@/lib/billing/organizations/member-limits'

const schemaName = `member_limits_${generateId().replaceAll('-', '')}`
const connection = databaseUrl
  ? postgres(databaseUrl, {
      max: 1,
      prepare: false,
      connection: { search_path: schemaName },
      onnotice: () => undefined,
    })
  : undefined

beforeAll(async () => {
  if (!connection) return
  await connection.unsafe(`CREATE SCHEMA "${schemaName}"`)
  await connection.unsafe(`
    CREATE TABLE member (id text PRIMARY KEY, organization_id text, user_id text);
    CREATE TABLE workspace (id text PRIMARY KEY, organization_id text, archived_at timestamp);
    CREATE TABLE permissions (id text PRIMARY KEY, user_id text, entity_type text, entity_id text);
    CREATE TABLE "user" (id text PRIMARY KEY);
    INSERT INTO "user" VALUES ('unrelated');
    INSERT INTO member VALUES
      ('m1', 'org', 'member'), ('m2', 'other', 'external'), ('m3', 'other', 'foreign-member');
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
  const database = drizzle(connection)
  select.mockImplementation((fields) => database.select(fields))
})

afterAll(async () => {
  if (!connection) return
  await connection.unsafe(`DROP SCHEMA "${schemaName}" CASCADE`)
  await connection.end()
})

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
