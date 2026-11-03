import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import journal from '@sim/db/migrations/meta/_journal.json'
import { applyMigration } from '@sim/db/scripts/migration-fixture'
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { generateId } from '@sim/utils/id'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const REFUSAL =
  'Existing Project databases must complete the Project script migration 0032_project_membership before schema push'
const MIGRATION_LOCK_KEY = 4_961_002_270n
const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const databaseUrl = readTestDatabaseUrl()

function databaseUrlFor(name: string): string {
  const url = new URL(databaseUrl)
  url.pathname = `/${name}`
  return url.toString()
}

/** Runs the supported `db:push --force` entrypoint, fence included, against one database. */
function runPush(url: string, devPush: boolean) {
  const result = spawnSync('bun', ['--no-env-file', 'scripts/push.ts', '--force'], {
    cwd: packageRoot,
    env: {
      ...process.env,
      DATABASE_URL: url,
      MIGRATION_DATABASE_URL: url,
      /** The test runner's NODE_ENV silences the child loggers whose messages these tests read. */
      NODE_ENV: 'development',
      SIM_DEV_DB_PUSH: devPush ? '1' : undefined,
    },
    encoding: 'utf8',
    timeout: 120_000,
  })
  expect(result.error).toBeUndefined()
  return { status: result.status, output: result.stdout + result.stderr }
}

async function migrationSql(tag: string): Promise<string> {
  return readFile(new URL(`../migrations/${tag}.sql`, import.meta.url), 'utf8')
}

/** Replays a versioned migration on one session, as the migrator does. */
async function replayMigration(sql: Sql, tag: string): Promise<void> {
  const session = await sql.reserve()
  try {
    await applyMigration(session, await migrationSql(tag))
  } finally {
    session.release()
  }
}

async function projectSchema(sql: Sql) {
  const [state] = await sql`SELECT
    to_regclass('public.project') IS NOT NULL AS project,
    to_regclass('public.project_workspace') IS NOT NULL AS connector,
    to_regclass('public.project_membership_rollout') IS NOT NULL AS rollout,
    (SELECT attnotnull FROM pg_attribute WHERE attrelid = 'public.workspace'::regclass
      AND attname = 'project_id' AND NOT attisdropped) AS required`
  return state
}

/** Everything a refused push must leave exactly as it found it. */
async function retainedState(sql: Sql) {
  const schema = await projectSchema(sql)
  return {
    schema,
    workspaces: await sql`SELECT to_jsonb(w) AS row FROM workspace w ORDER BY id`,
    connector: schema.connector
      ? await sql`SELECT * FROM project_workspace ORDER BY workspace_id`
      : [],
  }
}

