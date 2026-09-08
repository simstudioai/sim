/**
 * @vitest-environment node
 */
import { readFile } from 'node:fs/promises'
import { generateId } from '@sim/utils/id'
import postgres from 'postgres'
import { describe, expect, it } from 'vitest'

const databaseUrl = process.env.KNOWLEDGE_ACL_TEST_DATABASE_URL

/** Uses pre-migration tables in an isolated schema; only public schema qualifiers are redirected. */
async function createMigrationFixture() {
  const url = new URL(databaseUrl ?? '')
  if (
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    !url.pathname.startsWith('/sim_acl_test')
  ) {
    throw new Error('Migration tests require a disposable local sim_acl_test database')
  }

  const schema = `organization_migration_${generateId().replaceAll('-', '')}`
  const migration = await readFile(
    new URL('./migrations/0326_enterprise_organization_search.sql', import.meta.url),
    'utf8'
  )
  const statements = migration
    .replaceAll('"public".', `"${schema}".`)
    .replaceAll('SET search_path = pg_catalog, public', `SET search_path = pg_catalog, "${schema}"`)
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter(Boolean)
  const client = postgres(url.toString(), { max: 1, onnotice: () => undefined })
  const sql = await client.reserve()

  async function cleanup() {
    try {
      await sql.unsafe('ROLLBACK')
      await sql.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    } finally {
      sql.release()
      await client.end()
    }
  }

  try {
    await sql.unsafe(`CREATE SCHEMA "${schema}"`)
    await sql.unsafe(`SET search_path TO "${schema}"`)
    await sql.unsafe(`

      CREATE TYPE credential_type AS ENUM ('oauth', 'env_personal', 'env_workspace', 'managed_oauth', 'service_account');
      CREATE TABLE organization (id text PRIMARY KEY);
      CREATE TABLE workspace (id text PRIMARY KEY);
      CREATE TABLE "user" (id text PRIMARY KEY, email text, email_verified boolean);
      CREATE TABLE credential (
        id text PRIMARY KEY, workspace_id text NOT NULL, type credential_type, account_id text,
        created_by text, provider_id text, provider_tenant_id text, provider_subject_id text,
        granted_scopes text[], env_key text, env_owner_user_id text, authorization_app_id text,
        encrypted_oauth_token_set text, encrypted_service_account_key text, unredacted boolean DEFAULT false,
        managed_oauth_status text, granted_at timestamp, credential_group_enrollment_id text,
        CONSTRAINT credential_managed_oauth_source_check CHECK (type::text <> 'managed_oauth' OR (
          account_id IS NULL AND provider_id IS NOT NULL AND authorization_app_id IS NOT NULL
          AND provider_subject_id IS NOT NULL AND managed_oauth_status IS NOT NULL
          AND granted_scopes IS NOT NULL AND cardinality(granted_scopes) > 0
          AND encrypted_oauth_token_set IS NOT NULL AND granted_at IS NOT NULL
        ))
      );
      CREATE TABLE credential_group (
        id text PRIMARY KEY, workspace_id text NOT NULL, created_by text, name text, status text
      );
      CREATE UNIQUE INDEX credential_group_workspace_name_unique ON credential_group (workspace_id, name);
      CREATE INDEX credential_group_workspace_status_idx ON credential_group (workspace_id, status);
      CREATE TABLE credential_group_enrollment (
        id text PRIMARY KEY, credential_group_id text, email text, status text,
        invitation_token_hash text, invitation_expires_at timestamp, invited_at timestamp,
        created_at timestamp, updated_at timestamp, revoked_at timestamp,
        UNIQUE (credential_group_id, email)
      );
      CREATE TABLE copilot_chats (
        id text PRIMARY KEY, workspace_id text, workflow_id text, user_id text, created_at timestamp
      );
      CREATE TABLE knowledge_base (
        id text PRIMARY KEY, workspace_id text, folder_id text, name text, deleted_at timestamp
      );
      CREATE TABLE knowledge_connector (
        id text PRIMARY KEY, access_mode text, sync_interval_minutes integer, status text,
        member_sync_status text, next_sync_at timestamp, next_member_sync_at timestamp,
        archived_at timestamp, deleted_at timestamp
      );
      CREATE TABLE knowledge_connector_member (
        id text PRIMARY KEY, workspace_id text NOT NULL, connector_id text, status text,
        next_attempt_at timestamp
      );
      CREATE TABLE knowledge_connector_sync_log (id text PRIMARY KEY);
      CREATE TABLE knowledge_connector_member_sync_log (
        id text PRIMARY KEY, status text,
        CONSTRAINT kcmsl_status_check CHECK (status IN ('started', 'completed', 'failed'))
      );
      CREATE TABLE document (
        id text PRIMARY KEY, knowledge_base_id text, connector_id text, external_id text,
        user_excluded boolean DEFAULT false, archived_at timestamp,
        tag1 text, tag2 text, tag3 text, tag4 text, tag5 text, tag6 text, tag7 text
      );
      CREATE INDEX doc_connector_id_idx ON document (connector_id);
      CREATE TABLE embedding (
        id text PRIMARY KEY, knowledge_base_id text,
        tag1 text, tag2 text, tag3 text, tag4 text, tag5 text, tag6 text, tag7 text
      );
      CREATE TABLE pending_credential_draft (
        id text PRIMARY KEY, workspace_id text NOT NULL, user_id text, provider_id text
      );
      CREATE TABLE workspace_files (
        id text PRIMARY KEY, workspace_id text, context text, folder_id text, chat_id text
      );
      CREATE TABLE rate_limit_bucket (id text PRIMARY KEY);
      CREATE TABLE resource_policy (
        id text PRIMARY KEY, workspace_id text NOT NULL, resource_type text, resource_id text,
        revision integer, document jsonb, created_by text, updated_by text
      );
      CREATE TABLE unrelated_constraint_owner (
        id text CONSTRAINT credential_owner_check CHECK (id IS NOT NULL)
      );
      INSERT INTO organization VALUES ('org-a'), ('org-b');
      INSERT INTO workspace VALUES ('workspace-a'), ('workspace-b');
      INSERT INTO credential (id, workspace_id, type) VALUES ('legacy', 'workspace-a', 'oauth');
      INSERT INTO knowledge_base (id, workspace_id, name)
      VALUES ('search-index', 'workspace-a', 'Sim Search'), ('ordinary-kb', 'workspace-b', 'Guides');
      INSERT INTO knowledge_connector (id, access_mode, sync_interval_minutes, status, next_sync_at)
      VALUES ('automatic', 'admin', 60, 'active', now() + interval '1 day'),
        ('manual', 'admin', 0, 'active', now() + interval '1 day');
    `)
  } catch (error) {
    await cleanup()
    throw error
  }

  return {
    sql,
    schema,
    statements,
    cleanup,
    async migrate() {
      await sql.unsafe('BEGIN')
      for (const statement of statements) await sql.unsafe(statement)
      await sql.unsafe('COMMIT')
    },
  }
}

