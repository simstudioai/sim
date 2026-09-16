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
    CREATE TYPE credential_type AS ENUM ('oauth', 'env_personal', 'env_workspace', 'managed_oauth', 'service_account');
    CREATE TABLE organization (id text PRIMARY KEY);
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
    CREATE TABLE credential_group_enrollment (
        id text PRIMARY KEY, credential_group_id text, email text, status text,
        invitation_token_hash text, invitation_expires_at timestamp, invited_at timestamp,
        created_at timestamp, updated_at timestamp, revoked_at timestamp,
        UNIQUE (credential_group_id, email)
      );
    CREATE TABLE copilot_chats (
        id text PRIMARY KEY, workspace_id text, workflow_id text, user_id text, created_at timestamp
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
    CREATE TABLE workspace (id text PRIMARY KEY);
    CREATE TABLE "user" (id text PRIMARY KEY, email text NOT NULL, email_verified boolean);
    CREATE TABLE rate_limit_bucket (id text PRIMARY KEY);
    CREATE TABLE document (
      id text PRIMARY KEY, external_id text, connector_id text, knowledge_base_id text,
      tag1 text, tag2 text, tag3 text, tag4 text, tag5 text, tag6 text, tag7 text,
      acl text[] NOT NULL DEFAULT '{ws}', storage_key text,
      user_excluded boolean NOT NULL DEFAULT false, archived_at timestamp
    );
    CREATE INDEX doc_connector_id_idx ON document(connector_id);
    CREATE TABLE knowledge_connector (
      id text PRIMARY KEY, knowledge_base_id text, connector_type text, access_mode text DEFAULT 'workspace', status text DEFAULT 'active',
      member_sync_status text DEFAULT 'idle', sync_interval_minutes integer DEFAULT 1440,
      next_sync_at timestamp, next_member_sync_at timestamp, archived_at timestamp, deleted_at timestamp
    );
    CREATE TABLE knowledge_connector_member (
      id text PRIMARY KEY, workspace_id text NOT NULL, connector_id text, subject_token text, status text DEFAULT 'active',
      member_synced_through timestamp, next_attempt_at timestamp
    );
    CREATE TABLE knowledge_connector_sync_log (id text PRIMARY KEY);
    CREATE TABLE knowledge_connector_member_sync_log (
      id text PRIMARY KEY, status text NOT NULL,
      CONSTRAINT kcmsl_status_check CHECK (status IN ('started', 'completed', 'failed'))
    );
    CREATE TABLE knowledge_base (
      id text PRIMARY KEY, workspace_id text, folder_id text, name text NOT NULL, deleted_at timestamp
    );
    CREATE TABLE credential_group (
      id text PRIMARY KEY, workspace_id text NOT NULL, name text NOT NULL, status text DEFAULT 'active', created_by text
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
    new URL(
      '../../../../../packages/db/migrations/0326_enterprise_organization_search.sql',
      import.meta.url
    ),
    'utf8'
  )
  const statements = migration
    .replaceAll('"public".', `"${schemaName}".`)
    .replaceAll(
      'SET search_path = pg_catalog, public',
      `SET search_path = pg_catalog, "${schemaName}"`
    )
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
