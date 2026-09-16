/**
 * @vitest-environment node
 */
import { readFile } from 'node:fs/promises'
import { generateId } from '@sim/utils/id'
import postgres from 'postgres'
import { describe, expect, it } from 'vitest'

const databaseUrl = process.env.ACCESS_REQUESTS_TEST_DATABASE_URL

async function createFixture() {
  const url = new URL(databaseUrl ?? '')
  if (
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    url.pathname !== '/sim_access_requests_test'
  ) {
    throw new Error('Use a disposable local sim_access_requests_test database')
  }
  const schema = `access_requests_${generateId().replaceAll('-', '')}`
  const client = postgres(url.toString(), { max: 2, onnotice: () => undefined })
  const sql = await client.reserve()
  const migration = await readFile(
    new URL('./migrations/0349_permission_access_requests.sql', import.meta.url),
    'utf8'
  )
  await sql.unsafe(`CREATE SCHEMA "${schema}"`)
  await sql.unsafe(`SET search_path TO "${schema}"`)
  await sql.unsafe(`
    CREATE TABLE organization (id text PRIMARY KEY);
    CREATE TABLE "user" (id text PRIMARY KEY);
    CREATE TABLE workspace (id text PRIMARY KEY);
    INSERT INTO organization VALUES ('org');
    INSERT INTO "user" VALUES ('requester'), ('admin');
    INSERT INTO workspace VALUES ('workspace');
  `)
  for (const statement of migration
    .replaceAll('"public".', `"${schema}".`)
    .split('--> statement-breakpoint')) {
    if (statement.trim()) await sql.unsafe(statement)
  }
  return {
    sql,
    client,
    schema,
    async cleanup() {
      try {
        await sql.unsafe('ROLLBACK')
        await sql.unsafe(`DROP SCHEMA "${schema}" CASCADE`)
      } finally {
        sql.release()
        await client.end()
      }
    },
  }
}

const insertRequest = `INSERT INTO permission_access_request
  (id, organization_id, requester_id, workspace_id, scope_key, target_key, target, target_label, membership_id)
  VALUES ($1, 'org', 'requester', 'workspace', 'workspace:workspace', 'feature:hideTablesTab',
    '{"kind":"feature","configKey":"hideTablesTab"}', 'Tables', '["member",null]')`

describe.skipIf(!databaseUrl)('permission access request migration on PostgreSQL', () => {
  it('preserves history, enforces lifecycle states, and allows a fresh request after a decision', async () => {
    const fixture = await createFixture()
    try {
      const { sql } = fixture
      const [settings] =
        await sql`INSERT INTO organization_access_request_settings (organization_id) VALUES ('org') RETURNING allow_requests`
      expect(settings.allow_requests).toBe(true)
      await sql.unsafe(insertRequest, ['first'])
      await expect(sql.unsafe(insertRequest, ['duplicate'])).rejects.toMatchObject({
        code: '23505',
      })
      await expect(
        sql`UPDATE permission_access_request SET status='unknown' WHERE id='first'`
      ).rejects.toMatchObject({ code: '23514' })
      await sql`UPDATE permission_access_request SET status='fulfilled', decided_by='admin', decided_at=now() WHERE id='first'`
      await sql.unsafe(insertRequest, ['second'])
      await sql`DELETE FROM "user" WHERE id='admin'`
      const [history] =
        await sql`SELECT status, decided_by FROM permission_access_request WHERE id='first'`
      expect(history).toMatchObject({ status: 'fulfilled', decided_by: null })
      expect(await sql`SELECT id FROM permission_access_request`).toHaveLength(2)
    } finally {
      await fixture.cleanup()
    }
  })

  it('permits only one pending request when independent transactions submit concurrently', async () => {
    const fixture = await createFixture()
    try {
      await fixture.sql.unsafe('BEGIN')
      await fixture.sql.unsafe(insertRequest, ['first'])
      const competing = fixture.client.begin(async (transaction) => {
        await transaction.unsafe(`SET LOCAL search_path TO "${fixture.schema}"`)
        await transaction.unsafe(insertRequest, ['second'])
      })
      const rejected = expect(competing).rejects.toMatchObject({ code: '23505' })
      await fixture.sql.unsafe('COMMIT')
      await rejected
      expect(
        await fixture.sql`SELECT id FROM permission_access_request WHERE status='pending'`
      ).toHaveLength(1)
    } finally {
      await fixture.cleanup()
    }
  })
})
