import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import journal from '@sim/db/migrations/meta/_journal.json'
import { backfillProjects } from '@sim/db/project-backfill'
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { getPostgresErrorCode } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres, { type Sql } from 'postgres'
import { describe, expect, it } from 'vitest'

const migration = await readFile(
  new URL('../migrations/0394_project_membership_enforcement.sql', import.meta.url),
  'utf8'
)

async function database(run: (sql: Sql, url: string) => Promise<void>) {
  const admin = postgres(readTestDatabaseUrl(), { max: 1 })
  const name = `project_contract_test_${generateId().replaceAll('-', '')}`
  const url = new URL(readTestDatabaseUrl())
  url.pathname = `/${name}`
  await admin.unsafe(`CREATE DATABASE "${name}"`)
  const sql = postgres(url.toString(), { max: 4, onnotice: () => undefined })
  try {
    await sql.unsafe(`
      CREATE TABLE "user" (id text PRIMARY KEY);
      CREATE TABLE organization (id text PRIMARY KEY);
      CREATE TABLE workspace (id text PRIMARY KEY, name text NOT NULL, owner_id text NOT NULL,
        organization_id text, archived_at timestamp, forked_from_workspace_id text REFERENCES workspace(id) ON DELETE SET NULL);
      CREATE INDEX workspace_parent_idx ON workspace(forked_from_workspace_id);
      CREATE TABLE workflow (id text PRIMARY KEY, workspace_id text REFERENCES workspace(id) ON DELETE CASCADE, archived_at timestamp);
      INSERT INTO "user" VALUES ('owner'); INSERT INTO organization VALUES ('org');
    `)
    await sql.unsafe(
      await readFile(new URL('../migrations/0393_project_foundation.sql', import.meta.url), 'utf8')
    )
    await run(sql, url.toString())
  } finally {
    await sql.end({ timeout: 2 })
    await admin.unsafe(`DROP DATABASE "${name}" WITH (FORCE)`)
    await admin.end()
  }
}

async function enforce(sql: Sql) {
  const reserved = await sql.reserve()
  try {
    await reserved.unsafe(migration)
  } catch (error) {
    await reserved.unsafe('ROLLBACK')
    throw error
  } finally {
    reserved.release()
  }
}

async function backfill(sql: Sql) {
  const plan = await backfillProjects(sql, { mode: 'dry-run', databaseId: 'contract-test' })
  const applied = await backfillProjects(sql, { mode: 'apply', databaseId: 'contract-test', plan })
  expect(applied.conflicts).toEqual([])
  expect((await backfillProjects(sql, { mode: 'verify', databaseId: 'contract-test' })).ready).toBe(
    true
  )
}

async function seed(sql: Sql) {
  await sql`INSERT INTO workspace (id, name, owner_id) VALUES ('root', 'Production', 'owner')`
  await sql`INSERT INTO workspace (id, name, owner_id, forked_from_workspace_id) VALUES ('child', 'Staging', 'owner', 'root')`
  await sql`INSERT INTO workflow VALUES ('flow', 'root', NULL)`
  await backfill(sql)
}

const constraintFailure = (error: unknown) => getPostgresErrorCode(error) === '23514'

