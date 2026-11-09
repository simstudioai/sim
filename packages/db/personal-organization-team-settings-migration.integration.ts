import { readFile } from 'node:fs/promises'
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { generateId } from '@sim/utils/id'
import postgres from 'postgres'
import { describe, expect, it } from 'vitest'

const databaseUrl = readTestDatabaseUrl()

/** Applies 0456 to a minimal schema holding a personal and a team organization. */
async function createFixture() {
  const schema = `personal_team_settings_${generateId().replaceAll('-', '')}`
  const client = postgres(databaseUrl, { max: 2, onnotice: () => undefined })
  const sql = await client.reserve()
  const migration = await readFile(
    new URL('./migrations/0456_personal_organization_team_settings.sql', import.meta.url),
    'utf8'
  )
  await sql.unsafe(`CREATE SCHEMA "${schema}"`)
  await sql.unsafe(`SET search_path TO "${schema}"`)
  await sql.unsafe(`
    CREATE TABLE organization (
      id text PRIMARY KEY, kind text NOT NULL DEFAULT 'team', whitelabel_settings json,
      data_retention_settings json, session_policy_settings json,
      require_sso boolean NOT NULL DEFAULT false
    );
    CREATE TABLE sso_provider (id text PRIMARY KEY, organization_id text);
    CREATE TABLE sso_domain (id text PRIMARY KEY, organization_id text NOT NULL);
    CREATE TABLE scim_connection (id text PRIMARY KEY, organization_id text NOT NULL);
    CREATE TABLE permission_group (id text PRIMARY KEY, organization_id text NOT NULL);
    CREATE TABLE custom_block (id text PRIMARY KEY, organization_id text NOT NULL);
    CREATE TABLE data_drains (id text PRIMARY KEY, organization_id text NOT NULL);
    INSERT INTO organization (id, kind) VALUES ('personal', 'personal'), ('team', 'team');
  `)
  for (const statement of migration.split('--> statement-breakpoint')) {
    if (statement.trim()) await sql.unsafe(statement)
  }
  return {
    sql,
    async cleanup() {
      try {
        await sql.unsafe(`DROP SCHEMA "${schema}" CASCADE`)
      } finally {
        sql.release()
        await client.end()
      }
    },
  }
}

describe('personal organization team-settings migration on PostgreSQL', () => {
  it('refuses team configuration on a personal organization and allows it on a team', async () => {
    const fixture = await createFixture()
    try {
      const { sql } = fixture
      for (const table of [
        'sso_provider',
        'sso_domain',
        'scim_connection',
        'permission_group',
        'custom_block',
        'data_drains',
      ]) {
        await expect(
          sql.unsafe(`INSERT INTO ${table} (id, organization_id) VALUES ('p-${table}', 'personal')`)
        ).rejects.toMatchObject({ code: '23514' })
        await sql.unsafe(`INSERT INTO ${table} (id, organization_id) VALUES ('t-${table}', 'team')`)
        await expect(
          sql.unsafe(`UPDATE ${table} SET organization_id = 'personal' WHERE id = 't-${table}'`)
        ).rejects.toMatchObject({ code: '23514' })
      }

      await expect(
        sql`UPDATE organization SET require_sso = true WHERE id = 'personal'`
      ).rejects.toMatchObject({ code: '23514' })
      await expect(
        sql`UPDATE organization SET whitelabel_settings = '{}' WHERE id = 'personal'`
      ).rejects.toMatchObject({ code: '23514' })
      await sql`UPDATE organization SET require_sso = true, whitelabel_settings = '{}' WHERE id = 'team'`
      await sql`UPDATE organization SET kind = 'team', require_sso = true WHERE id = 'personal'`
    } finally {
      await fixture.cleanup()
    }
  })
})
