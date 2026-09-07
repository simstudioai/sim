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
    new URL('./migrations/0327_organization_search_scope.sql', import.meta.url),
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
      CREATE TABLE organization (id text PRIMARY KEY);
      CREATE TABLE credential (
        id text PRIMARY KEY, workspace_id text NOT NULL, type text, account_id text,
        created_by text, provider_id text, provider_tenant_id text, provider_subject_id text
      );
      CREATE TABLE credential_group (
        id text PRIMARY KEY, workspace_id text NOT NULL, created_by text
      );
      CREATE TABLE copilot_chats (
        id text PRIMARY KEY, workspace_id text, workflow_id text, user_id text, created_at timestamp
      );
      CREATE TABLE knowledge_base (
        id text PRIMARY KEY, workspace_id text, folder_id text, name text,
        is_search_index boolean, deleted_at timestamp
      );
      CREATE TABLE knowledge_connector_member (id text PRIMARY KEY, workspace_id text NOT NULL);
      CREATE TABLE knowledge_external_directory (
        workspace_id text NOT NULL, provider_id text NOT NULL, tenant_id text NOT NULL,
        CONSTRAINT ked_identity_pk PRIMARY KEY (workspace_id, provider_id, tenant_id)
      );
      CREATE TABLE knowledge_external_group (
        workspace_id text NOT NULL, provider_id text, tenant_id text,
        external_group_id text, last_synced_at timestamp
      );
      CREATE TABLE pending_credential_draft (
        id text PRIMARY KEY, workspace_id text NOT NULL, user_id text, provider_id text
      );
      CREATE TABLE workspace_files (
        id text PRIMARY KEY, workspace_id text, context text, folder_id text, chat_id text
      );
      CREATE TABLE resource_policy (
        id text PRIMARY KEY, workspace_id text NOT NULL, resource_type text, resource_id text,
        revision integer, document jsonb, created_by text, updated_by text
      );
      CREATE TABLE unrelated_constraint_owner (
        id text CONSTRAINT credential_owner_check CHECK (id IS NOT NULL)
      );
      INSERT INTO organization VALUES ('org-a'), ('org-b');
      INSERT INTO credential (id, workspace_id, type) VALUES ('legacy', 'workspace-a', 'oauth');
      INSERT INTO knowledge_external_directory VALUES ('workspace-a', 'google-drive', 'tenant-a');
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
  it('keeps the legacy primary key when a failed concurrent replacement build is skipped on replay', async () => {
    const fixture = await createMigrationFixture()
    const { sql, schema } = fixture
    try {
      const commit = fixture.statements.findIndex((statement) => statement === 'COMMIT;')
      expect(commit).toBeGreaterThan(0)
      await sql.unsafe('BEGIN')
      for (const statement of fixture.statements.slice(0, commit + 1)) {
        await sql.unsafe(statement)
      }

      await sql`
        INSERT INTO knowledge_external_directory (workspace_id, provider_id, tenant_id)
        VALUES ('workspace-b', 'google-drive', 'tenant-b')
      `
      /** A duplicate provider makes a real concurrent build fail while the composite primary key remains valid. */
      await expect(
        sql.unsafe(`
        CREATE UNIQUE INDEX CONCURRENTLY ked_workspace_identity_unique
        ON knowledge_external_directory (provider_id)
      `)
      ).rejects.toMatchObject({ code: '23505' })
      expect(
        await sql`
        SELECT indisvalid FROM pg_index
        WHERE indexrelid = ${`"${schema}"."ked_workspace_identity_unique"`}::regclass
      `
      ).toEqual([{ indisvalid: false }])

      await expect(fixture.migrate()).rejects.toMatchObject({
        code: 'P0001',
        message: expect.stringContaining('ked_workspace_identity_unique'),
        hint: expect.stringContaining('Repair the listed indexes'),
      })
      await sql.unsafe('ROLLBACK')
      expect(
        await sql`
        SELECT conname FROM pg_constraint
        WHERE conrelid = ${`"${schema}"."knowledge_external_directory"`}::regclass
          AND conname = 'ked_identity_pk'
      `
      ).toHaveLength(1)
      await expect(sql`
        INSERT INTO knowledge_external_directory (workspace_id, provider_id, tenant_id)
        VALUES ('workspace-a', 'google-drive', 'tenant-a')
      `).rejects.toMatchObject({ code: '23505', constraint_name: 'ked_identity_pk' })

      await sql.unsafe('DROP INDEX CONCURRENTLY ked_workspace_identity_unique')
      await fixture.migrate()
      expect(
        await sql`
        SELECT indisvalid, indisunique FROM pg_index
        WHERE indexrelid = ${`"${schema}"."ked_workspace_identity_unique"`}::regclass
      `
      ).toEqual([{ indisvalid: true, indisunique: true }])
      expect(
        await sql`
        SELECT conname FROM pg_constraint
        WHERE conrelid = ${`"${schema}"."knowledge_external_directory"`}::regclass
          AND conname = 'ked_identity_pk'
      `
      ).toHaveLength(0)
      await expect(sql`
        INSERT INTO knowledge_external_directory (workspace_id, provider_id, tenant_id)
        VALUES ('workspace-a', 'google-drive', 'tenant-a')
      `).rejects.toMatchObject({ code: '23505', constraint_name: 'ked_workspace_identity_unique' })
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
          const commit = fixture.statements.findIndex((statement) => statement === 'COMMIT;')
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
