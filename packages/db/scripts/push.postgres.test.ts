import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prepareForcedPush } from '@sim/db/scripts/prepare-push'
import { generateId } from '@sim/utils/id'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const databaseUrl = process.env.DB_PUSH_TEST_DATABASE_URL

describe.skipIf(!databaseUrl)('patched Drizzle push against PostgreSQL', () => {
  const databaseName = `push_policy_${generateId().replaceAll('-', '')}`
  let admin: Sql
  let sql: Sql
  let fixtureUrl: string
  let directory: string

  beforeAll(async () => {
    admin = postgres(databaseUrl!, { max: 1, onnotice: () => {} })
    await admin`CREATE DATABASE ${admin(databaseName)}`
    const url = new URL(databaseUrl!)
    url.pathname = `/${databaseName}`
    fixtureUrl = url.toString()
    sql = postgres(fixtureUrl, { max: 1, onnotice: () => {} })
    directory = await mkdtemp(join(tmpdir(), 'push-policy-'))
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
      `import { pgTable, pgSchema, pgEnum, text, integer, bigint, boolean, check } from ${JSON.stringify(import.meta.resolve('drizzle-orm/pg-core'))}
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

  async function legacyColumns() {
    await sql`CREATE TABLE records (id text PRIMARY KEY, old_label text, old_enabled boolean)`
    await sql`INSERT INTO records VALUES ('existing', 'original value', true)`
    await schema(`export const records = pgTable('records', {
  id: text('id').primaryKey(),
  newLabel: text('new_label').default('new default'),
  newEnabled: boolean('new_enabled').notNull().default(false),
})`)
  }

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