describe.skipIf(!databaseUrl)('Organization Search PostgreSQL migration replay', () => {
  it('preserves old uniqueness and data when a concurrent replacement fails, then replays after repair', async () => {
    const fixture = await createMigrationFixture()
    const { sql, schema } = fixture
    try {
      await sql`INSERT INTO credential_group (id, workspace_id, name)
        VALUES ('first', 'workspace-a', 'First'), ('duplicate', 'workspace-a', 'Second')`
      await expect(fixture.migrate()).rejects.toMatchObject({ code: '23505' })
      expect(
        await sql`SELECT indisvalid FROM pg_index
        WHERE indexrelid = ${`"${schema}"."credential_group_workspace_unique"`}::regclass`
      ).toEqual([{ indisvalid: false }])
      await expect(fixture.migrate()).rejects.toMatchObject({
        code: 'P0001',
        message: expect.stringContaining('credential_group_workspace_unique'),
        hint: expect.stringContaining('Repair the listed indexes'),
      })
      expect(await sql`SELECT id FROM credential_group`).toHaveLength(2)
      await expect(sql`INSERT INTO credential_group (id, workspace_id, name)
        VALUES ('third', 'workspace-a', 'First')`).rejects.toMatchObject({
        code: '23505',
        constraint_name: 'credential_group_workspace_name_unique',
      })
      await sql`DELETE FROM credential_group WHERE id = 'duplicate'`
      await sql.unsafe('DROP INDEX CONCURRENTLY credential_group_workspace_unique')
      await fixture.migrate()
      await expect(sql`INSERT INTO credential_group (id, workspace_id, name)
        VALUES ('third', 'workspace-a', 'Different')`).rejects.toMatchObject({
        code: '23505',
        constraint_name: 'credential_group_workspace_unique',
      })
    } finally {
      await fixture.cleanup()
    }
  })

  it.each(['complete migration', 'committed pre-index phase'] as const)(
    'replays after a %s without losing owner constraints or workspace behavior',
    async (interruption) => {
      const fixture = await createMigrationFixture()
      const { sql, schema } = fixture
      try {
        if (interruption === 'complete migration') {
          await fixture.migrate()
        } else {
          const commit = fixture.statements.findIndex(
            (statement) => statement === 'SET lock_timeout = 0;'
          )
          expect(commit).toBeGreaterThan(0)
          await sql.unsafe('BEGIN')
          for (const statement of fixture.statements.slice(0, commit + 1)) {
            await sql.unsafe(statement)
          }
        }
        await fixture.migrate()

        const indexes = await sql`
          SELECT indexname FROM pg_indexes WHERE schemaname = ${schema}
        `
        const expectedIndexes = fixture.statements.flatMap((statement) => {
          const match = statement.match(
            /CREATE (?:UNIQUE )?INDEX CONCURRENTLY IF NOT EXISTS "([^"]+)"/
          )
          return match ? [match[1]] : []
        })
        expect(indexes.map((index) => index.indexname)).toEqual(
          expect.arrayContaining(expectedIndexes)
        )
        expect(
          await sql`
          SELECT indexrelid FROM pg_index
          JOIN pg_class ON pg_class.oid = pg_index.indrelid
          JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
          WHERE pg_namespace.nspname = ${schema} AND NOT indisvalid
        `
        ).toHaveLength(0)

        const ownerConstraints = await sql`
          SELECT conrelid::regclass::text AS table_name FROM pg_constraint
          WHERE conname = 'credential_owner_check'
            AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = ${schema})
        `
        expect(ownerConstraints.map((constraint) => constraint.table_name)).toEqual(
          expect.arrayContaining(['credential', 'unrelated_constraint_owner'])
        )
        await expect(sql`
          INSERT INTO credential (id, workspace_id, organization_id, type)
          VALUES ('dual-owner', 'workspace-a', 'org-a', 'oauth')
        `).rejects.toMatchObject({ code: '23514', constraint_name: 'credential_owner_check' })
        expect(
          await sql`SELECT workspace_id, organization_id FROM credential WHERE id = 'legacy'`
        ).toEqual([{ workspace_id: 'workspace-a', organization_id: null }])

        expect(await sql`SELECT id, is_search_index FROM knowledge_base ORDER BY id`).toEqual([
          { id: 'ordinary-kb', is_search_index: false },
          { id: 'search-index', is_search_index: true },
        ])
        expect(
          await sql`SELECT id, next_sync_at <= now() + interval '61 minutes' AS rearmed
          FROM knowledge_connector ORDER BY id`
        ).toEqual([
          { id: 'automatic', rearmed: true },
          { id: 'manual', rearmed: false },
        ])
        await sql`INSERT INTO knowledge_connector_member_sync_log VALUES ('partial-sync', 'partial')`
        await sql`INSERT INTO document (id) VALUES ('new-document')`
        expect(await sql`SELECT acl_requirements, acl_verified_at FROM document`).toEqual([
          { acl_requirements: [], acl_verified_at: null },
        ])
        await expect(sql`INSERT INTO credential (id, workspace_id, type)
          VALUES ('invalid-token', 'workspace-a', 'personal_token')`).rejects.toMatchObject({
          code: '23514',
          constraint_name: 'credential_personal_token_source_check',
        })
        await sql`INSERT INTO credential (id, workspace_id, type, provider_id, authorization_app_id,
          provider_subject_id, managed_oauth_status, granted_scopes, encrypted_oauth_token_set, granted_at)
          VALUES ('github', 'workspace-a', 'managed_oauth', 'github', 'app', 'subject', 'active', '{}', 'encrypted-test-token', now())`
        await sql`
          INSERT INTO knowledge_external_directory (workspace_id, provider_id, tenant_id)
          VALUES ('workspace-a', 'google-drive', 'tenant-a')
          ON CONFLICT (workspace_id, provider_id, tenant_id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id
        `
        await sql`
          INSERT INTO knowledge_external_directory (organization_id, provider_id, tenant_id)
          VALUES ('org-a', 'google-drive', 'tenant-a'), ('org-b', 'google-drive', 'tenant-a')
        `
        expect(await sql`SELECT * FROM knowledge_external_directory`).toHaveLength(3)

        await sql.unsafe(`
          CREATE TRIGGER credential_group_resource_policy_lifecycle
          AFTER INSERT OR DELETE ON credential_group FOR EACH ROW
          EXECUTE FUNCTION "${schema}".sync_credential_group_resource_policy();
        `)
        await sql`
          INSERT INTO credential_group (id, workspace_id, organization_id)
          VALUES ('workspace-group', 'workspace-a', NULL), ('org-group', NULL, 'org-a')
        `
        expect(await sql`SELECT resource_id, workspace_id FROM resource_policy`).toEqual([
          { resource_id: 'workspace-group', workspace_id: 'workspace-a' },
        ])
        await sql`DELETE FROM credential_group WHERE id = 'org-group'`
        expect(await sql`SELECT id FROM resource_policy`).toHaveLength(1)
        await sql`DELETE FROM credential_group WHERE id = 'workspace-group'`
        expect(await sql`SELECT id FROM resource_policy`).toHaveLength(0)
      } finally {
        await fixture.cleanup()
      }
    }
  )
})
