/**
 * Set TEST_DATABASE_URL to a local PostgreSQL database. Each run uses an
 * isolated schema and executes the real revision query against execution-heavy workspaces.
 */

import * as schema from '@sim/db/schema'
import { generateShortId } from '@sim/utils/id'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { DbOrTx } from '@/lib/db/types'
import {
  assertForkPreviewFresh,
  loadForkPreviewRevision,
} from '@/ee/workspace-forking/application/revision'

const databaseUrl = process.env.TEST_DATABASE_URL
if (databaseUrl && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(databaseUrl).hostname)) {
  throw new Error('Fork revision PostgreSQL tests require a local database')
}

describe.runIf(Boolean(databaseUrl))('fork revision scope in PostgreSQL', () => {
  const testSchema = `fork_revision_${generateShortId()
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase()}`
  let client: ReturnType<typeof postgres>
  let executor: DbOrTx
  const scope = {
    sourceWorkspaceId: 'source',
    targetWorkspaceId: 'target',
    edge: { parentWorkspaceId: 'target', childWorkspaceId: 'source' },
  }

  beforeAll(async () => {
    client = postgres(databaseUrl!, { max: 1, connection: { search_path: testSchema } })
    executor = drizzle(client, { schema }) as DbOrTx
    await client.unsafe(`CREATE SCHEMA ${testSchema}`)
    await client.unsafe(`
      CREATE TABLE workspace (
        id text PRIMARY KEY, organization_id text, name text,
        storage_used_bytes bigint DEFAULT 0, updated_at timestamp
      );
      CREATE TABLE workflow (
        id text PRIMARY KEY, workspace_id text, name text, archived_at timestamp,
        fork_sync_excluded boolean DEFAULT false, is_deployed boolean DEFAULT true,
        run_count integer DEFAULT 0, last_run_at timestamp, updated_at timestamp
      );
      CREATE TABLE workflow_deployment_version (
        id text PRIMARY KEY, workflow_id text, is_active boolean, state jsonb
      );
      CREATE TABLE workspace_files (
        id text PRIMARY KEY, workspace_id text, context text, deleted_at timestamp,
        key text, original_name text, size_bytes bigint, content_updated_at timestamp
      );
      CREATE INDEX ON workspace_files (workspace_id)
        WHERE context = 'workspace' AND deleted_at IS NULL;
      CREATE TABLE permissions (id text PRIMARY KEY, entity_id text, entity_type text, permission_type text);
      CREATE TABLE custom_block (id text PRIMARY KEY, organization_id text, workflow_id text);
    `)
    for (const table of ['workflow_blocks', 'workflow_edges', 'workflow_subflows', 'webhook']) {
      await client.unsafe(
        `CREATE TABLE ${table} (id text PRIMARY KEY, workflow_id text, data jsonb)`
      )
    }
    for (const table of [
      'folder',
      'user_table_definitions',
      'knowledge_base',
      'custom_tools',
      'skill',
      'mcp_servers',
      'credential',
      'workspace_environment',
      'workspace_sandbox',
    ]) {
      await client.unsafe(
        `CREATE TABLE ${table} (id text PRIMARY KEY, workspace_id text, data jsonb)`
      )
    }
    for (const table of [
      'workspace_fork_resource_map',
      'workspace_fork_block_map',
      'workspace_fork_dependent_value',
    ]) {
      await client.unsafe(
        `CREATE TABLE ${table} (id text PRIMARY KEY, child_workspace_id text, data jsonb)`
      )
    }
    await client`INSERT INTO workspace (id, name) VALUES ('source', 'Source'), ('target', 'Target')`
    await client`INSERT INTO workflow (id, workspace_id, name)
      VALUES ('source-workflow', 'source', 'Source workflow'), ('target-workflow', 'target', 'Target workflow')`
    await client`INSERT INTO workflow_deployment_version (id, workflow_id, is_active, state)
      VALUES ('deployment', 'source-workflow', true, '{"blocks":{}}')`
  })

  afterAll(async () => {
    if (!client) return
    await client.unsafe(`DROP SCHEMA IF EXISTS ${testSchema} CASCADE`)
    await client.end()
  })

  beforeEach(async () => {
    await client`TRUNCATE workspace_files, workflow_blocks, permissions`
    await client`UPDATE workspace SET storage_used_bytes = 0, updated_at = null`
    await client`INSERT INTO workspace_files
      (id, workspace_id, context, key, original_name, size_bytes, content_updated_at)
      VALUES ('source-file', 'source', 'workspace', 'workspace/source/file', 'file.txt', 24, '2026-09-01'),
        ('target-file', 'target', 'workspace', 'workspace/target/file', 'file.txt', 24, '2026-09-01')`
  })

  it('ignores more than 100,000 execution files, deleted files, chat uploads, and runtime storage changes', async () => {
    const before = await loadForkPreviewRevision(executor, scope, {})
    await client`INSERT INTO workspace_files (id, workspace_id, context, key, original_name, size_bytes)
      SELECT 'execution-' || n, CASE WHEN n % 2 = 0 THEN 'source' ELSE 'target' END,
        'execution', 'execution/' || n, repeat('x', 700), 128
      FROM generate_series(1, 100001) n`
    await client`INSERT INTO workspace_files (id, workspace_id, context, deleted_at)
      VALUES ('deleted', 'source', 'workspace', now()), ('upload', 'target', 'mothership', null),
        ('kb-document', 'source', 'knowledge-base', null), ('other-workspace', 'unrelated', 'workspace', null)`
    await client`UPDATE workspace SET storage_used_bytes = 999999, updated_at = now()`
    await client`UPDATE workflow SET run_count = run_count + 1, last_run_at = now(), updated_at = now()`

    const after = await loadForkPreviewRevision(executor, scope, {})
    expect(after).toEqual(before)
    await expect(
      assertForkPreviewFresh(executor, scope, {
        workspaceId: 'source',
        requestId: 'request',
        requestHash: 'hash',
        previewFingerprint: before.fingerprint,
        choices: {},
      })
    ).resolves.toBeUndefined()
  })

  it.each(['source', 'target'])(
    'invalidates previews when an active %s file changes or disappears',
    async (workspaceId) => {
      const before = await loadForkPreviewRevision(executor, scope, {})
      await client`UPDATE workspace_files SET content_updated_at = '2026-09-02' WHERE workspace_id = ${workspaceId}`
      const edited = await loadForkPreviewRevision(executor, scope, {})
      expect(edited.categories.files).not.toBe(before.categories.files)

      await client`UPDATE workspace_files SET deleted_at = now() WHERE workspace_id = ${workspaceId}`
      const deleted = await loadForkPreviewRevision(executor, scope, {})
      expect(deleted.categories.files).not.toBe(edited.categories.files)

      await client`UPDATE workspace_files SET deleted_at = null WHERE workspace_id = ${workspaceId}`
      expect((await loadForkPreviewRevision(executor, scope, {})).fingerprint).toBe(
        edited.fingerprint
      )
    }
  )

  it('still detects graph edits, access changes, and changed copy choices', async () => {
    const before = await loadForkPreviewRevision(executor, scope, {})
    await client`INSERT INTO workflow_blocks (id, workflow_id, data)
      VALUES ('block', 'target-workflow', '{"value":"changed"}')`
    await client`INSERT INTO permissions (id, entity_id, entity_type, permission_type)
      VALUES ('member', 'source', 'workspace', 'admin')`
    const after = await loadForkPreviewRevision(executor, scope, {})
    expect(after.categories.target_graph).not.toBe(before.categories.target_graph)
    expect(after.categories.membership).not.toBe(before.categories.membership)
    expect(
      (await loadForkPreviewRevision(executor, scope, { copyResources: [] })).fingerprint
    ).not.toBe(after.fingerprint)
  })

  it('retains the row limit for actual fork resources', async () => {
    await client`INSERT INTO workspace_files (id, workspace_id, context)
      SELECT 'durable-' || n, 'source', 'workspace' FROM generate_series(1, 100001) n`
    await expect(loadForkPreviewRevision(executor, scope, {})).rejects.toMatchObject({
      statusCode: 413,
      message: 'Fork preview files exceeds its 100000 row ceiling',
    })
  })
})
