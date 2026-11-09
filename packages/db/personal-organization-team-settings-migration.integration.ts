import { readFile } from 'node:fs/promises'
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { generateId } from '@sim/utils/id'
import postgres from 'postgres'
import { describe, expect, it } from 'vitest'

const databaseUrl = readTestDatabaseUrl()

/** Tables 0457 refuses on a personal organization. */
const TEAM_ONLY_TABLES = [
  'organization_byok_keys',
  'organization_member_usage_limit',
  'organization_search_integration',
  'organization_secret_source',
  'people_directory_sync',
  'people_directory_scim_change',
  'credential_group',
  'resource_policy',
  'slack_app',
  'slack_search_installation',
  'permission_group_member',
  'permission_group_workspace',
]

/**
 * Applies 0456, 0457 and 0458 to a minimal schema holding a personal and a team organization (and
 * the personal organization's owner).
 */
async function createFixture() {
  const schema = `personal_team_settings_${generateId().replaceAll('-', '')}`
  const client = postgres(databaseUrl, { max: 2, onnotice: () => undefined })
  const sql = await client.reserve()
  const migrations = await Promise.all(
    [
      '0456_personal_organization_team_settings',
      '0457_personal_organization_team_only_tables',
      '0458_personal_organization_single_owner',
    ].map((name) => readFile(new URL(`./migrations/${name}.sql`, import.meta.url), 'utf8'))
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
    CREATE TABLE member (
      id text PRIMARY KEY, organization_id text NOT NULL, user_id text NOT NULL UNIQUE,
      role text NOT NULL
    );
    ${TEAM_ONLY_TABLES.map((table) => `CREATE TABLE ${table} (id text PRIMARY KEY, organization_id text);`).join('\n')}
    INSERT INTO organization (id, kind) VALUES ('personal', 'personal'), ('team', 'team');
    INSERT INTO member (id, organization_id, user_id, role) VALUES ('owner', 'personal', 'owner', 'owner');
  `)
  for (const migration of migrations) {
    for (const statement of migration.split('--> statement-breakpoint')) {
      if (statement.trim()) await sql.unsafe(statement)
    }
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

  it('refuses every 0457 team-only table on a personal organization and allows it on a team', async () => {
    const fixture = await createFixture()
    try {
      const { sql } = fixture
      for (const table of TEAM_ONLY_TABLES) {
        await expect(
          sql.unsafe(`INSERT INTO ${table} (id, organization_id) VALUES ('p', 'personal')`)
        ).rejects.toMatchObject({ code: '23514' })
        await sql.unsafe(`INSERT INTO ${table} (id, organization_id) VALUES ('t', 'team')`)
        await expect(
          sql.unsafe(`UPDATE ${table} SET organization_id = 'personal' WHERE id = 't'`)
        ).rejects.toMatchObject({ code: '23514' })
      }
    } finally {
      await fixture.cleanup()
    }
  })

  it('keeps a personal organization to one member, its owner', async () => {
    const fixture = await createFixture()
    try {
      const { sql } = fixture
      await expect(
        sql`INSERT INTO member (id, organization_id, user_id, role) VALUES ('second', 'personal', 'second', 'owner')`
      ).rejects.toMatchObject({ code: '23514' })
      await expect(sql`UPDATE member SET role = 'admin' WHERE id = 'owner'`).rejects.toMatchObject({
        code: '23514',
      })
      await sql`INSERT INTO member (id, organization_id, user_id, role) VALUES ('teammate', 'team', 'teammate', 'member')`
      await expect(
        sql`UPDATE member SET organization_id = 'personal', role = 'owner' WHERE id = 'teammate'`
      ).rejects.toMatchObject({ code: '23514' })
      await sql`INSERT INTO member (id, organization_id, user_id, role) VALUES ('admin', 'team', 'admin', 'admin')`

      await sql`DELETE FROM member WHERE id = 'owner'`
      await expect(
        sql`INSERT INTO member (id, organization_id, user_id, role) VALUES ('lone', 'personal', 'lone', 'member')`
      ).rejects.toMatchObject({ code: '23514' })
      await sql`INSERT INTO member (id, organization_id, user_id, role) VALUES ('lone', 'personal', 'lone', 'owner')`
    } finally {
      await fixture.cleanup()
    }
  })
})
