/**
 * @vitest-environment node
 */
import { generateId } from '@sim/utils/id'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { describe, expect, it, vi } from 'vitest'
import { loadAccessRequestGroupImpact } from '@/lib/permission-access-requests/impact'

vi.unmock('@sim/db/schema')
vi.unmock('drizzle-orm')

const databaseUrl = process.env.ACCESS_REQUESTS_TEST_DATABASE_URL

async function createFixture() {
  const url = new URL(databaseUrl ?? '')
  if (
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    url.pathname !== '/sim_access_requests_test'
  )
    throw new Error('Use a disposable local sim_access_requests_test database')
  const schema = `access_impact_${generateId().replaceAll('-', '')}`
  const client = postgres(url.toString(), { max: 1, onnotice: () => undefined })
  await client.unsafe(`CREATE SCHEMA "${schema}"`)
  await client.unsafe(`SET search_path TO "${schema}"`)
  await client.unsafe(`
    CREATE TABLE workspace (id text PRIMARY KEY, name text, organization_id text, archived_at timestamp);
    CREATE TABLE permission_group (id text PRIMARY KEY, organization_id text, is_default boolean, updated_at timestamp, membership_mode text);
    CREATE TABLE permissions (id text PRIMARY KEY, user_id text, entity_id text, entity_type text, permission_type text, updated_at timestamp);
    CREATE TABLE member (id text PRIMARY KEY, user_id text, organization_id text, role text);
    CREATE TABLE permission_group_member (id text PRIMARY KEY, organization_id text, permission_group_id text, user_id text);
    CREATE TABLE permission_group_workspace (id text PRIMARY KEY, organization_id text, permission_group_id text, workspace_id text);
    INSERT INTO permission_group VALUES ('group', 'org', false, now(), 'explicit');
    INSERT INTO workspace VALUES ('one', 'One', 'org', null), ('two', 'Two', 'org', null), ('foreign', 'Foreign', 'another-org', null);
    INSERT INTO permission_group_workspace VALUES ('scope', 'org', 'group', 'one');
    INSERT INTO member VALUES ('m1', 'admin', 'org', 'admin'), ('m2', 'member', 'org', 'member'), ('m3', 'outside', 'another-org', 'admin');
    INSERT INTO permissions VALUES ('p1', 'admin', 'one', 'workspace', 'read', now()), ('p2', 'guest', 'one', 'workspace', 'read', now()), ('p3', 'guest', 'two', 'workspace', 'read', now()), ('p4', 'outside', 'foreign', 'workspace', 'read', now());
    INSERT INTO permission_group_member VALUES ('assignment', 'org', 'group', 'member');
  `)
  return {
    client,
    executor: drizzle(client),
    async cleanup() {
      try {
        await client.unsafe(`DROP SCHEMA "${schema}" CASCADE`)
      } finally {
        await client.end()
      }
    },
  }
}

describe.skipIf(!databaseUrl)('access request impact on PostgreSQL', () => {
  it('counts scoped people once without requiring or scanning the global user table', async () => {
    const fixture = await createFixture()
    try {
      const scoped = await loadAccessRequestGroupImpact(fixture.executor, 'org', 'group')
      expect(scoped.impact).toEqual({
        memberCount: 2,
        workspaceCount: 1,
        workspaceNames: ['One'],
        truncated: false,
      })
      await fixture.client`UPDATE permission_group SET is_default = true WHERE id = 'group'`
      const defaultGroup = await loadAccessRequestGroupImpact(fixture.executor, 'org', 'group')
      expect(defaultGroup.impact).toEqual({
        memberCount: 3,
        workspaceCount: 2,
        workspaceNames: ['One', 'Two'],
        truncated: false,
      })
    } finally {
      await fixture.cleanup()
    }
  })

  it('detects in-place assignment, grant, and workspace changes with a bounded revision', async () => {
    const fixture = await createFixture()
    try {
      const load = () => loadAccessRequestGroupImpact(fixture.executor, 'org', 'group')
      const initial = await load()
      expect((await load()).revision).toBe(initial.revision)
      await fixture.client`UPDATE permission_group_member SET user_id = 'guest' WHERE id = 'assignment'`
      const reassigned = await load()
      expect(reassigned.revision).not.toBe(initial.revision)
      await fixture.client`UPDATE permissions SET permission_type = 'write' WHERE id = 'p2'`
      const promoted = await load()
      expect(promoted.revision).not.toBe(reassigned.revision)
      await fixture.client`UPDATE workspace SET name = 'Renamed' WHERE id = 'one'`
      const renamed = await load()
      expect(renamed.revision).not.toBe(promoted.revision)
      await fixture.client`INSERT INTO workspace SELECT 'ws-' || n, 'Workspace ' || n, 'org', null FROM generate_series(1, 150) n`
      await fixture.client`UPDATE permission_group SET is_default = true WHERE id = 'group'`
      const large = await load()
      expect(large.impact.workspaceCount).toBe(152)
      expect(large.impact.workspaceNames).toHaveLength(100)
      expect(large.impact.truncated).toBe(true)
      expect(large.revision.length).toBeLessThan(1000)
    } finally {
      await fixture.cleanup()
    }
  })
})