describe('development schema push of a database that predates Projects', () => {
  const template = `project_push_template_test_${generateId().replaceAll('-', '')}`
  let admin: Sql

  beforeAll(async () => {
    admin = postgres(databaseUrl, { max: 1, onnotice: () => undefined })
    await admin.unsafe(`CREATE DATABASE "${template}"`)
    const sql = postgres(databaseUrlFor(template), { max: 1, onnotice: () => undefined })
    try {
      for (const extension of ['vector', 'btree_gin', 'pg_trgm']) {
        await sql`CREATE EXTENSION IF NOT EXISTS ${sql(extension)}`
      }
      const fresh = runPush(databaseUrlFor(template), true)
      expect(fresh.status, fresh.output).toBe(0)
      /** Removes every Project object so the template matches a push-managed schema from before Projects. */
      await sql.unsafe(`
        DROP TABLE project CASCADE;
        ALTER TABLE workspace DROP COLUMN project_id CASCADE, DROP COLUMN organization_scope_key CASCADE;
        ALTER TABLE folder DROP COLUMN project_id CASCADE;
        ALTER TABLE workspace_files DROP COLUMN project_id CASCADE;
        DELETE FROM script_migrations WHERE name = '0032_project_membership';
      `)
    } finally {
      await sql.end()
    }
  }, 180_000)

  afterAll(async () => {
    if (!admin) return
    await admin.unsafe(`DROP DATABASE IF EXISTS "${template}" WITH (FORCE)`)
    await admin.end()
  })

  /** Copies the pre-Project template with seeded tenants into a database owned by one test. */
  async function preProjectDatabase(run: (sql: Sql, url: string) => Promise<void>) {
    const name = `project_push_test_${generateId().replaceAll('-', '')}`
    await admin.unsafe(`CREATE DATABASE "${name}" TEMPLATE "${template}"`)
    const url = databaseUrlFor(name)
    const sql = postgres(url, { max: 2, onnotice: () => undefined })
    try {
      await sql.unsafe(`
        INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES
          ('owner', 'Owner', 'owner@example.test', true, now(), now()),
          ('member', 'Member', 'member@example.test', true, now(), now());
        INSERT INTO organization (id, name, slug) VALUES ('org', 'Org', 'org');
        INSERT INTO workspace (id, name, owner_id, billed_account_user_id, organization_id, forked_from_workspace_id, archived_at) VALUES
          ('personal', 'Personal', 'owner', 'owner', NULL, NULL, NULL),
          ('team', 'Team', 'owner', 'owner', 'org', NULL, NULL),
          ('team-fork', 'Team fork', 'member', 'owner', 'org', 'team', NULL),
          ('retired', 'Retired', 'member', 'member', NULL, NULL, '2026-01-01');
        INSERT INTO folder (id, resource_type, name, user_id, workspace_id) VALUES
          ('folder', 'workflow', 'Folder', 'owner', 'team');
      `)
      await run(sql, url)
    } finally {
      await sql.end({ timeout: 2 })
      await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
    }
  }

  async function expectBootstrapped(sql: Sql) {
    expect(await projectSchema(sql)).toEqual({
      project: true,
      connector: false,
      rollout: false,
      required: true,
    })
    const memberships = await sql<{ id: string; project_id: string; archived: boolean }[]>`
      SELECT w.id, w.project_id, p.archived_at IS NOT NULL AS archived
      FROM workspace w JOIN project p ON p.id = w.project_id ORDER BY w.id`
    expect(memberships.map(({ id, archived }) => ({ id, archived }))).toEqual([
      { id: 'personal', archived: false },
      { id: 'retired', archived: true },
      { id: 'team', archived: false },
      { id: 'team-fork', archived: false },
    ])
    const projectOf = new Map(memberships.map((row) => [row.id, row.project_id]))
    expect(projectOf.get('team-fork')).toBe(projectOf.get('team'))
    expect(new Set(projectOf.values()).size).toBe(3)
    expect(
      await sql`SELECT conname, convalidated, condeferrable FROM pg_constraint
        WHERE conrelid = 'workspace'::regclass AND conname IN ('workspace_project_id_project_id_fk',
          'workspace_project_organization_fk', 'workspace_fork_project_fk')
        ORDER BY conname`
    ).toEqual([
      { conname: 'workspace_fork_project_fk', convalidated: true, condeferrable: true },
      { conname: 'workspace_project_id_project_id_fk', convalidated: true, condeferrable: false },
      { conname: 'workspace_project_organization_fk', convalidated: true, condeferrable: true },
    ])
    expect(
      await sql`SELECT name FROM script_migrations WHERE name = '0032_project_membership'`
    ).toEqual([{ name: '0032_project_membership' }])
    await expect(
      sql`UPDATE workspace SET organization_id = NULL WHERE id = 'team-fork'`
    ).rejects.toMatchObject({ code: '23503' })
  }

  it('bootstraps Projects, completes the push, and keeps memberships and constraints on replay', async () => {
    await preProjectDatabase(async (sql, url) => {
      const pushed = runPush(url, true)
      expect(pushed.status, pushed.output).toBe(0)
      await expectBootstrapped(sql)
      const before = await sql`SELECT id, project_id FROM workspace ORDER BY id`
      const replayed = runPush(url, true)
      expect(replayed.status, replayed.output).toBe(0)
      expect(await sql`SELECT id, project_id FROM workspace ORDER BY id`).toEqual(before)
      await expectBootstrapped(sql)
    })
  }, 240_000)

  it('pushes the columns the Project migration reads before running it', async () => {
    await preProjectDatabase(async (sql, url) => {
      await sql`ALTER TABLE workspace DROP COLUMN forked_from_workspace_id CASCADE`
      const pushed = runPush(url, true)
      expect(pushed.status, pushed.output).toBe(0)
      expect(await projectSchema(sql)).toEqual({
        project: true,
        connector: false,
        rollout: false,
        required: true,
      })
      expect(
        await sql`SELECT count(*)::int AS unassigned FROM workspace WHERE project_id IS NULL`
      ).toEqual([{ unassigned: 0 }])
      expect(
        await sql`SELECT count(*)::int AS restored FROM pg_attribute WHERE attrelid = 'workspace'::regclass
          AND attname = 'forked_from_workspace_id' AND NOT attisdropped`
      ).toEqual([{ restored: 1 }])
      expect(
        await sql`SELECT name FROM script_migrations WHERE name = '0032_project_membership'`
      ).toEqual([{ name: '0032_project_membership' }])
    })
  }, 240_000)

  it('resumes after the Project migration reports conflicts', async () => {
    await preProjectDatabase(async (sql, url) => {
      await sql`INSERT INTO workspace (id, name, owner_id, billed_account_user_id, forked_from_workspace_id)
        VALUES ('cycle-a', 'Cycle A', 'owner', 'owner', NULL), ('cycle-b', 'Cycle B', 'owner', 'owner', 'cycle-a')`
      await sql`UPDATE workspace SET forked_from_workspace_id = 'cycle-b' WHERE id = 'cycle-a'`
      const refused = runPush(url, true)
      expect(refused.status, refused.output).toBe(1)
      expect(refused.output).toContain('Project preparation requires operator remediation')
      expect(await projectSchema(sql)).toEqual({
        project: true,
        connector: true,
        rollout: true,
        required: false,
      })
      expect(await sql`SELECT phase FROM project_membership_rollout`).toEqual([{ phase: 'column' }])
      expect(
        await sql`SELECT name FROM script_migrations WHERE name = '0032_project_membership'`
      ).toEqual([])

      await sql`UPDATE workspace SET forked_from_workspace_id = NULL WHERE id = 'cycle-a'`
      const resumed = runPush(url, true)
      expect(resumed.status, resumed.output).toBe(0)
      await sql`DELETE FROM workspace WHERE id IN ('cycle-a', 'cycle-b')`
      await expectBootstrapped(sql)
    })
  }, 240_000)

  it('rolls the foundation back with the expansion when the workspace barrier is busy', async () => {
    await preProjectDatabase(async (sql, url) => {
      const holder = await sql.reserve()
      try {
        await holder`BEGIN`
        await holder`SELECT 1 FROM workspace LIMIT 1`
        const busy = runPush(url, true)
        expect(busy.status, busy.output).toBe(1)
        expect(busy.output).toContain('55P03')
        await holder`ROLLBACK`
      } finally {
        holder.release()
      }
      expect(await projectSchema(sql)).toEqual({
        project: false,
        connector: false,
        rollout: false,
        required: null,
      })
      const pushed = runPush(url, true)
      expect(pushed.status, pushed.output).toBe(0)
      await expectBootstrapped(sql)
    })
  }, 240_000)

  it('leaves the database untouched outside development push mode', async () => {
    await preProjectDatabase(async (sql, url) => {
      const refused = runPush(url, false)
      expect(refused.status, refused.output).toBe(1)
      expect(refused.output).toContain(REFUSAL)
      expect(await projectSchema(sql)).toEqual({
        project: false,
        connector: false,
        rollout: false,
        required: null,
      })
      expect(
        await sql`SELECT name FROM script_migrations WHERE name = '0032_project_membership'`
      ).toEqual([])
    })
  }, 120_000)

  it('refuses to bootstrap while a migration holds the schema lock', async () => {
    await preProjectDatabase(async (sql, url) => {
      const migrator = await sql.reserve()
      try {
        await migrator`SELECT pg_advisory_lock(${MIGRATION_LOCK_KEY})`
        const fenced = runPush(url, true)
        expect(fenced.status, fenced.output).toBe(1)
        expect(fenced.output).toContain('A migration is running')
        await migrator`SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY})`
      } finally {
        migrator.release()
      }
      expect((await projectSchema(sql)).project).toBe(false)
    })
  }, 120_000)

  it.each([
    {
      state: 'a connector with live memberships',
      async build(sql: Sql) {
        await sql.unsafe(await migrationSql('0394_project_foundation'))
        await sql`INSERT INTO project (id, name, owner_id) VALUES ('legacy', 'Legacy', 'owner')`
        await sql`INSERT INTO project_workspace (project_id, workspace_id) VALUES ('legacy', 'personal')`
      },
    },
    {
      state: 'an empty connector without the column expansion',
      async build(sql: Sql) {
        await sql.unsafe(await migrationSql('0394_project_foundation'))
      },
    },
    {
      state: 'Projects without a connector or required column',
      async build(sql: Sql) {
        await sql.unsafe(await migrationSql('0394_project_foundation'))
        await sql`DROP TABLE project_workspace`
      },
    },
    {
      state: 'a workspace Project column without Projects',
      async build(sql: Sql) {
        await sql`ALTER TABLE workspace ADD COLUMN project_id text`
      },
    },
    {
      state: 'folder Project ownership without Projects',
      async build(sql: Sql) {
        await sql`ALTER TABLE folder ADD COLUMN project_id text`
        await sql`UPDATE folder SET project_id = 'orphaned'`
      },
    },
    {
      state: 'a versioned expansion awaiting its script migration',
      async build(sql: Sql) {
        await sql.unsafe(await migrationSql('0394_project_foundation'))
        await replayMigration(sql, '0406_workspace_project_column')
        const expansion = journal.entries.find(
          (entry) => entry.tag === '0406_workspace_project_column'
        )
        await sql`CREATE SCHEMA drizzle`
        await sql`CREATE TABLE drizzle.__drizzle_migrations (id serial PRIMARY KEY, hash text NOT NULL, created_at bigint)`
        await sql`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('fixture', ${expansion?.when ?? 0})`
      },
    },
    {
      state: 'an expansion whose connector holds memberships',
      async build(sql: Sql) {
        await sql.unsafe(await migrationSql('0394_project_foundation'))
        await replayMigration(sql, '0406_workspace_project_column')
        await sql`INSERT INTO project (id, name, owner_id) VALUES ('legacy', 'Legacy', 'owner')`
        await sql`INSERT INTO project_workspace (project_id, workspace_id) VALUES ('legacy', 'personal')`
      },
    },
  ])(
    'refuses development push of $state',
    async ({ build }) => {
      await preProjectDatabase(async (sql, url) => {
        await build(sql)
        const before = await retainedState(sql)
        const refused = runPush(url, true)
        expect(refused.status, refused.output).toBe(1)
        expect(refused.output).toContain(REFUSAL)
        expect(await retainedState(sql)).toEqual(before)
        expect(
          await sql`SELECT name FROM script_migrations WHERE name = '0032_project_membership'`
        ).toEqual([])
      })
    },
    120_000
  )
})
