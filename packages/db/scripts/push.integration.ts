import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareForcedPush } from '@sim/db/scripts/prepare-push'
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { generateId } from '@sim/utils/id'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const databaseUrl = readTestDatabaseUrl()

describe('patched Drizzle push against PostgreSQL', () => {
  const databaseName = `push_policy_${generateId().replaceAll('-', '')}`
  let admin: Sql
  let sql: Sql
  let fixtureUrl: string
  let directory: string

  beforeAll(async () => {
    admin = postgres(databaseUrl, { max: 1, onnotice: () => {} })
    await admin`CREATE DATABASE ${admin(databaseName)}`
    const url = new URL(databaseUrl)
    url.pathname = `/${databaseName}`
    fixtureUrl = url.toString()
    sql = postgres(fixtureUrl, { max: 1, onnotice: () => {} })
    directory = await mkdtemp(join(tmpdir(), 'push-policy-'))
    await symlink(fileURLToPath(new URL('.', import.meta.url)), join(directory, 'scripts'))
    await writeFile(
      join(directory, 'drizzle.config.ts'),
      `export default {
  dialect: 'postgresql',
  schema: ${JSON.stringify(join(directory, 'schema.ts'))},
  schemaFilter: ['public', 'old_scope', 'new_scope'],
  tablesFilter: ['!script_migrations'],
  dbCredentials: { url: process.env.DATABASE_URL },
}`
    )
  })

  beforeEach(async () => {
    await sql`DROP SCHEMA IF EXISTS old_scope CASCADE`
    await sql`DROP SCHEMA IF EXISTS new_scope CASCADE`
    await sql`DROP SCHEMA public CASCADE`
    await sql`CREATE SCHEMA public`
  })

  afterAll(async () => {
    await sql?.end()
    if (admin) {
      await admin`DROP DATABASE IF EXISTS ${admin(databaseName)}`
      await admin.end()
    }
    if (directory) await rm(directory, { recursive: true, force: true })
  })

  async function schema(source: string) {
    await writeFile(
      join(directory, 'schema.ts'),
      `import { pgTable, pgSchema, pgEnum, text, integer, bigint, boolean, check, index } from ${JSON.stringify(import.meta.resolve('drizzle-orm/pg-core'))}
import { sql } from ${JSON.stringify(import.meta.resolve('drizzle-orm'))}
${source}`
    )
  }

  /** Exercise the patched CLI with pipes, never a terminal or canned prompt answers. */
  function push(args = ['--force'], renameMode: string | undefined = 'create') {
    return spawnSync(
      'bunx',
      [
        '--no-install',
        'drizzle-kit',
        'push',
        '--config',
        join(directory, 'drizzle.config.ts'),
        ...args,
      ],
      {
        env: { ...process.env, DATABASE_URL: fixtureUrl, SIM_DB_PUSH_RENAME_MODE: renameMode },
        encoding: 'utf8',
        timeout: 30_000,
      }
    )
  }

  function runPush(args: string[]) {
    return spawnSync(
      'bun',
      ['--no-env-file', fileURLToPath(new URL('./push.ts', import.meta.url)), ...args],
      {
        cwd: directory,
        env: { ...process.env, DATABASE_URL: fixtureUrl, MIGRATION_DATABASE_URL: fixtureUrl },
        encoding: 'utf8',
        timeout: 30_000,
      }
    )
  }

  async function legacyColumns() {
    await sql`CREATE TABLE records (id text PRIMARY KEY, old_label text, old_enabled boolean)`
    await sql`INSERT INTO records VALUES ('existing', 'original value', true)`
    await schema(`export const records = pgTable('records', {
  id: text('id').primaryKey(),
  newLabel: text('new_label').default('new default'),
  newEnabled: boolean('new_enabled').notNull().default(false),
})`)
  }

  it('requires approval to retire keyword writers and preserves updates when later reconciliation fails', async () => {
    await sql`CREATE TABLE knowledge_base (id text PRIMARY KEY, is_search_index boolean NOT NULL DEFAULT false)`
    await sql`CREATE TABLE embedding (id text PRIMARY KEY, content text NOT NULL)`
    await sql`CREATE TABLE embedding_keyword_search (id text PRIMARY KEY, content text NOT NULL)`
    await sql`INSERT INTO knowledge_base VALUES ('kb', false)`
    await sql`INSERT INTO embedding VALUES ('chunk', 'retained content')`
    await sql`INSERT INTO embedding_keyword_search VALUES ('chunk', 'obsolete content')`
    await sql.unsafe(`CREATE FUNCTION sync_embedding_keyword_search() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        DELETE FROM embedding_keyword_search WHERE id = NEW.id;
        RETURN NEW;
      END $$`)
    await sql`CREATE TRIGGER embedding_keyword_search_sync AFTER UPDATE ON embedding
      FOR EACH ROW EXECUTE FUNCTION sync_embedding_keyword_search()`
    await sql.unsafe(`CREATE FUNCTION sync_knowledge_base_keyword_search() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        DELETE FROM embedding_keyword_search;
        RETURN NEW;
      END $$`)
    await sql`CREATE TRIGGER knowledge_base_keyword_search_sync AFTER UPDATE ON knowledge_base
      FOR EACH ROW EXECUTE FUNCTION sync_knowledge_base_keyword_search()`
    await schema(`export const chunks = pgTable('embedding', {
      id: text('id').primaryKey(), content: text('content').notNull(),
    })
export const knowledgeBases = pgTable('knowledge_base', {
      id: text('id').primaryKey(), isSearchIndex: boolean('is_search_index').notNull().default(false),
    })`)
    const denied = runPush([])
    expect(denied.error).toBeUndefined()
    expect(denied.status, denied.stdout + denied.stderr).toBe(1)
    await sql`UPDATE embedding SET content = 'unapproved push retained writer' WHERE id = 'chunk'`
    expect(await sql`SELECT id FROM embedding_keyword_search`).toEqual([])
    const emptyDenied = runPush([])
    expect(emptyDenied.error).toBeUndefined()
    expect(emptyDenied.status, emptyDenied.stdout + emptyDenied.stderr).toBe(1)
    await sql`UPDATE knowledge_base SET is_search_index = false WHERE id = 'kb'`
    const result = runPush(['--force'])
    expect(result.error).toBeUndefined()
    expect(result.status, result.stdout + result.stderr).not.toBe(0)
    expect(await sql`SELECT to_regclass('embedding_keyword_search') AS projection`).toEqual([
      { projection: null },
    ])
    await sql`UPDATE embedding SET content = 'updated content' WHERE id = 'chunk'`
    await sql`UPDATE knowledge_base SET is_search_index = true WHERE id = 'kb'`
    expect(await sql`SELECT content FROM embedding`).toEqual([{ content: 'updated content' }])
    expect(await sql`SELECT is_search_index FROM knowledge_base`).toEqual([
      { is_search_index: true },
    ])
  }, 30_000)

  it.each([false, true])(
    'uses the direct migration connection for Project reconciliation (application URL present=%s)',
    async (applicationUrlPresent) => {
      const unavailable = new URL(fixtureUrl)
      unavailable.port = '1'
      const result = spawnSync(
        'bun',
        [
          '--no-env-file',
          fileURLToPath(new URL('./reconcile-project-membership.ts', import.meta.url)),
          '--prepare',
        ],
        {
          env: {
            ...process.env,
            DATABASE_URL: applicationUrlPresent ? unavailable.toString() : undefined,
            MIGRATION_DATABASE_URL: fixtureUrl,
          },
          encoding: 'utf8',
          timeout: 15_000,
        }
      )
      expect(result.error).toBeUndefined()
      expect(result.status, result.stdout + result.stderr).toBe(0)
    },
    30_000
  )

  it('preserves legacy assignments without copying or synchronizing through schema push and replay', async () => {
    await sql`CREATE TABLE project (id text PRIMARY KEY)`
    await sql`CREATE TABLE workspace (id text PRIMARY KEY, forked_from_workspace_id text)`
    await sql`CREATE TABLE project_workspace (project_id text NOT NULL, workspace_id text NOT NULL CONSTRAINT project_workspace_workspace_id_unique UNIQUE)`
    await sql`INSERT INTO project VALUES ('family'), ('singleton')`
    await sql`INSERT INTO workspace VALUES ('root', NULL), ('fork', 'root'), ('standalone', NULL)`
    await sql`INSERT INTO project_workspace VALUES ('family', 'root'), ('family', 'fork'), ('singleton', 'standalone')`
    await schema(`export const projects = pgTable('project', { id: text('id').primaryKey() })
export const workspaces = pgTable('workspace', {
  id: text('id').primaryKey(), forkedFromWorkspaceId: text('forked_from_workspace_id'), projectId: text('project_id'),
}, (table) => [index('workspace_project_id_id_idx').on(table.projectId, table.id).concurrently()])
export const rollout = pgTable('project_membership_rollout', {
  id: text('id').primaryKey(), phase: text('phase').notNull().default('connector'),
}, (table) => [check('project_membership_rollout_singleton', sql\`\${table.id} = 'membership'\`), check('project_membership_rollout_phase', sql\`\${table.phase} IN ('connector', 'column')\`)])
export const memberships = pgTable('project_workspace', {
  projectId: text('project_id').notNull(), workspaceId: text('workspace_id').notNull().unique(),
})`)
    const first = runPush(['--force'])
    expect(first.error, first.stderr).toBeUndefined()
    // Other reconcilers require their own tables; their failure must not undo Project preparation.
    expect(
      await sql`SELECT id, project_id FROM workspace ORDER BY id`,
      first.stdout + first.stderr
    ).toEqual([
      { id: 'fork', project_id: null },
      { id: 'root', project_id: null },
      { id: 'standalone', project_id: null },
    ])
    expect(await sql`SELECT phase FROM project_membership_rollout`).toEqual([
      { phase: 'connector' },
    ])
    await sql`UPDATE project_membership_rollout SET phase = 'column' WHERE id = 'membership'`
    await sql`UPDATE project_workspace SET project_id = 'singleton' WHERE workspace_id = 'fork'`
    await sql`UPDATE workspace SET project_id = 'family' WHERE id = 'standalone'`
    const indexBeforeReplay = await sql`SELECT indexrelid, indisvalid FROM pg_index
      WHERE indexrelid = 'workspace_project_id_id_idx'::regclass`
    expect(indexBeforeReplay).toEqual([{ indexrelid: expect.any(Number), indisvalid: true }])
    const repeated = runPush(['--force'])
    expect(repeated.error, repeated.stderr).toBeUndefined()
    expect(await sql`SELECT phase FROM project_membership_rollout`).toEqual([{ phase: 'column' }])
    expect(
      await sql`SELECT indexrelid, indisvalid FROM pg_index
        WHERE indexrelid = 'workspace_project_id_id_idx'::regclass`
    ).toEqual(indexBeforeReplay)
    expect(
      await sql`SELECT w.id, w.project_id, pw.project_id AS legacy FROM workspace w
      JOIN project_workspace pw ON pw.workspace_id = w.id ORDER BY w.id`
    ).toEqual([
      { id: 'fork', project_id: null, legacy: 'singleton' },
      { id: 'root', project_id: null, legacy: 'family' },
      { id: 'standalone', project_id: 'family', legacy: 'singleton' },
    ])
  }, 60_000)

  it('repairs an interrupted Project index build during schema-push reconciliation', async () => {
    await sql`CREATE TABLE project (id text PRIMARY KEY)`
    await sql`CREATE TABLE workspace (id text PRIMARY KEY, project_id text)`
    await sql`CREATE TABLE project_workspace (project_id text NOT NULL, workspace_id text NOT NULL UNIQUE)`
    await sql`INSERT INTO project VALUES ('family')`
    await sql`CREATE TABLE project_membership_rollout (id text PRIMARY KEY, phase text NOT NULL)`
    await sql`INSERT INTO project_membership_rollout VALUES ('membership', 'column')`
    await sql`INSERT INTO workspace VALUES ('root', 'family'), ('fork', 'family')`
    await expect(
      sql`CREATE UNIQUE INDEX CONCURRENTLY workspace_project_id_id_idx ON workspace(project_id)`
    ).rejects.toMatchObject({ code: '23505' })
    expect(
      await sql`SELECT indisvalid FROM pg_index WHERE indexrelid = 'workspace_project_id_id_idx'::regclass`
    ).toEqual([{ indisvalid: false }])
    const result = spawnSync(
      'bun',
      [
        '--no-env-file',
        fileURLToPath(new URL('./reconcile-project-membership.ts', import.meta.url)),
      ],
      {
        env: { ...process.env, DATABASE_URL: fixtureUrl, MIGRATION_DATABASE_URL: fixtureUrl },
        encoding: 'utf8',
        timeout: 15_000,
      }
    )
    expect(result.error).toBeUndefined()
    expect(result.status, result.stdout + result.stderr).toBe(0)
    expect(
      await sql`SELECT indisvalid, indisunique FROM pg_index
        WHERE indexrelid = 'workspace_project_id_id_idx'::regclass`
    ).toEqual([{ indisvalid: true, indisunique: false }])
    expect(await sql`SELECT id, project_id FROM workspace ORDER BY id`).toEqual([
      { id: 'fork', project_id: 'family' },
      { id: 'root', project_id: 'family' },
    ])
  })

  it('refuses a schema downgrade before recreating the retired Project connector', async () => {
    await sql`CREATE TABLE project (id text PRIMARY KEY)`
    await sql`CREATE TABLE workspace (id text PRIMARY KEY, project_id text NOT NULL)`
    await sql`INSERT INTO project VALUES ('retained')`
    await sql`INSERT INTO workspace VALUES ('environment', 'retained')`
    await schema(`export const projects = pgTable('project', { id: text('id').primaryKey() })
export const workspaces = pgTable('workspace', { id: text('id').primaryKey(), projectId: text('project_id') })
export const memberships = pgTable('project_workspace', {
  projectId: text('project_id').notNull(), workspaceId: text('workspace_id').notNull().unique(),
})`)
    const result = runPush(['--force'])
    expect(result.status, result.stdout + result.stderr).toBe(1)
    expect(await sql`SELECT to_regclass('public.project_workspace') AS legacy`).toEqual([
      { legacy: null },
    ])
    expect(
      await sql`SELECT attnotnull FROM pg_attribute WHERE attrelid = 'workspace'::regclass AND attname = 'project_id'`
    ).toEqual([{ attnotnull: true }])
    expect(await sql`SELECT project_id FROM workspace`).toEqual([{ project_id: 'retained' }])
  }, 30_000)

  it('retires the legacy size bridge without losing bigint or unbackfilled values', async () => {
    await sql`CREATE TABLE workspace_files (id text PRIMARY KEY, size integer NOT NULL, size_bytes bigint)`
    await sql`INSERT INTO workspace_files VALUES ('legacy', 123, NULL), ('large', 2147483647, 5000000000)`
    await sql.unsafe(
      await readFile(
        new URL('../migrations/0308_workspace_file_size_cutover.sql', import.meta.url),
        'utf8'
      )
    )
    await prepareForcedPush(sql)
    await prepareForcedPush(sql)
    await schema(`export const files = pgTable('workspace_files', {
      id: text('id').primaryKey(), sizeBytes: bigint('size_bytes', { mode: 'number' }),
    })`)
    const result = push()
    expect(result.status, result.stdout + result.stderr).toBe(0)
    expect(await sql`SELECT id, size_bytes::text FROM workspace_files ORDER BY id`).toEqual([
      { id: 'large', size_bytes: '5000000000' },
      { id: 'legacy', size_bytes: '123' },
    ])
    expect(
      await sql`SELECT to_regprocedure('sync_workspace_file_size_columns()') AS bridge`
    ).toEqual([{ bridge: null }])
  }, 30_000)

  it('rolls back preparation instead of cascading unknown dependencies', async () => {
    await sql`CREATE TABLE workspace_files (id text PRIMARY KEY, size integer NOT NULL, size_bytes bigint)`
    await sql`INSERT INTO workspace_files VALUES ('legacy', 123, NULL)`
    await sql.unsafe(
      await readFile(
        new URL('../migrations/0308_workspace_file_size_cutover.sql', import.meta.url),
        'utf8'
      )
    )
    await sql`CREATE VIEW retained_sizes AS SELECT size FROM workspace_files`
    await expect(prepareForcedPush(sql)).rejects.toThrow('depend')
    expect(await sql`SELECT size, size_bytes FROM workspace_files`).toEqual([
      { size: 123, size_bytes: null },
    ])
    expect(
      await sql`SELECT tgname FROM pg_trigger WHERE tgrelid = 'workspace_files'::regclass AND NOT tgisinternal`
    ).toEqual([{ tgname: 'workspace_files_sync_size_columns' }])
  })

  it('prepares both fresh databases and legacy schemas without the new column', async () => {
    await prepareForcedPush(sql)
    await sql`CREATE TABLE workspace_files (id text PRIMARY KEY, size integer NOT NULL)`
    await sql`INSERT INTO workspace_files VALUES ('legacy', 456)`
    await prepareForcedPush(sql)
    expect(await sql`SELECT * FROM workspace_files`).toEqual([{ id: 'legacy', size_bytes: '456' }])
  })

  it('initializes a fresh database', async () => {
    await schema(`export const records = pgTable('records', {
  id: text('id').primaryKey(), enabled: boolean('enabled').notNull().default(false),
})`)
    const result = push()
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
    await sql`INSERT INTO records (id) VALUES ('new-row')`
    expect(await sql`SELECT * FROM records`).toEqual([{ id: 'new-row', enabled: false }])
  }, 30_000)

  it('creates independent columns across ambiguous pairs and can be rerun', async () => {
    await legacyColumns()
    const result = push()
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
    expect(result.stdout + result.stderr).not.toContain(
      'Interactive prompts require a TTY terminal'
    )
    expect(await sql`SELECT * FROM records`).toEqual([
      { id: 'existing', new_label: 'new default', new_enabled: false },
    ])
    const repeated = push()
    expect(repeated.status).toBe(0)
    expect(repeated.stdout).toContain('No changes detected')
  }, 60_000)

  it('creates independent tables and enums while preserving the excluded script ledger', async () => {
    await sql`CREATE TYPE old_status AS ENUM ('active')`
    await sql`CREATE TABLE old_records (id text PRIMARY KEY, status old_status)`
    await sql`INSERT INTO old_records VALUES ('old-row', 'active')`
    await sql`CREATE TABLE script_migrations (name text PRIMARY KEY)`
    await sql`INSERT INTO script_migrations VALUES ('completed-fixture-migration')`
    await schema(`export const status = pgEnum('new_status', ['active'])
export const records = pgTable('new_records', { id: text('id').primaryKey(), status: status('status') })`)
    const result = push()
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
    expect(await sql`SELECT * FROM new_records`).toEqual([])
    expect(
      await sql`SELECT to_regclass('old_records') AS old_table, to_regtype('old_status') AS old_type`
    ).toEqual([{ old_table: null, old_type: null }])
    expect(await sql`SELECT * FROM script_migrations`).toEqual([
      { name: 'completed-fixture-migration' },
    ])
  }, 30_000)

  it('creates a new schema instead of moving a removed schema', async () => {
    await sql`CREATE SCHEMA old_scope`
    await sql`CREATE TABLE old_scope.records (id text PRIMARY KEY)`
    await sql`INSERT INTO old_scope.records VALUES ('old-row')`
    await schema(`export const scope = pgSchema('new_scope')
export const records = scope.table('records', { id: text('id').primaryKey() })`)
    const result = push()
    expect(result.error).toBeUndefined()
    expect(result.status, result.stdout + result.stderr).toBe(0)
    expect(await sql`SELECT * FROM new_scope.records`).toEqual([])
    expect(await sql`SELECT to_regnamespace('old_scope') AS old_schema`).toEqual([
      { old_schema: null },
    ])
  }, 30_000)

  it('keeps the data-loss approval independent of rename resolution', async () => {
    await legacyColumns()
    const result = push([])
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('Found data-loss statements')
    expect(await sql`SELECT * FROM records`).toEqual([
      { id: 'existing', old_label: 'original value', old_enabled: true },
    ])
  }, 30_000)

  it('retains native rename prompts when the policy is not enabled', async () => {
    await legacyColumns()
    const result = push(['--force'], 'prompt')
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(1)
    expect(result.stdout + result.stderr).toContain('Interactive prompts require a TTY terminal')
    expect(await sql`SELECT old_label FROM records`).toEqual([{ old_label: 'original value' }])
  }, 30_000)

  it('propagates a database DDL error instead of reporting success', async () => {
    await sql`CREATE TABLE records (id text PRIMARY KEY, value integer)`
    await sql`INSERT INTO records VALUES ('invalid-row', -1)`
    await schema(`export const records = pgTable('records', {
  id: text('id').primaryKey(), value: integer('value'),
}, (table) => [check('nonnegative_value', sql\`\${table.value} >= 0\`)])`)
    const result = push()
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('23514')
    expect(await sql`SELECT value FROM records`).toEqual([{ value: -1 }])
  }, 30_000)
})