describe('Project expand/backfill/contract against PostgreSQL', () => {
  it('requires rollout evidence only for an existing database with enforcement pending', async () => {
    await database(async (sql, url) => {
      const run = () =>
        promisify(execFile)('bun', ['--no-env-file', 'scripts/project-contract-required.ts'], {
          cwd: new URL('..', import.meta.url),
          env: { ...process.env, DATABASE_URL: url, MIGRATION_DATABASE_URL: url },
        })
      expect((await run()).stdout.trim()).toBe('required=true')
      await sql`CREATE SCHEMA drizzle`
      await sql`CREATE TABLE drizzle.__drizzle_migrations (created_at bigint)`
      const entry = journal.entries.find(
        (item) => item.tag === '0394_project_membership_enforcement'
      )
      if (!entry) throw new Error('Missing contract migration')
      await sql`INSERT INTO drizzle.__drizzle_migrations VALUES (${entry.when - 1})`
      expect((await run()).stdout.trim()).toBe('required=true')
      await sql`INSERT INTO drizzle.__drizzle_migrations VALUES (${entry.when})`
      expect((await run()).stdout.trim()).toBe('required=false')
      await sql`DROP TABLE workspace CASCADE`
      await sql`DROP SCHEMA drizzle CASCADE`
      expect((await run()).stdout.trim()).toBe('required=false')
    })
  })

  it('journals enforcement through the Drizzle runner and safely resumes after a failed precheck', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'project-contract-runner-'))
    try {
      await mkdir(join(directory, 'meta'))
      await writeFile(join(directory, '0394_project_membership_enforcement.sql'), migration)
      await writeFile(
        join(directory, 'meta/_journal.json'),
        JSON.stringify({
          ...journal,
          entries: journal.entries.filter(
            (entry) => entry.tag === '0394_project_membership_enforcement'
          ),
        })
      )
      await database(async (sql) => {
        const run = () => migrate(drizzle(sql), { migrationsFolder: directory })
        await sql`INSERT INTO workspace (id, name, owner_id) VALUES ('legacy', 'Legacy', 'owner')`
        await expect(run()).rejects.toSatisfy(
          (error: unknown) => getPostgresErrorCode(error) === '55000'
        )
        expect(await sql`SELECT * FROM drizzle.__drizzle_migrations`).toHaveLength(0)
        await backfill(sql)
        await run()
        await run()
        expect(await sql`SELECT * FROM drizzle.__drizzle_migrations`).toHaveLength(1)
        await expect(sql`DELETE FROM project_workspace`).rejects.toSatisfy(constraintFailure)
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('refuses missing backfill and installs no partial enforcement, then accepts a verified backfill', async () => {
    await database(async (sql) => {
      await sql`INSERT INTO workspace (id, name, owner_id) VALUES ('legacy', 'Legacy', 'owner')`
      await expect(enforce(sql)).rejects.toSatisfy(
        (error: unknown) => getPostgresErrorCode(error) === '55000'
      )
      expect(
        await sql`SELECT 1 FROM pg_trigger WHERE tgname = 'project_contract_check'`
      ).toHaveLength(0)
      await backfill(sql)
      await enforce(sql)
      await expect(
        sql`INSERT INTO workspace (id, name, owner_id) VALUES ('unassigned', 'Invalid', 'owner')`
      ).rejects.toSatisfy(constraintFailure)
      expect(await sql`SELECT 1 FROM workspace WHERE id = 'unassigned'`).toHaveLength(0)
    })
  })

  it('supports a fresh database, repeated installation, and atomic first-environment creation', async () => {
    await database(async (sql) => {
      await enforce(sql)
      await enforce(sql)
      await sql.begin(async (tx) => {
        await tx`INSERT INTO project (id, name, owner_id) VALUES ('new', 'New', 'owner')`
        await tx`INSERT INTO workspace (id, name, owner_id) VALUES ('first', 'First', 'owner')`
        await tx`INSERT INTO project_workspace (project_id, workspace_id) VALUES ('new', 'first')`
        await tx`INSERT INTO workflow VALUES ('flow', 'first', NULL)`
      })
      await expect(
        sql`INSERT INTO project (id, name, owner_id) VALUES ('empty', 'Empty', 'owner')`
      ).rejects.toSatisfy(constraintFailure)
      expect(await sql`SELECT 1 FROM project`).toHaveLength(1)
    })
  })

  it('rejects invalid archive/scope/fork changes and commits an atomic subtree disconnect', async () => {
    await database(async (sql) => {
      await seed(sql)
      await enforce(sql)
      await expect(sql`UPDATE project SET archived_at = now()`).rejects.toSatisfy(constraintFailure)
      await expect(
        sql`UPDATE workspace SET organization_id = 'org' WHERE id = 'child'`
      ).rejects.toSatisfy(constraintFailure)
      await expect(
        sql`DELETE FROM project_workspace WHERE workspace_id = 'child'`
      ).rejects.toSatisfy(constraintFailure)
      await expect(
        sql.begin(async (tx) => {
          await tx`INSERT INTO project (id, name, owner_id) VALUES ('detached', 'Detached', 'owner')`
          await tx`UPDATE project_workspace SET project_id = 'detached' WHERE workspace_id = 'child'`
        })
      ).rejects.toSatisfy(constraintFailure)
      await sql.begin(async (tx) => {
        await tx`INSERT INTO project (id, name, owner_id) VALUES ('detached', 'Detached', 'owner')`
        await tx`UPDATE project_workspace SET project_id = 'detached' WHERE workspace_id = 'child'`
        await tx`UPDATE workspace SET forked_from_workspace_id = NULL WHERE id = 'child'`
      })
      expect(await sql`SELECT DISTINCT project_id FROM project_workspace`).toHaveLength(2)
    })
  })

  it('archives all Project environments and workflows together and refuses later active workflow insertion', async () => {
    await database(async (sql) => {
      await seed(sql)
      await enforce(sql)
      await expect(
        sql.begin(async (tx) => {
          await tx`UPDATE project SET archived_at = now()`
          await tx`UPDATE workspace SET archived_at = now()`
        })
      ).rejects.toSatisfy(constraintFailure)
      await sql.begin(async (tx) => {
        await tx`UPDATE workflow SET archived_at = now()`
        await tx`UPDATE workspace SET archived_at = now()`
        await tx`UPDATE project SET archived_at = now()`
      })
      await expect(sql`INSERT INTO workflow VALUES ('late', 'child', NULL)`).rejects.toSatisfy(
        constraintFailure
      )
      await expect(
        sql`UPDATE workspace SET archived_at = NULL WHERE id = 'root'`
      ).rejects.toSatisfy(constraintFailure)
      expect(await sql`SELECT 1 FROM workspace WHERE archived_at IS NULL`).toHaveLength(0)
    })
  })

  it.each(['read committed', 'repeatable read'] as const)(
    'prevents concurrent last-environment removal under %s',
    async (isolation) => {
      await database(async (sql) => {
        await seed(sql)
        await enforce(sql)
        const archived = createDeferred<void>()
        const release = createDeferred<void>()
        const first = sql.begin(async (tx) => {
          await tx`UPDATE workspace SET archived_at = now() WHERE id = 'root'`
          archived.resolve()
          await release.promise
        })
        await archived.promise
        const started = createDeferred<void>()
        const second = sql
          .begin(`isolation level ${isolation}`, async (tx) => {
            await tx`SELECT count(*) FROM workspace WHERE archived_at IS NULL`
            started.resolve()
            await tx`UPDATE workspace SET archived_at = now() WHERE id = 'child'`
          })
          .then(
            () => null,
            (error: unknown) => error
          )
        await started.promise
        release.resolve()
        await first
        const failure = await second
        expect(['23514', '40001', '40P01']).toContain(getPostgresErrorCode(failure))
        expect(await sql`SELECT 1 FROM workspace WHERE archived_at IS NULL`).toHaveLength(1)
      })
    }
  )

  it('refuses enforcement when an archived Project retains an active workflow', async () => {
    await database(async (sql) => {
      await seed(sql)
      await sql`UPDATE workspace SET archived_at = now()`
      await sql`UPDATE project SET archived_at = now()`
      await expect(enforce(sql)).rejects.toSatisfy(
        (error: unknown) => getPostgresErrorCode(error) === '55000'
      )
      await sql`UPDATE workflow SET archived_at = now()`
      await enforce(sql)
    })
  })
})
