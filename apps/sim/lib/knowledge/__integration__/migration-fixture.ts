import { readFile } from 'node:fs/promises'
import { generateId } from '@sim/utils/id'
import postgres from 'postgres'

/** Minimal pre-migration tables in an isolated schema; the entire migration runs unchanged. */
export async function createEnterpriseSearchMigrationFixture(databaseUrl: string) {
  const url = new URL(databaseUrl)
  if (
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    !url.pathname.startsWith('/sim_acl_test')
  ) {
    throw new Error('Search migration tests require a disposable local sim_acl_test database')
  }
  const client = postgres(databaseUrl, { max: 1, fetch_types: false })
  const schemaName = `search_migration_${generateId().replaceAll('-', '')}`
  await client.unsafe(`CREATE SCHEMA "${schemaName}"`)
  await client.unsafe(`SET search_path TO "${schemaName}"`)
  await client.unsafe(`
    CREATE TABLE workspace (id text PRIMARY KEY);
    CREATE TABLE "user" (id text PRIMARY KEY, email text NOT NULL);
    CREATE TABLE rate_limit_bucket (id text PRIMARY KEY);
    CREATE TABLE document (
      id text PRIMARY KEY, external_id text, connector_id text, knowledge_base_id text,
      tag1 text, tag2 text, tag3 text, tag4 text, tag5 text, tag6 text, tag7 text,
      acl text[] NOT NULL DEFAULT '{ws}', storage_key text,
      user_excluded boolean NOT NULL DEFAULT false, archived_at timestamp
    );
    CREATE INDEX doc_connector_id_idx ON document(connector_id);
    CREATE TABLE knowledge_connector (
      id text PRIMARY KEY, access_mode text DEFAULT 'workspace', status text DEFAULT 'active',
      member_sync_status text DEFAULT 'idle', sync_interval_minutes integer DEFAULT 1440,
      next_sync_at timestamp, next_member_sync_at timestamp, archived_at timestamp, deleted_at timestamp
    );
    CREATE TABLE knowledge_connector_member (
      id text PRIMARY KEY, connector_id text, subject_token text, status text DEFAULT 'active',
      member_synced_through timestamp, next_attempt_at timestamp
    );
    CREATE TABLE knowledge_connector_sync_log (id text PRIMARY KEY);
    CREATE TABLE knowledge_connector_member_sync_log (
      id text PRIMARY KEY, status text NOT NULL,
      CONSTRAINT kcmsl_status_check CHECK (status IN ('started', 'completed', 'failed'))
    );
    CREATE TABLE knowledge_base (
      id text PRIMARY KEY, workspace_id text, name text NOT NULL, deleted_at timestamp
    );
    CREATE TABLE credential_group (
      id text PRIMARY KEY, workspace_id text NOT NULL, name text NOT NULL, status text DEFAULT 'active'
    );
    CREATE UNIQUE INDEX credential_group_workspace_name_unique ON credential_group(workspace_id, name);
    CREATE INDEX credential_group_workspace_status_idx ON credential_group(workspace_id, status);
    CREATE TABLE knowledge_document_observation (
      document_id text NOT NULL, member_id text NOT NULL, last_seen_at timestamp NOT NULL,
      PRIMARY KEY (document_id, member_id)
    );
    CREATE TABLE embedding (
      id text PRIMARY KEY, document_id text NOT NULL, content text, knowledge_base_id text,
      tag1 text, tag2 text, tag3 text, tag4 text, tag5 text, tag6 text, tag7 text
    );
  `)
  for (const [table, prefix] of [
    ['document', 'doc'],
    ['embedding', 'emb'],
  ]) {
    for (let slot = 1; slot <= 7; slot++) {
      await client.unsafe(`CREATE INDEX ${prefix}_tag${slot}_idx ON ${table}(tag${slot})`)
    }
  }
  const migration = await readFile(
    new URL('../../../../../packages/db/migrations/0323_enterprise_search.sql', import.meta.url),
    'utf8'
  )
  const statements = migration
    .replaceAll('"public"."workspace"', `"${schemaName}"."workspace"`)
    .replaceAll('"public"."knowledge_external_group"', `"${schemaName}"."knowledge_external_group"`)
    .split('--> statement-breakpoint')
    .filter((statement) => statement.trim())
  return {
    client,
    async migrate() {
      for (const statement of statements) await client.unsafe(statement)
    },
    async cleanup() {
      await client.unsafe(`DROP SCHEMA "${schemaName}" CASCADE`)
      await client.end()
    },
  }
}
