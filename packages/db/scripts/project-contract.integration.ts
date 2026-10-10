import { execFile } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import {
  assignProjectBackfillBatch,
  discoverProjectBackfill,
  type ProjectGroupingReview,
  projectBackfillDatabaseId,
  verifyProjectBackfill,
} from '@sim/db/maintenance/project-backfill'
import { enforceProjectMembership } from '@sim/db/maintenance/project-enforcement'
import journal from '@sim/db/migrations/meta/_journal.json'
import { runScriptMigrations, scriptMigrations } from '@sim/db/script-migrations'
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { getPostgresErrorCode } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres, { type Sql } from 'postgres'
import { describe, expect, it, vi } from 'vitest'

const migration = await readFile(
  new URL('../maintenance/project-membership.sql', import.meta.url),
  'utf8'
)

const expansion = await readFile(
  new URL('../migrations/0406_workspace_project_column.sql', import.meta.url),
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
      await readFile(new URL('../migrations/0394_project_foundation.sql', import.meta.url), 'utf8')
    )
    await applyMigration(sql, expansion)
    /** These reconciliation fixtures model the already committed column-authority phase. */
    await sql`UPDATE project_membership_rollout SET phase = 'column' WHERE id = 'membership'`
    await run(sql, url.toString())
  } finally {
    await sql.end({ timeout: 2 })
    await admin.unsafe(`DROP DATABASE "${name}" WITH (FORCE)`)
    await admin.end()
  }
}

async function applyMigration(sql: Sql, source: string) {
  const reserved = await sql.reserve()
  try {
    for (const statement of source.split('--> statement-breakpoint')) {
      await reserved.unsafe(statement)
    }
  } catch (error) {
    if (!['25P03', '25P04', 'CONNECTION_CLOSED'].includes(getPostgresErrorCode(error) ?? '')) {
      await reserved.unsafe('ROLLBACK')
    }
    throw error
  } finally {
    await reserved
      .unsafe("SELECT pg_advisory_unlock(hashtextextended('sim:project-backfill-operator',0))")
      .catch(() => undefined)
    reserved.release()
  }
}

async function prepare(sql: Sql) {
  const manifest = await discoverProjectBackfill(sql, 'fixture')
  for (const family of manifest.families) await assignProjectBackfillBatch(sql, [family])
  if (manifest.conflicts.length)
    throw Object.assign(new Error(manifest.conflicts[0].reason), {
      code: manifest.conflicts[0].reason.includes('oversized') ? '54000' : '55000',
    })
}

async function prepareAndEnforce(sql: Sql) {
  await prepare(sql)
  await applyMigration(sql, migration)
}

async function runRegisteredProjectMigration(url: string, reviews?: ProjectGroupingReview[]) {
  const previousPath = process.env.PROJECT_BACKFILL_REVIEW_PATH
  const previousUrl = process.env.MIGRATION_DATABASE_URL
  const directory = reviews ? await mkdtemp(join(tmpdir(), 'project-review-')) : null
  if (directory) {
    process.env.PROJECT_BACKFILL_REVIEW_PATH = join(directory, 'manifest.json')
    process.env.MIGRATION_DATABASE_URL = url
    await writeFile(
      process.env.PROJECT_BACKFILL_REVIEW_PATH,
      JSON.stringify({ version: 1, databaseId: projectBackfillDatabaseId(url), groupings: reviews })
    )
  }
  const runner = postgres(url, { max: 1, onnotice: () => undefined, max_lifetime: null })
  try {
    await runScriptMigrations(
      runner,
      scriptMigrations.filter((item) => item.name === '0031_project_membership')
    )
  } finally {
    await runner.end({ timeout: 2 })
    vi.stubEnv('PROJECT_BACKFILL_REVIEW_PATH', previousPath)
    vi.stubEnv('MIGRATION_DATABASE_URL', previousUrl)
    if (directory) await rm(directory, { recursive: true, force: true })
  }
}

async function seed(sql: Sql) {
  await sql`INSERT INTO workspace (id, name, owner_id) VALUES ('root', 'Production', 'owner')`
  await sql`INSERT INTO workspace (id, name, owner_id, forked_from_workspace_id) VALUES ('child', 'Staging', 'owner', 'root')`
  await sql`INSERT INTO workflow VALUES ('flow', 'root', NULL)`
  await prepareAndEnforce(sql)
}

const constraintFailure = (error: unknown) => getPostgresErrorCode(error) === '23503'

describe('Project expand/backfill/contract against PostgreSQL', () => {
  it('repairs fully assigned stale Project archive and scope without restoring environments or workflows', async () => {
    await database(async (sql, url) => {
      await sql`INSERT INTO project (id,name,owner_id,archived_at) VALUES
        ('stale','Keep identity','owner','2026-01-01'), ('archived','Keep archive','owner',NULL)`
      await sql`INSERT INTO workspace (id,name,owner_id,organization_id,project_id,archived_at) VALUES
        ('root','Root','owner','org','stale','2026-01-01'),
        ('old','Old','owner',NULL,'archived','2026-01-02')`
      await sql`INSERT INTO workspace (id,name,owner_id,organization_id,project_id,forked_from_workspace_id)
        VALUES ('child','Child','owner','org','stale','root')`
      await sql`INSERT INTO workflow VALUES ('old-flow','root','2026-01-01'), ('live-flow','child',NULL)`
      const before = await sql`SELECT id,archived_at FROM workspace ORDER BY id`
      const workflows = await sql`SELECT * FROM workflow ORDER BY id`
      await runRegisteredProjectMigration(url)
      expect(
        await sql`SELECT id,name,organization_id,archived_at::text FROM project ORDER BY id`
      ).toEqual([
        {
          id: 'archived',
          name: 'Keep archive',
          organization_id: null,
          archived_at: '2026-01-02 00:00:00',
        },
        { id: 'stale', name: 'Keep identity', organization_id: 'org', archived_at: null },
      ])
      expect(await sql`SELECT id,archived_at FROM workspace ORDER BY id`).toEqual(before)
      expect(await sql`SELECT * FROM workflow ORDER BY id`).toEqual(workflows)
      expect(Object.values(await verifyProjectBackfill(sql)).every((count) => count === 0)).toBe(
        true
      )
    })
  })

  it('reports fully assigned mixed-scope and personal-owner conflicts without changing ownership', async () => {
    await database(async (sql) => {
      await sql`INSERT INTO "user" VALUES ('other')`
      await sql`INSERT INTO project (id,name,owner_id) VALUES ('shared','Shared','owner')`
      await sql`INSERT INTO workspace (id,name,owner_id,project_id) VALUES ('root','Root','owner','shared')`
      await sql`INSERT INTO workspace (id,name,owner_id,project_id,forked_from_workspace_id)
        VALUES ('child','Child','other','shared','root')`
      expect((await discoverProjectBackfill(sql, 'fixture')).conflicts).toEqual([
        { id: 'root', reason: expect.stringContaining('owners') },
      ])
      await sql`UPDATE workspace SET organization_id = 'org' WHERE id = 'child'`
      expect((await discoverProjectBackfill(sql, 'fixture')).conflicts).toEqual([
        { id: 'root', reason: expect.stringContaining('organizations') },
      ])
      expect(await sql`SELECT owner_id FROM project`).toEqual([{ owner_id: 'owner' }])
    })
  })

  it('reports unproven multi-root grouping and accepts an exact reviewed retention decision', async () => {
    await database(async (sql, url) => {
      await sql`INSERT INTO project (id,name,owner_id) VALUES ('shared','Keep context','owner')`
      await sql`INSERT INTO workspace (id,name,owner_id,project_id) VALUES
        ('root','Root','owner','shared'), ('detached','Detached','owner','shared')`
      expect((await discoverProjectBackfill(sql, 'fixture')).conflicts).toContainEqual({
        id: 'shared',
        reason: expect.stringContaining('grouping'),
      })
      await expect(runRegisteredProjectMigration(url)).rejects.toThrow('conflicts')
      expect(await sql`SELECT id,project_id FROM workspace ORDER BY id`).toEqual([
        { id: 'detached', project_id: 'shared' },
        { id: 'root', project_id: 'shared' },
      ])
      const reviews = (await discoverProjectBackfill(sql, 'fixture')).groupings.map((group) => ({
        ...group,
        decision: 'retain' as const,
      }))
      await runRegisteredProjectMigration(url, reviews)
      expect(await sql`SELECT id,name FROM project`).toEqual([
        { id: 'shared', name: 'Keep context' },
      ])
    })
  })

  it.each(['root', 'unassigned-child'])(
    'rediscoveries Project-wide evidence after a %s changes during repair planning',
    async (changed) => {
      await database(async (sql) => {
        await sql`INSERT INTO project (id,name,owner_id,archived_at) VALUES ('shared','Shared','owner','2026-01-01')`
        await sql`INSERT INTO workspace (id,name,owner_id,project_id) VALUES ('a','A','owner','shared'),('b','B','owner','shared')`
        await sql`INSERT INTO project_workspace (project_id,workspace_id) VALUES ('shared','a'),('shared','b')`
        await sql`INSERT INTO workspace (id,name,owner_id,forked_from_workspace_id) VALUES ('c','Pending child','owner','b')`
        const manifest = await discoverProjectBackfill(sql, 'fixture')
        await sql`UPDATE workspace SET archived_at = '2026-01-02' WHERE id = ${changed === 'root' ? 'b' : 'c'}`
        await expect(assignProjectBackfillBatch(sql, [manifest.families[0]])).rejects.toThrow(
          'rediscover'
        )
        expect(await sql`SELECT archived_at IS NOT NULL AS archived FROM project`).toEqual([
          { archived: true },
        ])
        await prepareAndEnforce(sql)
        expect(await sql`SELECT archived_at FROM project`).toEqual([{ archived_at: null }])
      })
    }
  )

  it.each([false, true])(
    'replays a reviewed partial family after commit while preserving legitimate shared roots (shared=%s)',
    async (shared) => {
      await database(async (sql) => {
        await sql`INSERT INTO project(id,name,owner_id) VALUES ('existing','Keep context','owner')`
        await sql`INSERT INTO workspace(id,name,owner_id) VALUES ('root','Root','owner')`
        await sql`INSERT INTO workspace(id,name,owner_id,forked_from_workspace_id) VALUES ('child','Child','owner','root')`
        await sql`INSERT INTO project_workspace(project_id,workspace_id) VALUES ('existing','root')`
        if (shared) {
          await sql`INSERT INTO workspace(id,name,owner_id,project_id) VALUES ('other-root','Other','owner','existing')`
          await sql`INSERT INTO project_workspace(project_id,workspace_id) VALUES ('existing','other-root')`
          await sql`INSERT INTO workspace(id,name,owner_id,forked_from_workspace_id) VALUES ('other-child','Other child','owner','other-root')`
        }
        const manifest = await discoverProjectBackfill(sql, 'fixture')
        const family = manifest.families.find((item) => item.rootId === 'root')
        if (!family) throw new Error('Missing partial family')
        expect(await assignProjectBackfillBatch(sql, [family])).toMatchObject({
          assigned: 2,
          projectsCreated: 0,
        })
        expect(await assignProjectBackfillBatch(sql, [family])).toMatchObject({
          assigned: 0,
          alreadyAssigned: 2,
          projectsCreated: 0,
        })
        if (shared) {
          const other = manifest.families.find((item) => item.rootId === 'other-root')
          if (!other) throw new Error('Missing other partial family')
          expect(await assignProjectBackfillBatch(sql, [other])).toMatchObject({
            assigned: 1,
            projectsCreated: 0,
          })
          expect(await assignProjectBackfillBatch(sql, [other])).toMatchObject({
            assigned: 0,
            alreadyAssigned: 2,
            projectsCreated: 0,
          })
        }
        expect(await sql`SELECT id,name FROM project`).toEqual([
          { id: 'existing', name: 'Keep context' },
        ])
        expect(
          await sql`SELECT id FROM workspace WHERE project_id IS DISTINCT FROM 'existing'`
        ).toHaveLength(0)
      })
    }
  )

  it('runs registered assignment before enforcement for forks, singletons and archived families', async () => {
    await database(async (sql, url) => {
      await sql`INSERT INTO workspace (id,name,owner_id,archived_at) VALUES
        ('root','Root','owner',NULL), ('single','Single','owner',NULL),
        ('archived','Archived','owner','2026-01-01')`
      await sql`INSERT INTO workspace (id,name,owner_id,forked_from_workspace_id)
        VALUES ('child','Child','owner','root')`
      await runRegisteredProjectMigration(url)
      expect(await sql`SELECT id FROM workspace WHERE project_id IS NULL`).toHaveLength(0)
      expect(await sql`SELECT id FROM project`).toHaveLength(3)
      expect(
        await sql`SELECT DISTINCT project_id FROM workspace WHERE id IN ('root','child')`
      ).toHaveLength(1)
      expect(await sql`SELECT id FROM project WHERE archived_at IS NOT NULL`).toHaveLength(1)
      expect(await sql`SELECT to_regclass('project_workspace')::text AS connector`).toEqual([
        { connector: null },
      ])
      expect(await sql`SELECT to_regclass('public.project_membership_rollout') AS marker`).toEqual([
        { marker: null },
      ])
      const assignments = await sql`SELECT id,project_id FROM workspace ORDER BY id`
      await runRegisteredProjectMigration(url)
      expect(await sql`SELECT id,project_id FROM workspace ORDER BY id`).toEqual(assignments)
      await expect(
        sql`INSERT INTO workspace (id,name,owner_id) VALUES ('bad','Bad','owner')`
      ).rejects.toSatisfy((error: unknown) => getPostgresErrorCode(error) === '23502')
    })
  })

  it('preserves legacy Project identity through a mixed fork family and a detached column assignment', async () => {
    await database(async (sql, url) => {
      await sql`INSERT INTO project (id,name,owner_id) VALUES
        ('original','Keep original context','owner'), ('detached','Keep detached context','owner')`
      await sql`INSERT INTO workspace (id,name,owner_id,project_id,forked_from_workspace_id) VALUES
        ('root','Root','owner',NULL,NULL), ('child','Child','owner','original','root'),
        ('unassigned','Unassigned','owner',NULL,'child'),
        ('detached','Detached','owner','detached',NULL)`
      await sql`INSERT INTO project_workspace (project_id,workspace_id) VALUES
        ('original','root'), ('original','detached')`
      await sql`INSERT INTO workflow VALUES ('flow','root',NULL)`
      await runRegisteredProjectMigration(url)
      expect(await sql`SELECT id,name FROM project ORDER BY id`).toEqual([
        { id: 'detached', name: 'Keep detached context' },
        { id: 'original', name: 'Keep original context' },
      ])
      expect(await sql`SELECT id,project_id FROM workspace ORDER BY id`).toEqual([
        { id: 'child', project_id: 'original' },
        { id: 'detached', project_id: 'detached' },
        { id: 'root', project_id: 'original' },
        { id: 'unassigned', project_id: 'original' },
      ])
      expect(await sql`SELECT id,workspace_id FROM workflow`).toEqual([
        { id: 'flow', workspace_id: 'root' },
      ])
      expect(await sql`SELECT to_regclass('project_workspace')::text AS connector`).toEqual([
        { connector: null },
      ])
      expect(await sql`SELECT name FROM script_migrations`).toEqual([
        { name: '0031_project_membership' },
      ])
    })
  })

  it('copies exact legacy memberships across independent roots without changing Project lifecycle or the connector', async () => {
    await database(async (sql) => {
      await sql`INSERT INTO project (id,name,owner_id) VALUES ('existing','Existing','owner')`
      await sql`INSERT INTO workspace (id,name,owner_id,archived_at) VALUES
        ('a-archived','Archived','owner','2026-01-01'), ('b-active','Active','owner',NULL)`
      await sql`INSERT INTO project_workspace (project_id,workspace_id) VALUES
        ('existing','a-archived'), ('existing','b-active')`
      const before =
        await sql`SELECT project_id,workspace_id FROM project_workspace ORDER BY workspace_id`
      const manifest = await discoverProjectBackfill(sql, 'fixture')
      for (const family of manifest.families) {
        expect(await assignProjectBackfillBatch(sql, [family])).toMatchObject({
          assigned: 1,
          projectsCreated: 0,
        })
      }
      expect(await sql`SELECT id,project_id FROM workspace ORDER BY id`).toEqual([
        { id: 'a-archived', project_id: 'existing' },
        { id: 'b-active', project_id: 'existing' },
      ])
      expect(await sql`SELECT id,archived_at FROM project`).toEqual([
        { id: 'existing', archived_at: null },
      ])
      expect(
        await sql`SELECT project_id,workspace_id FROM project_workspace ORDER BY workspace_id`
      ).toEqual(before)
      await prepareAndEnforce(sql)
    })
  })

  it('rejects changed legacy assignment evidence before writing and accepts a fresh review', async () => {
    await database(async (sql) => {
      await sql`INSERT INTO project (id,name,owner_id) VALUES ('first','First','owner'),('second','Second','owner')`
      await sql`INSERT INTO workspace (id,name,owner_id) VALUES ('root','Root','owner')`
      await sql`INSERT INTO project_workspace (project_id,workspace_id) VALUES ('first','root')`
      const manifest = await discoverProjectBackfill(sql, 'fixture')
      await sql`UPDATE project_workspace SET project_id = 'second' WHERE workspace_id = 'root'`
      await expect(assignProjectBackfillBatch(sql, manifest.families)).rejects.toThrow('changed')
      expect(await sql`SELECT project_id FROM workspace`).toEqual([{ project_id: null }])
      expect(await sql`SELECT id FROM project ORDER BY id`).toEqual([
        { id: 'first' },
        { id: 'second' },
      ])
      const reviewed = await discoverProjectBackfill(sql, 'fixture')
      expect(await assignProjectBackfillBatch(sql, reviewed.families)).toMatchObject({
        assigned: 1,
        projectsCreated: 0,
      })
      expect(await sql`SELECT project_id FROM workspace`).toEqual([{ project_id: 'second' }])
    })
  })

  it('releases a batch promptly when its legacy assignment row is being changed', async () => {
    await database(async (sql) => {
      await sql`INSERT INTO project (id,name,owner_id) VALUES ('first','First','owner'),('second','Second','owner')`
      await sql`INSERT INTO workspace (id,name,owner_id) VALUES ('root','Root','owner')`
      await sql`INSERT INTO project_workspace (project_id,workspace_id) VALUES ('first','root')`
      const manifest = await discoverProjectBackfill(sql, 'fixture')
      await sql.begin(async (tx) => {
        await tx`UPDATE project_workspace SET project_id = 'second' WHERE workspace_id = 'root'`
        await expect(assignProjectBackfillBatch(sql, manifest.families)).rejects.toSatisfy(
          (error: unknown) => getPostgresErrorCode(error) === '55P03'
        )
        await tx`SET LOCAL lock_timeout = '100ms'`
        await tx`UPDATE workspace SET name = 'Still editable' WHERE id = 'root'`
        expect(await tx`SELECT project_id FROM workspace`).toEqual([{ project_id: null }])
      })
      await expect(assignProjectBackfillBatch(sql, manifest.families)).rejects.toThrow('changed')
      const reviewed = await discoverProjectBackfill(sql, 'fixture')
      expect(await assignProjectBackfillBatch(sql, reviewed.families)).toMatchObject({
        assigned: 1,
        projectsCreated: 0,
      })
      expect(await sql`SELECT project_id FROM workspace`).toEqual([{ project_id: 'second' }])
    })
  })

  it('defers a legacy Project mutation without blocking unrelated assignment', async () => {
    await database(async (sql) => {
      await sql`INSERT INTO project (id,name,owner_id) VALUES ('legacy','Legacy','owner')`
      await sql`INSERT INTO workspace (id,name,owner_id) VALUES ('a-legacy','Legacy','owner'),('b-free','Free','owner')`
      await sql`INSERT INTO project_workspace (project_id,workspace_id) VALUES ('legacy','a-legacy')`
      const manifest = await discoverProjectBackfill(sql, 'fixture')
      await sql.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(hashtextextended('project:legacy',0))`
        await expect(assignProjectBackfillBatch(sql, [manifest.families[0]])).rejects.toThrow(
          'busy'
        )
        expect(await assignProjectBackfillBatch(sql, [manifest.families[1]])).toMatchObject({
          assigned: 1,
        })
        expect(await sql`SELECT project_id FROM workspace WHERE id = 'a-legacy'`).toEqual([
          { project_id: null },
        ])
      })
      expect(await assignProjectBackfillBatch(sql, [manifest.families[0]])).toMatchObject({
        assigned: 1,
        projectsCreated: 0,
      })
    })
  })

  it('retries the registered backfill after a failed batch without repeating committed assignments', async () => {
    await database(async (sql, url) => {
      await sql`INSERT INTO workspace (id,name,owner_id) SELECT lpad(n::text,3,'0'), 'Env ' || n,'owner' FROM generate_series(1,101) n`
      await sql.unsafe(`CREATE FUNCTION reject_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.name = 'Env 75 - Project' THEN RAISE EXCEPTION 'fixture failure'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER reject_fixture BEFORE INSERT ON project FOR EACH ROW EXECUTE FUNCTION reject_fixture();`)
      await expect(runRegisteredProjectMigration(url)).rejects.toThrow('fixture failure')
      const assignments =
        await sql`SELECT id,project_id FROM workspace WHERE project_id IS NOT NULL ORDER BY id`
      expect(assignments).toHaveLength(50)
      expect(await sql`SELECT name FROM script_migrations`).toHaveLength(0)
      expect(await sql`SELECT to_regclass('project_workspace')::text AS connector`).toEqual([
        { connector: 'project_workspace' },
      ])
      await sql`DROP TRIGGER reject_fixture ON project`
      await runRegisteredProjectMigration(url)
      expect(
        await sql`SELECT id,project_id FROM workspace WHERE id = ANY(${assignments.map((row) => row.id)}) ORDER BY id`
      ).toEqual(assignments)
      expect(await sql`SELECT id FROM project`).toHaveLength(101)
      expect(await sql`SELECT name FROM script_migrations`).toEqual([
        { name: '0031_project_membership' },
      ])
    })
  })

  it('commits unrelated assignments while a family stays busy and resumes before enforcement', async () => {
    await database(async (sql, url) => {
      await sql`INSERT INTO workspace (id,name,owner_id) VALUES ('a-busy','Busy','owner'),('b-free','Free','owner')`
      await sql.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock_shared(hashtextextended('project-backfill:a-busy',0))`
        await expect(runRegisteredProjectMigration(url)).rejects.toThrow('backfill incomplete')
        expect(await sql`SELECT id FROM workspace WHERE project_id IS NOT NULL`).toEqual([
          { id: 'b-free' },
        ])
        expect(await sql`SELECT name FROM script_migrations`).toHaveLength(0)
        expect(await sql`SELECT to_regclass('project_workspace')::text AS connector`).toEqual([
          { connector: 'project_workspace' },
        ])
      })
      await runRegisteredProjectMigration(url)
      expect(await sql`SELECT id FROM project`).toHaveLength(2)
      expect(await sql`SELECT id FROM workspace WHERE project_id IS NULL`).toHaveLength(0)
    })
  })

  it.each(['archive', 'ownership'] as const)(
    'stops the registered migration for unresolved %s before installing enforcement',
    async (scenario) => {
      await database(async (sql, url) => {
        await sql`INSERT INTO workspace (id,name,owner_id) VALUES ('root','Root','owner')`
        if (scenario === 'archive') {
          await sql`UPDATE workspace SET archived_at = now()`
          await sql`INSERT INTO workflow VALUES ('flow','root',NULL)`
        } else {
          await sql`INSERT INTO "user" VALUES ('other')`
          await sql`INSERT INTO workspace (id,name,owner_id,forked_from_workspace_id) VALUES ('child','Child','other','root')`
        }
        await expect(runRegisteredProjectMigration(url)).rejects.toThrow(
          'Resolve Project conflicts'
        )
        expect(await sql`SELECT id FROM project`).toHaveLength(0)
        expect(await sql`SELECT name FROM script_migrations`).toHaveLength(0)
        expect(await sql`SELECT to_regclass('project_workspace')::text AS connector`).toEqual([
          { connector: 'project_workspace' },
        ])
        if (scenario === 'archive') await sql`UPDATE workflow SET archived_at = now()`
        else await sql`UPDATE workspace SET owner_id = 'owner' WHERE id = 'child'`
        await runRegisteredProjectMigration(url)
        expect(await sql`SELECT id FROM project`).toHaveLength(1)
      })
    }
  )

  it('enforces public membership across a shadow search path and restores the caller path', async () => {
    await database(async (sql, url) => {
      await sql`INSERT INTO project (id,name,owner_id) VALUES ('retained','Retained','owner')`
      await sql`CREATE SCHEMA shadow`
      await sql`CREATE TABLE shadow.project (LIKE public.project INCLUDING ALL)`
      await sql`CREATE TABLE shadow.workspace (LIKE public.workspace INCLUDING ALL)`
      await sql`CREATE TABLE shadow.workflow (LIKE public.workflow INCLUDING ALL)`
      await sql`CREATE TABLE shadow.project_workspace (project_id text, workspace_id text)`
      await sql`INSERT INTO shadow.workspace (id,name,owner_id) VALUES ('shadow','Untouched','owner')`
      const scoped = postgres(url, {
        max: 1,
        connection: { search_path: 'shadow,public' },
        onnotice: () => {},
      })
      try {
        await expect(enforceProjectMembership(scoped)).rejects.toThrow('nonempty Projects')
        expect(await scoped`SHOW search_path`).toEqual([{ search_path: 'shadow,public' }])
        await sql`INSERT INTO workspace (id,name,owner_id,project_id) VALUES ('env','Environment','owner','retained')`
        await enforceProjectMembership(scoped)
        expect(await scoped`SHOW search_path`).toEqual([{ search_path: 'shadow,public' }])
        expect(await sql`SELECT to_regclass('public.project_workspace') AS connector`).toEqual([
          { connector: null },
        ])
        expect(
          await sql`SELECT attnotnull FROM pg_attribute WHERE attrelid = 'public.workspace'::regclass AND attname = 'project_id'`
        ).toEqual([{ attnotnull: true }])
        expect(
          await sql`SELECT count(*)::int AS count FROM pg_trigger WHERE tgrelid IN ('public.workspace'::regclass,'public.project'::regclass) AND NOT tgisinternal`
        ).toEqual([{ count: 0 }])
        expect(await scoped`SELECT id,project_id FROM workspace`).toEqual([
          { id: 'shadow', project_id: null },
        ])
        expect(
          await sql`SELECT to_regclass('shadow.project_workspace') IS NOT NULL AS retained`
        ).toEqual([{ retained: true }])
        expect(
          await sql`SELECT attnotnull FROM pg_attribute WHERE attrelid = 'shadow.workspace'::regclass AND attname = 'project_id'`
        ).toEqual([{ attnotnull: false }])
        expect(
          await sql`SELECT count(*)::int AS count FROM pg_trigger WHERE tgrelid IN ('shadow.workspace'::regclass,'shadow.project'::regclass) AND NOT tgisinternal`
        ).toEqual([{ count: 0 }])
        await scoped`UPDATE public.workspace SET name = 'Updated' WHERE id = 'env'`
        await expect(
          scoped`UPDATE public.workspace SET organization_id = 'org' WHERE id = 'env'`
        ).rejects.toMatchObject({ code: '23503' })
        expect(await sql`SELECT name,archived_at FROM public.workspace`).toEqual([
          { name: 'Updated', archived_at: null },
        ])
      } finally {
        await scoped.end({ timeout: 2 })
      }
    })
  })

  it('requires completed assignments before final enforcement and leaves missing assignments untouched', async () => {
    await database(async (sql) => {
      await sql`INSERT INTO workspace (id,name,owner_id) VALUES ('legacy','Legacy','owner')`
      await expect(applyMigration(sql, migration)).rejects.toThrow('preparation is incomplete')
      expect(await sql`SELECT id FROM project`).toHaveLength(0)
      expect(await sql`SELECT id FROM workspace WHERE project_id IS NULL`).toHaveLength(1)
      await prepareAndEnforce(sql)
      expect(Object.values(await verifyProjectBackfill(sql)).every((count) => count === 0)).toBe(
        true
      )
    })
  })

  it('rolls back an entire singleton batch on failure without losing earlier commits', async () => {
    await database(async (sql) => {
      await sql`INSERT INTO workspace (id,name,owner_id) SELECT lpad(n::text,3,'0'), 'Env ' || n,'owner' FROM generate_series(1,101) n`
      const manifest = await discoverProjectBackfill(sql, 'fixture')
      expect(await assignProjectBackfillBatch(sql, manifest.families.slice(0, 50))).toMatchObject({
        assigned: 50,
        projectsCreated: 50,
      })
      await sql.unsafe(`CREATE FUNCTION reject_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.name = 'Env 75 - Project' THEN RAISE EXCEPTION 'fixture failure'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER reject_fixture BEFORE INSERT ON project FOR EACH ROW EXECUTE FUNCTION reject_fixture();`)
      await expect(
        assignProjectBackfillBatch(sql, manifest.families.slice(50, 100))
      ).rejects.toThrow('fixture failure')
      expect(await sql`SELECT id FROM project`).toHaveLength(50)
      expect(await sql`SELECT id FROM workspace WHERE project_id IS NULL`).toHaveLength(51)
      await sql`DROP TRIGGER reject_fixture ON project`
      expect(await assignProjectBackfillBatch(sql, manifest.families.slice(50, 100))).toMatchObject(
        { assigned: 50 }
      )
      expect(await assignProjectBackfillBatch(sql, manifest.families.slice(0, 50))).toMatchObject({
        assigned: 0,
        alreadyAssigned: 50,
        projectsCreated: 0,
      })
      expect(await sql`SELECT id FROM project`).toHaveLength(100)
    })
  })

  it('rejects a stale owner or archive plan without writing and reports archive repairs during discovery', async () => {
    await database(async (sql) => {
      await sql`INSERT INTO workspace (id,name,owner_id) VALUES ('root','Root','owner')`
      const manifest = await discoverProjectBackfill(sql, 'fixture')
      await sql`INSERT INTO "user" VALUES ('next-owner')`
      await sql`UPDATE workspace SET owner_id = 'next-owner'`
      await expect(assignProjectBackfillBatch(sql, manifest.families)).rejects.toThrow('changed')
      expect(await sql`SELECT id FROM project`).toHaveLength(0)
      await sql`UPDATE workspace SET owner_id = 'owner', archived_at = now()`
      await sql`INSERT INTO workflow VALUES ('flow','root',NULL)`
      await expect(assignProjectBackfillBatch(sql, manifest.families)).rejects.toThrow('changed')
      const next = await discoverProjectBackfill(sql, 'fixture')
      expect(next.repairs).toMatchObject([{ workspaceId: 'root', workflowIds: ['flow'] }])
      await expect(assignProjectBackfillBatch(sql, next.families)).rejects.toThrow('Archive repair')
      expect(await sql`SELECT id FROM project`).toHaveLength(0)
    })
  })

  it('keeps operator discovery, assignment and verification on public under a shadow URL search path', async () => {
    await database(async (sql, url) => {
      const directory = await mkdtemp(join(tmpdir(), 'project-operator-shadow-'))
      const manifest = join(directory, 'manifest.json')
      const report = join(directory, 'report.json')
      const scopedUrl = new URL(url)
      scopedUrl.searchParams.set('search_path', 'shadow,public')
      const run = (command: string) =>
        promisify(execFile)(
          'bun',
          [
            '--no-env-file',
            'scripts/backfill-projects.ts',
            command,
            '--manifest',
            manifest,
            ...(command === 'plan'
              ? []
              : ['--report', report, '--ack-release-drained', '--pause-ms', '1']),
          ],
          {
            cwd: new URL('../../../apps/sim/', import.meta.url),
            env: { ...process.env, MIGRATION_DATABASE_URL: scopedUrl.toString() },
            timeout: 30000,
          }
        )
      try {
        await sql`INSERT INTO workspace (id,name,owner_id) VALUES ('public-env','Public','owner')`
        await sql`CREATE SCHEMA shadow`
        for (const name of [
          'workspace',
          'project',
          'workflow',
          'user',
          'organization',
          'project_workspace',
        ]) {
          await sql`CREATE TABLE ${sql(`shadow.${name}`)} (LIKE ${sql(`public.${name}`)} INCLUDING ALL)`
        }
        await sql`INSERT INTO shadow.workspace (id,name,owner_id) VALUES ('shadow-env','Untouched','owner')`
        await run('plan')
        const plan = JSON.parse(await readFile(manifest, 'utf8'))
        expect(plan.families.map((family: { rootId: string }) => family.rootId)).toEqual([
          'public-env',
        ])
        await run('apply')
        expect(await sql`SELECT id,project_id FROM public.workspace`).toEqual([
          { id: 'public-env', project_id: expect.any(String) },
        ])
        expect(await sql`SELECT count(*)::int AS count FROM public.project`).toEqual([{ count: 1 }])
        await run('verify')
        expect(await sql`SELECT id,project_id FROM shadow.workspace`).toEqual([
          { id: 'shadow-env', project_id: null },
        ])
        expect(await sql`SELECT count(*)::int AS count FROM shadow.project`).toEqual([{ count: 0 }])
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    })
  })

  it('runs the real operator CLI read-only, resumes bounded batches and survives a lost checkpoint', async () => {
    await database(async (sql, url) => {
      const directory = await mkdtemp(join(tmpdir(), 'project-operator-test-'))
      const manifestPath = join(directory, 'manifest.json')
      const reportPath = join(directory, 'report.json')
      const run = (command: string, extra: string[] = []) =>
        promisify(execFile)(
          'bun',
          [
            '--no-env-file',
            'scripts/backfill-projects.ts',
            command,
            '--manifest',
            manifestPath,
            ...(command === 'plan' ? [] : ['--report', reportPath]),
            ...extra,
          ],
          {
            cwd: new URL('../../../apps/sim/', import.meta.url),
            env: { ...process.env, MIGRATION_DATABASE_URL: url, DATABASE_URL: url },
            timeout: 30000,
          }
        )
      try {
        await sql`INSERT INTO workspace (id,name,owner_id) SELECT lpad(n::text,3,'0'),'Env ' || n,'owner' FROM generate_series(1,101) n`
        await run('plan')
        const reviewed = await readFile(manifestPath, 'utf8')
        await expect(run('plan')).rejects.toMatchObject({ code: 1 })
        expect(await readFile(manifestPath, 'utf8')).toBe(reviewed)
        expect(await sql`SELECT id FROM project`).toHaveLength(0)
        await expect(run('apply')).rejects.toMatchObject({ code: 1 })
        await expect(
          run('apply', ['--ack-release-drained', '--max-batches', '1', '--pause-ms', '1'])
        ).rejects.toMatchObject({ code: 2 })
        const report = JSON.parse(await readFile(reportPath, 'utf8'))
        expect(report).toMatchObject({
          nextIndex: 50,
          assigned: 50,
          projectsCreated: 50,
          status: 'paused',
        })
        const mismatched = JSON.stringify({ ...report, codeHash: 'another-checkout' })
        await writeFile(reportPath, mismatched)
        await expect(run('apply', ['--ack-release-drained'])).rejects.toMatchObject({
          code: 1,
          stderr: expect.stringContaining('Report belongs to different backfill code'),
        })
        expect(await readFile(reportPath, 'utf8')).toBe(mismatched)
        expect(await sql`SELECT id FROM project`).toHaveLength(50)
        expect(await sql`SELECT id FROM workspace WHERE project_id IS NOT NULL`).toHaveLength(50)
        await writeFile(reportPath, JSON.stringify(report))
        for (const [status, exitCode] of [
          ['running', 2],
          ['paused', 2],
          ['incomplete', 2],
          ['failed', 1],
          ['complete', 0],
        ] as const) {
          const checkpoint = JSON.stringify({ ...report, status })
          await writeFile(reportPath, checkpoint)
          const statusRun = run('status')
          if (exitCode === 0) await statusRun
          else await expect(statusRun).rejects.toMatchObject({ code: exitCode })
          expect(await readFile(reportPath, 'utf8')).toBe(checkpoint)
        }
        const first =
          await sql`SELECT id,project_id FROM workspace WHERE project_id IS NOT NULL ORDER BY id`
        await rm(reportPath)
        const child = execFile(
          'bun',
          [
            '--no-env-file',
            'scripts/backfill-projects.ts',
            'apply',
            '--manifest',
            manifestPath,
            '--report',
            reportPath,
            '--ack-release-drained',
            '--pause-ms',
            '1000',
          ],
          {
            cwd: new URL('../../../apps/sim/', import.meta.url),
            env: { ...process.env, MIGRATION_DATABASE_URL: url, DATABASE_URL: url },
            timeout: 15000,
          }
        )
        const exited = once(child, 'close')
        try {
          let checkpointed = false
          for (let attempt = 0; attempt < 200; attempt++) {
            const text = await readFile(reportPath, 'utf8').catch(() => '{}')
            if (JSON.parse(text).nextIndex === 50) {
              checkpointed = true
              break
            }
            await sleep(25)
          }
          expect(checkpointed).toBe(true)
          await expect(run('apply', ['--ack-release-drained'])).rejects.toMatchObject({ code: 1 })
          child.kill('SIGTERM')
          expect((await exited)[0]).toBe(2)
          expect(JSON.parse(await readFile(reportPath, 'utf8'))).toMatchObject({
            status: 'paused',
            nextIndex: 50,
            assigned: 0,
            alreadyAssigned: 50,
          })
          expect(await sql`SELECT id FROM project`).toHaveLength(50)
        } finally {
          if (child.exitCode === null) child.kill('SIGKILL')
          await exited
        }
        await rm(reportPath)
        await run('apply', ['--ack-release-drained', '--max-batches', '4', '--pause-ms', '1'])
        expect(
          await sql`SELECT id,project_id FROM workspace WHERE id = ANY(${first.map((row) => row.id)}) ORDER BY id`
        ).toEqual(first)
        expect(await sql`SELECT id FROM project`).toHaveLength(101)
        await run('verify')
        for (const artifacts of [[], ['--manifest', manifestPath], ['--report', reportPath]]) {
          await expect(
            promisify(execFile)(
              'bun',
              ['--no-env-file', 'scripts/backfill-projects.ts', 'verify', ...artifacts],
              {
                cwd: new URL('../../../apps/sim/', import.meta.url),
                env: { ...process.env, MIGRATION_DATABASE_URL: url, DATABASE_URL: url },
                timeout: 30000,
              }
            )
          ).rejects.toMatchObject({ code: 1 })
        }
        const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
        manifest.databaseId = projectBackfillDatabaseId('postgres://localhost/wrong_test')
        await writeFile(manifestPath, JSON.stringify(manifest))
        await expect(run('apply', ['--ack-release-drained'])).rejects.toMatchObject({ code: 1 })
        await applyMigration(sql, migration)
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    })
  }, 60000)

  it('refuses a conflicted manifest even after its database invariants have been repaired', async () => {
    await database(async (sql, url) => {
      const directory = await mkdtemp(join(tmpdir(), 'project-conflict-verify-test-'))
      const run = (command: string, plan: string) =>
        promisify(execFile)(
          'bun',
          [
            '--no-env-file',
            'scripts/backfill-projects.ts',
            command,
            '--manifest',
            join(directory, `${plan}-manifest.json`),
            '--report',
            join(directory, `${plan}-report.json`),
            '--ack-release-drained',
          ],
          {
            cwd: new URL('../../../apps/sim/', import.meta.url),
            env: { ...process.env, MIGRATION_DATABASE_URL: url },
            timeout: 15000,
          }
        )
      try {
        await sql`INSERT INTO "user" VALUES ('other-owner')`
        await sql`INSERT INTO workspace (id,name,owner_id) VALUES ('root','Root','owner')`
        await sql`INSERT INTO workspace (id,name,owner_id,forked_from_workspace_id)
          VALUES ('child','Child','other-owner','root')`
        await expect(run('plan', 'conflicted')).rejects.toMatchObject({ code: 2 })
        await expect(run('apply', 'conflicted')).rejects.toMatchObject({ code: 2 })
        await sql`UPDATE workspace SET owner_id = 'owner' WHERE id = 'child'`
        await run('plan', 'repaired')
        await run('apply', 'repaired')
        expect(Object.values(await verifyProjectBackfill(sql)).every((count) => count === 0)).toBe(
          true
        )
        await run('verify', 'repaired')
        await expect(run('verify', 'conflicted')).rejects.toMatchObject({ code: 2 })
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    })
  }, 30000)

  it.each([
    ['plan', 'SIGINT'],
    ['verify', 'SIGTERM'],
  ] as const)(
    'coordinates a stalled %s scan with enforcement and terminates on %s',
    async (command, signal) => {
      await database(async (sql, url) => {
        const directory = await mkdtemp(join(tmpdir(), 'project-read-cancel-test-'))
        const artifacts = [
          '--manifest',
          join(directory, 'manifest.json'),
          '--report',
          join(directory, 'report.json'),
        ]
        const options = {
          cwd: new URL('../../../apps/sim/', import.meta.url),
          env: { ...process.env, MIGRATION_DATABASE_URL: url },
          timeout: 15000,
        }
        await sql`INSERT INTO workspace (id,name,owner_id) VALUES ('root','Root','owner')`
        if (command === 'verify') {
          for (const step of ['plan', 'apply'])
            await promisify(execFile)(
              'bun',
              [
                '--no-env-file',
                'scripts/backfill-projects.ts',
                step,
                ...artifacts,
                '--ack-release-drained',
              ],
              options
            )
        }
        const files = await readdir(directory)
        const contents = await Promise.all(
          files.map((file) => readFile(join(directory, file), 'utf8'))
        )
        await sql.unsafe(`
        ALTER TABLE workspace RENAME TO workspace_fixture_source;
        CREATE FUNCTION pause_fixture_scan() RETURNS boolean LANGUAGE plpgsql AS $$
          BEGIN PERFORM pg_sleep(5); RETURN true; END $$;
        CREATE VIEW workspace AS SELECT * FROM workspace_fixture_source WHERE pause_fixture_scan();
      `)
        const child = execFile(
          'bun',
          ['--no-env-file', 'scripts/backfill-projects.ts', command, ...artifacts],
          options
        )
        const exited = once(child, 'close')
        try {
          await expect
            .poll(
              async () => {
                const [state] = await sql`SELECT count(*)::int AS waiting FROM pg_stat_activity
                WHERE datname = current_database() AND application_name = 'sim-project-backfill'
                  AND wait_event = 'PgSleep'`
                return state.waiting
              },
              { timeout: 5000, interval: 20 }
            )
            .toBe(1)
          const competing = await sql.reserve()
          try {
            const [attempt] =
              await competing`SELECT pg_try_advisory_lock(hashtextextended('sim:project-backfill-operator',0)) AS acquired`
            try {
              expect(attempt.acquired).toBe(false)
            } finally {
              if (attempt.acquired)
                await competing`SELECT pg_advisory_unlock(hashtextextended('sim:project-backfill-operator',0))`
            }
          } finally {
            competing.release()
          }
          child.kill(signal)
          expect((await exited)[1]).toBe(signal)
          expect(await readdir(directory)).toEqual(files)
          expect(
            await Promise.all(files.map((file) => readFile(join(directory, file), 'utf8')))
          ).toEqual(contents)
        } finally {
          if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
          await exited
          await rm(directory, { recursive: true, force: true })
        }
      })
    },
    20000
  )

  it('refuses a generated plan exceeding the artifact size limit before publishing it', async () => {
    await database(async (sql, url) => {
      const directory = await mkdtemp(join(tmpdir(), 'project-plan-size-test-'))
      try {
        await sql`INSERT INTO "user" VALUES (repeat('o',1024))`
        await sql`INSERT INTO workspace (id,name,owner_id)
          SELECT rpad('w-' || lpad(n::text,5,'0'),1024,'x'),'Large identifier fixture',repeat('o',1024)
          FROM generate_series(1,45000) n`
        await expect(
          promisify(execFile)(
            'bun',
            [
              '--no-env-file',
              'scripts/backfill-projects.ts',
              'plan',
              '--manifest',
              join(directory, 'manifest.json'),
            ],
            {
              cwd: new URL('../../../apps/sim/', import.meta.url),
              env: { ...process.env, MIGRATION_DATABASE_URL: url },
              timeout: 60000,
            }
          )
        ).rejects.toMatchObject({ code: 1 })
        expect(await readdir(directory)).toEqual([])
        expect(await sql`SELECT id FROM project`).toHaveLength(0)
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    })
  }, 90000)

  it('gives workflow creation share locks precedence and bounds a stalled batch without retaining locks', async () => {
    await database(async (sql) => {
      await sql`INSERT INTO workspace (id,name,owner_id) VALUES ('root','Root','owner')`
      const manifest = await discoverProjectBackfill(sql, 'fixture')
      const held = createDeferred<void>()
      const release = createDeferred<void>()
      const writer = sql.begin(async (tx) => {
        await tx`SELECT id FROM workspace WHERE id = 'root' FOR SHARE`
        held.resolve()
        await release.promise
        await tx`INSERT INTO workflow VALUES ('flow','root',NULL)`
      })
      await held.promise
      try {
        await expect(assignProjectBackfillBatch(sql, manifest.families)).rejects.toSatisfy(
          (error: unknown) => getPostgresErrorCode(error) === '55P03'
        )
        expect(await sql`SELECT id FROM project`).toHaveLength(0)
      } finally {
        release.resolve()
        await writer
      }
      await sql.unsafe(`CREATE FUNCTION delay_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(8); RETURN NEW; END $$;
        CREATE TRIGGER delay_fixture BEFORE INSERT ON project FOR EACH ROW EXECUTE FUNCTION delay_fixture();`)
      await expect(assignProjectBackfillBatch(sql, manifest.families)).rejects.toSatisfy(
        (error: unknown) => getPostgresErrorCode(error) === '57014'
      )
      expect(await sql`SELECT id FROM project`).toHaveLength(0)
      await sql.begin(async (tx) => {
        await tx`SET LOCAL lock_timeout = '100ms'`
        await tx`SELECT pg_advisory_xact_lock_shared(hashtextextended('project-backfill:root',0))`
        await tx`UPDATE workspace SET name = 'Recovered' WHERE id = 'root'`
      })
      await sql`DROP TRIGGER delay_fixture ON project`
      await assignProjectBackfillBatch(sql, manifest.families)
      expect(await sql`SELECT name FROM project`).toEqual([{ name: 'Recovered - Project' }])
    })
  }, 10000)

  it('excludes SQL contraction and database-backed commands while preserving offline status', async () => {
    await database(async (sql, url) => {
      const directory = await mkdtemp(join(tmpdir(), 'project-command-lock-test-'))
      const manifest = join(directory, 'manifest.json')
      const report = join(directory, 'report.json')
      const concurrentPlan = join(directory, 'concurrent-plan.json')
      const run = (command: string, plan = manifest) =>
        promisify(execFile)(
          'bun',
          [
            '--no-env-file',
            'scripts/backfill-projects.ts',
            command,
            '--manifest',
            plan,
            '--report',
            report,
            '--ack-release-drained',
          ],
          {
            cwd: new URL('../../../apps/sim/', import.meta.url),
            env: { ...process.env, MIGRATION_DATABASE_URL: url },
            timeout: 15000,
          }
        )
      try {
        await run('plan')
        await run('apply')
        const connection = await sql.reserve()
        try {
          await connection`SELECT pg_advisory_lock(hashtextextended('sim:project-backfill-operator',0))`
          await expect(applyMigration(sql, migration)).rejects.toThrow(
            'preparation is still running'
          )
          const attempts = await Promise.allSettled([run('plan', concurrentPlan), run('verify')])
          expect(attempts).toMatchObject([
            { status: 'rejected', reason: { code: 1 } },
            { status: 'rejected', reason: { code: 1 } },
          ])
          await run('status')
          expect(await readdir(directory)).not.toContain('concurrent-plan.json')
          expect(await sql`SELECT to_regclass('project_workspace')::text AS name`).toEqual([
            { name: 'project_workspace' },
          ])
        } finally {
          await connection`SELECT pg_advisory_unlock(hashtextextended('sim:project-backfill-operator',0))`
          connection.release()
        }
        await run('plan', concurrentPlan)
        await run('verify')
        await applyMigration(sql, migration)
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    })
  })

  it('leaves lifecycle enforcement to the application without touching Project rows', async () => {
    await database(async (sql) => {
      await seed(sql)
      const before = await sql`SELECT id, xmin::text, updated_at FROM project`
      await sql`UPDATE workspace SET archived_at = now()`
      expect(await sql`SELECT id, xmin::text, updated_at FROM project`).toEqual(before)
      await sql`UPDATE project SET archived_at = now()`
      await sql`UPDATE workspace SET archived_at = NULL`
      await sql`INSERT INTO project (id,name,owner_id) VALUES ('empty','Empty','owner')`
      await sql`DELETE FROM workspace`
      expect(await sql`SELECT id FROM project`).toHaveLength(2)
    })
  })

  it('revalidates structural mutations after constraints switch to immediate mode', async () => {
    await database(async (sql) => {
      await seed(sql)
      await expect(
        sql.begin(async (tx) => {
          await tx`SET CONSTRAINTS ALL IMMEDIATE`
          await tx`UPDATE workspace SET organization_id = 'org' WHERE id = 'child'`
        })
      ).rejects.toSatisfy(constraintFailure)
    })
  })

  it('requires the exact expansion journal and physical column before rollout evidence can pass', async () => {
    await database(async (sql, url) => {
      const run = () =>
        promisify(execFile)('bun', ['--no-env-file', 'scripts/project-contract-required.ts'], {
          cwd: new URL('..', import.meta.url),
          env: { ...process.env, DATABASE_URL: url, MIGRATION_DATABASE_URL: url },
        })
      await expect(run()).rejects.toMatchObject({ code: 1 })
      await sql`CREATE SCHEMA drizzle`
      await sql`CREATE TABLE drizzle.__drizzle_migrations (created_at bigint)`
      const expanded = journal.entries.find((item) => item.tag === '0406_workspace_project_column')
      const entry = journal.entries.find(
        (item) => item.tag === '0407_project_membership_enforcement'
      )
      if (!expanded || !entry) throw new Error('Missing Project migration metadata')
      await sql`INSERT INTO drizzle.__drizzle_migrations VALUES (${expanded.when - 1})`
      await expect(run()).rejects.toMatchObject({ code: 1 })
      await sql`INSERT INTO drizzle.__drizzle_migrations VALUES (${expanded.when})`
      await sql`INSERT INTO workspace (id,name,owner_id) VALUES ('legacy','Legacy','owner')`
      expect((await run()).stdout.trim()).toBe('required=true')
      await sql`DELETE FROM project_membership_rollout`
      await expect(run()).rejects.toMatchObject({ code: 1 })
      await sql`INSERT INTO project_membership_rollout (id, phase) VALUES ('membership', 'connector')`
      expect((await run()).stdout.trim()).toBe('required=true')
      await sql`INSERT INTO project (id,name,owner_id) VALUES ('gate','Gate','owner')`
      await sql`UPDATE workspace SET project_id = 'gate' WHERE id = 'legacy'`
      await expect(run()).rejects.toMatchObject({ code: 1 })
      await sql`UPDATE workspace SET project_id = NULL WHERE id = 'legacy'`
      await sql`DELETE FROM project WHERE id = 'gate'`
      await sql`ALTER TABLE workspace DROP COLUMN project_id CASCADE`
      await expect(run()).rejects.toMatchObject({ code: 1 })
      await applyMigration(sql, expansion)
      expect((await run()).stdout.trim()).toBe('required=true')
      await sql`INSERT INTO drizzle.__drizzle_migrations VALUES (${entry.when})`
      expect((await run()).stdout.trim()).toBe('required=true')
      await runRegisteredProjectMigration(url)
      expect((await run()).stdout.trim()).toBe('required=false')
      await sql`DELETE FROM drizzle.__drizzle_migrations WHERE created_at = ${expanded.when}`
      await expect(run()).rejects.toMatchObject({ code: 1 })
      await sql`DROP TABLE workspace CASCADE`
      await sql`DROP SCHEMA drizzle CASCADE`
      expect((await run()).stdout.trim()).toBe('required=false')
    })
  })

  it('replays committed contraction when recording its script receipt fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'project-contract-runner-'))
    try {
      await mkdir(join(directory, 'meta'))
      await writeFile(join(directory, '0406_workspace_project_column.sql'), expansion)
      await writeFile(
        join(directory, '0407_project_membership_enforcement.sql'),
        await readFile(
          new URL('../migrations/0407_project_membership_enforcement.sql', import.meta.url),
          'utf8'
        )
      )
      await writeFile(
        join(directory, 'meta/_journal.json'),
        JSON.stringify({
          ...journal,
          entries: journal.entries.filter(
            (entry) =>
              entry.tag === '0406_workspace_project_column' ||
              entry.tag === '0407_project_membership_enforcement'
          ),
        })
      )
      await database(async (sql, url) => {
        const runner = postgres(url, { max: 1, onnotice: () => undefined, max_lifetime: null })
        const run = async () => {
          await migrate(drizzle(runner), { migrationsFolder: directory })
          await runScriptMigrations(
            runner,
            scriptMigrations.filter((item) => item.name === '0031_project_membership')
          )
        }
        try {
          await sql`INSERT INTO project (id,name,owner_id) VALUES ('empty','Empty','owner')`
          await expect(run()).rejects.toThrow('conflicts')
          expect(await sql`SELECT * FROM drizzle.__drizzle_migrations`).toHaveLength(2)
          expect(await sql`SELECT * FROM script_migrations`).toHaveLength(0)
          await sql`DELETE FROM project WHERE id = 'empty'`
          await sql`INSERT INTO workspace (id,name,owner_id) VALUES ('legacy','Legacy','owner')`
          await sql.unsafe(`CREATE FUNCTION reject_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
            RAISE EXCEPTION 'receipt failure'; END $$;
            CREATE TRIGGER reject_receipt BEFORE INSERT ON script_migrations FOR EACH ROW EXECUTE FUNCTION reject_receipt();`)
          await expect(run()).rejects.toThrow('receipt failure')
          expect(await sql`SELECT to_regclass('project_workspace')::text AS connector`).toEqual([
            { connector: null },
          ])
          expect(
            await sql`SELECT to_regclass('public.project_membership_rollout') AS marker`
          ).toEqual([{ marker: null }])
          expect(await sql`SELECT * FROM script_migrations`).toHaveLength(0)
          await expect(
            sql`INSERT INTO workspace (id,name,owner_id) VALUES ('bad','Bad','owner')`
          ).rejects.toSatisfy((error: unknown) => getPostgresErrorCode(error) === '23502')
          await expect(
            sql`INSERT INTO workspace (id,project_id,name,owner_id) VALUES ('missing','missing','Missing','owner')`
          ).rejects.toSatisfy((error: unknown) => getPostgresErrorCode(error) === '23503')
          const assignments = await sql`SELECT id,project_id FROM workspace ORDER BY id`
          await sql`DROP TRIGGER reject_receipt ON script_migrations`
          await run()
          await run()
          expect(await sql`SELECT * FROM drizzle.__drizzle_migrations`).toHaveLength(2)
          expect(await sql`SELECT name FROM script_migrations`).toEqual([
            { name: '0031_project_membership' },
          ])
          expect(await sql`SELECT id,project_id FROM workspace ORDER BY id`).toEqual(assignments)
          await sql`DELETE FROM workspace`
        } finally {
          await runner.end()
        }
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it.each(['workspace', 'project', 'project_workspace'] as const)(
    'fails contract DDL promptly on busy %s and releases partially acquired locks',
    async (table) => {
      await database(async (sql) => {
        const held = createDeferred<void>()
        const release = createDeferred<void>()
        const reader = sql.begin(async (tx) => {
          await tx`SELECT * FROM ${tx(table)}`
          held.resolve()
          await release.promise
        })
        await held.promise
        try {
          const started = performance.now()
          await expect(prepareAndEnforce(sql)).rejects.toSatisfy(
            (error: unknown) => getPostgresErrorCode(error) === '55P03'
          )
          expect(performance.now() - started).toBeLessThan(2000)
          await sql.begin(async (tx) => {
            await tx`SET LOCAL statement_timeout = '500ms'`
            await tx`INSERT INTO project (id, name, owner_id) VALUES ('live-project', 'Live project', 'owner')`
            await tx`INSERT INTO workspace (id, project_id, name, owner_id) VALUES ('live', 'live-project', 'Live', 'owner')`
            await tx`SELECT * FROM project`
          })
          expect(await sql`SELECT project_id FROM workspace WHERE id = 'live'`).toEqual([
            { project_id: 'live-project' },
          ])
          expect(
            await sql`SELECT project_id FROM project_workspace WHERE workspace_id = 'live'`
          ).toHaveLength(0)
        } finally {
          release.resolve()
          await reader
        }
        await prepareAndEnforce(sql)
        expect(
          await sql`SELECT id FROM workspace WHERE id = 'live' AND project_id = 'live-project'`
        ).toHaveLength(1)
      })
    }
  )

  it('releases installation table locks when the migration client stalls between statements', async () => {
    await database(async (sql, url) => {
      const result = await promisify(execFile)(
        'bun',
        [
          '--no-env-file',
          '-e',
          `
        import { readFile } from 'node:fs/promises';
        import { sleep } from '@sim/utils/helpers';
        import postgres from 'postgres';
        const sql = postgres(process.env.TEST_DATABASE_URL, { max: 1, onnotice: () => undefined });
        const observer = postgres(process.env.TEST_DATABASE_URL, { max: 1 });
        const [{ pid }] = await sql.unsafe('SELECT pg_backend_pid() AS pid');
        const locks = async () => (await observer.unsafe(
          "SELECT count(*)::int AS count FROM pg_locks WHERE pid = $1 AND mode = 'AccessExclusiveLock' AND granted",
          [pid]
        ))[0].count;
        const migration = await readFile('maintenance/project-membership.sql', 'utf8');
        for (const statement of migration.split('--> statement-breakpoint')) {
          await sql.unsafe(statement);
          if (statement.includes('LOCK TABLE workspace,')) {
            const before = await locks();
            await sleep(6500);
            const result = JSON.stringify({ before, after: await locks() });
            await new Promise((resolve, reject) => process.stdout.write(result, (error) => error ? reject(error) : resolve()));
            process.exit(0);
          }
        }
        process.exit(1);
      `,
        ],
        {
          cwd: new URL('..', import.meta.url),
          env: { ...process.env, TEST_DATABASE_URL: url },
          timeout: 12000,
        }
      )
      expect(JSON.parse(result.stdout)).toEqual({ before: 2, after: 0 })
      await sql.begin(async (tx) => {
        await tx`SET LOCAL statement_timeout = '500ms'`
        await tx`INSERT INTO project (id, name, owner_id) VALUES ('live-project', 'Live project', 'owner')`
        await tx`INSERT INTO workspace (id, project_id, name, owner_id) VALUES ('live', 'live-project', 'Live', 'owner')`
        await tx`SELECT * FROM project`
      })
      await prepareAndEnforce(sql)
      expect(
        await sql`SELECT id FROM workspace WHERE id = 'live' AND project_id = 'live-project'`
      ).toHaveLength(1)
    })
  }, 15000)

  it('backfills legacy environments before installing mandatory membership', async () => {
    await database(async (sql) => {
      await sql`INSERT INTO workspace (id, name, owner_id) VALUES ('legacy', 'Legacy', 'owner')`
      await prepareAndEnforce(sql)
      expect(
        await sql`SELECT 1 FROM workspace WHERE id = 'legacy' AND project_id IS NOT NULL`
      ).toHaveLength(1)
      await expect(
        sql`INSERT INTO workspace (id, name, owner_id) VALUES ('unassigned', 'Invalid', 'owner')`
      ).rejects.toSatisfy((error: unknown) => getPostgresErrorCode(error) === '23502')
      expect(await sql`SELECT 1 FROM workspace WHERE id = 'unassigned'`).toHaveLength(0)
    })
  })

  it('rebuilds an interrupted unique index before attaching native constraints', async () => {
    await database(async (sql) => {
      await sql`INSERT INTO workspace (id,name,owner_id) VALUES ('root','Root','owner')`
      await prepare(sql)
      const prefix = migration.slice(0, migration.indexOf('CREATE UNIQUE INDEX CONCURRENTLY'))
      await applyMigration(sql, prefix)
      const held = createDeferred<void>()
      const release = createDeferred<void>()
      const reader = sql.begin(async (tx) => {
        await tx`SELECT id FROM project`
        held.resolve()
        await release.promise
      })
      await held.promise
      try {
        await expect(
          applyMigration(
            sql,
            `SET statement_timeout = '100ms';
          --> statement-breakpoint
          CREATE UNIQUE INDEX CONCURRENTLY project_id_organization_scope_unique
          ON project(id,organization_scope_key);`
          )
        ).rejects.toSatisfy((error: unknown) => getPostgresErrorCode(error) === '57014')
      } finally {
        release.resolve()
        await reader
      }
      expect(
        await sql`SELECT indisvalid FROM pg_index WHERE indexrelid = 'project_id_organization_scope_unique'::regclass`
      ).toEqual([{ indisvalid: false }])
      await applyMigration(sql, migration)
      await applyMigration(sql, migration)
      expect(
        await sql`SELECT convalidated FROM pg_constraint WHERE conname = 'workspace_project_organization_fk'`
      ).toEqual([{ convalidated: true }])
    })
  })

  it('supports a fresh database, repeated installation, and atomic first-environment creation', async () => {
    await database(async (sql) => {
      await prepareAndEnforce(sql)
      await prepareAndEnforce(sql)
      await sql.begin(async (tx) => {
        await tx`INSERT INTO project (id, name, owner_id) VALUES ('new', 'New', 'owner')`
        await tx`INSERT INTO workspace (id, project_id, name, owner_id) VALUES ('first', 'new', 'First', 'owner')`
        await tx`INSERT INTO workflow VALUES ('flow', 'first', NULL)`
      })
      await sql`INSERT INTO project (id, name, owner_id) VALUES ('empty', 'Empty', 'owner')`
      expect(await sql`SELECT 1 FROM project`).toHaveLength(2)
    })
  })

  it('rejects invalid scope/fork changes and commits an atomic subtree disconnect', async () => {
    await database(async (sql) => {
      await seed(sql)
      await prepareAndEnforce(sql)
      await expect(
        sql`UPDATE workspace SET organization_id = 'org' WHERE id = 'child'`
      ).rejects.toSatisfy(constraintFailure)
      await expect(
        sql`UPDATE workspace SET project_id = NULL WHERE id = 'child'`
      ).rejects.toSatisfy((error: unknown) => getPostgresErrorCode(error) === '23502')
      await expect(
        sql.begin(async (tx) => {
          await tx`INSERT INTO project (id, name, owner_id) VALUES ('detached', 'Detached', 'owner')`
          await tx`UPDATE workspace SET project_id = 'detached' WHERE id = 'child'`
        })
      ).rejects.toSatisfy(constraintFailure)
      await sql.begin(async (tx) => {
        await tx`INSERT INTO project (id, name, owner_id) VALUES ('detached', 'Detached', 'owner')`
        await tx`UPDATE workspace SET project_id = 'detached' WHERE id = 'child'`
        await tx`UPDATE workspace SET forked_from_workspace_id = NULL WHERE id = 'child'`
      })
      expect(await sql`SELECT DISTINCT project_id FROM workspace`).toHaveLength(2)
      await expect(sql`DELETE FROM project WHERE id = 'detached'`).rejects.toSatisfy(
        (error: unknown) => getPostgresErrorCode(error) === '23503'
      )
    })
  })

  it.each([
    [null, 'org'],
    ['org', null],
    ['org', 'other'],
  ])('rejects organization mismatch %s / %s on both sides', async (projectOrg, workspaceOrg) => {
    await database(async (sql) => {
      await seed(sql)
      await sql`INSERT INTO organization VALUES ('other')`
      await sql.begin(async (tx) => {
        await tx`UPDATE project SET organization_id = ${projectOrg}`
        await tx`UPDATE workspace SET organization_id = ${projectOrg}`
      })
      await expect(
        sql`UPDATE workspace SET organization_id = ${workspaceOrg} WHERE id = 'child'`
      ).rejects.toSatisfy(constraintFailure)
      await expect(sql`UPDATE project SET organization_id = ${workspaceOrg}`).rejects.toSatisfy(
        constraintFailure
      )
      await sql.begin(async (tx) => {
        await tx`UPDATE workspace SET organization_id = ${workspaceOrg}`
        await tx`UPDATE project SET organization_id = ${workspaceOrg}`
      })
      expect(
        await sql`SELECT 1 FROM workspace w JOIN project p ON p.id = w.project_id
        WHERE w.organization_id IS DISTINCT FROM p.organization_id`
      ).toHaveLength(0)
    })
  })

  it('keeps generated scope keys distinct from organization identifiers and rejects overrides', async () => {
    await database(async (sql) => {
      await seed(sql)
      await sql`INSERT INTO organization VALUES ('personal')`
      await expect(
        sql`UPDATE workspace SET organization_id = 'personal' WHERE id = 'child'`
      ).rejects.toSatisfy(constraintFailure)
      await expect(
        sql`UPDATE workspace SET organization_scope_key = 'organization:org' WHERE id = 'child'`
      ).rejects.toSatisfy((error: unknown) => getPostgresErrorCode(error) === '428C9')
    })
  })

  it('checks parent moves, allows atomic subtree moves and preserves membership on parent deletion', async () => {
    await database(async (sql) => {
      await seed(sql)
      const [source] = await sql`SELECT project_id FROM workspace WHERE id = 'root'`
      await sql`INSERT INTO project (id,name,owner_id) VALUES ('target','Target','owner')`
      await sql`INSERT INTO workspace (id,project_id,name,owner_id,forked_from_workspace_id)
        VALUES ('grandchild',${source.project_id},'Grandchild','owner','child')`
      const before = await sql`SELECT id,xmin::text,updated_at FROM project ORDER BY id`
      await expect(
        sql`UPDATE workspace SET project_id = 'target' WHERE id = 'root'`
      ).rejects.toSatisfy(constraintFailure)
      await sql.begin(async (tx) => {
        await tx`UPDATE workspace SET project_id = 'target' WHERE id = 'child'`
        await tx`UPDATE workspace SET project_id = 'target' WHERE id = 'grandchild'`
        await tx`UPDATE workspace SET forked_from_workspace_id = NULL WHERE id = 'child'`
      })
      await sql`DELETE FROM workspace WHERE id = 'child'`
      expect(
        await sql`SELECT project_id,forked_from_workspace_id FROM workspace WHERE id = 'grandchild'`
      ).toEqual([{ project_id: 'target', forked_from_workspace_id: null }])
      expect(await sql`SELECT id,xmin::text,updated_at FROM project ORDER BY id`).toEqual(before)
      expect(
        await sql`SELECT tgname FROM pg_trigger WHERE tgrelid IN ('workspace'::regclass,'project'::regclass)
        AND NOT tgisinternal`
      ).toHaveLength(0)
    })
  })

  it.each(['read committed', 'repeatable read'] as const)(
    'rejects a stale fork insertion after its parent moves under %s without touching Projects',
    async (isolation) => {
      await database(async (sql) => {
        await seed(sql)
        await sql`DELETE FROM workspace WHERE id = 'child'`
        await sql`INSERT INTO project (id,name,owner_id) VALUES ('target','Target','owner')`
        const before = await sql`SELECT id,xmin::text FROM project ORDER BY id`
        await expect(
          sql.begin(`isolation level ${isolation}`, async (tx) => {
            const [parent] = await tx`SELECT project_id FROM workspace WHERE id = 'root'`
            await sql`UPDATE workspace SET project_id = 'target' WHERE id = 'root'`
            await tx`INSERT INTO workspace (id,project_id,name,owner_id,forked_from_workspace_id)
            VALUES ('stale-child',${parent.project_id},'Stale','owner','root')`
          })
        ).rejects.toSatisfy((error: unknown) =>
          ['23503', '40001'].includes(getPostgresErrorCode(error) ?? '')
        )
        expect(await sql`SELECT id FROM workspace WHERE id = 'stale-child'`).toHaveLength(0)
        expect(await sql`SELECT id,xmin::text FROM project ORDER BY id`).toEqual(before)
      })
    }
  )

  it.each(['read committed', 'repeatable read'] as const)(
    'rejects stale organization assignment under %s',
    async (isolation) => {
      await database(async (sql) => {
        await seed(sql)
        await expect(
          sql.begin(`isolation level ${isolation}`, async (tx) => {
            const [parent] = await tx`SELECT id,organization_id FROM project`
            await sql.begin(async (move) => {
              await move`UPDATE project SET organization_id = 'org'`
              await move`UPDATE workspace SET organization_id = 'org'`
            })
            await tx`INSERT INTO workspace (id,project_id,name,owner_id,organization_id)
            VALUES ('stale',${parent.id},'Stale','owner',${parent.organization_id})`
          })
        ).rejects.toSatisfy((error: unknown) =>
          ['23503', '40001'].includes(getPostgresErrorCode(error) ?? '')
        )
        expect(await sql`SELECT id FROM workspace WHERE id = 'stale'`).toHaveLength(0)
      })
    }
  )

  it('allows concurrent workflow lifecycle writes without rewriting or locking their Project', async () => {
    await database(async (sql) => {
      await seed(sql)
      const before = await sql`SELECT id, xmin::text FROM project`
      const held = createDeferred<void>()
      const release = createDeferred<void>()
      const writer = sql.begin(async (tx) => {
        await tx`INSERT INTO workflow VALUES ('first', 'root', NULL)`
        held.resolve()
        await release.promise
      })
      await held.promise
      try {
        await sql.begin(async (tx) => {
          await tx`SET LOCAL statement_timeout = '500ms'`
          await tx`INSERT INTO workflow VALUES ('same-workspace', 'root', NULL), ('other-workspace', 'child', NULL)`
          await tx`UPDATE workflow SET archived_at = now() WHERE id = 'other-workspace'`
          await tx`UPDATE workflow SET workspace_id = 'child' WHERE id = 'same-workspace'`
          await tx`DELETE FROM workflow WHERE id = 'other-workspace'`
        })
      } finally {
        release.resolve()
        await writer
      }
      expect(await sql`SELECT id, xmin::text FROM project`).toEqual(before)
      expect(
        await sql`SELECT id FROM workflow WHERE id = 'same-workspace' AND workspace_id = 'child'`
      ).toHaveLength(1)
    })
  })

  it('refuses enforcement when an archived Project retains an active workflow', async () => {
    await database(async (sql) => {
      await sql`INSERT INTO workspace (id, name, owner_id) VALUES ('root', 'Root', 'owner')`
      await sql`INSERT INTO project (id, name, owner_id, archived_at) VALUES ('existing', 'Existing', 'owner', now())`
      await sql`UPDATE workspace SET project_id = 'existing', archived_at = now()`
      await sql`INSERT INTO workflow VALUES ('flow', 'root', NULL)`
      await expect(applyMigration(sql, migration)).rejects.toSatisfy(
        (error: unknown) => getPostgresErrorCode(error) === '55000'
      )
      expect(await sql`SELECT to_regclass('project_workspace')::text AS name`).toEqual([
        { name: 'project_workspace' },
      ])
      await sql`UPDATE workflow SET archived_at = now()`
      await applyMigration(sql, migration)
    })
  })
  it('groups fork families, preserves partial assignments, and retains archived and detached Projects on replay', async () => {
    await database(async (sql) => {
      await sql`INSERT INTO "user" VALUES ('other-owner')`
      await sql`INSERT INTO workspace (id, name, owner_id, organization_id, forked_from_workspace_id, archived_at) VALUES
        ('a-root', 'Production', 'owner', 'org', NULL, NULL),
        ('b-child', 'Staging', 'other-owner', 'org', 'a-root', NULL),
        ('c-grandchild', 'Dev', 'owner', 'org', 'b-child', NULL),
        ('d-detached', 'Detached', 'owner', NULL, NULL, NULL),
        ('e-child', 'Child', 'owner', NULL, 'd-detached', NULL),
        ('f-archived', 'Archive', 'owner', NULL, NULL, '2025-01-01'),
        ('g-archived', 'Archive child', 'owner', NULL, 'f-archived', '2025-02-01')`
      await sql`INSERT INTO project (id, name, owner_id, organization_id) VALUES ('existing', 'Keep name', 'owner', 'org')`
      await sql`INSERT INTO project_workspace (project_id, workspace_id) VALUES ('existing', 'a-root')`
      await prepareAndEnforce(sql)
      expect(await sql`SELECT id FROM workspace WHERE project_id = 'existing' ORDER BY id`).toEqual(
        [{ id: 'a-root' }, { id: 'b-child' }, { id: 'c-grandchild' }]
      )
      const projects =
        await sql`SELECT id, name, owner_id, archived_at::text FROM project ORDER BY name`
      expect(
        projects.map(({ name, owner_id, archived_at }) => ({ name, owner_id, archived_at }))
      ).toEqual([
        { name: 'Archive - Project', owner_id: 'owner', archived_at: '2025-02-01 00:00:00' },
        { name: 'Detached - Project', owner_id: 'owner', archived_at: null },
        { name: 'Keep name', owner_id: 'owner', archived_at: null },
      ])
      await prepareAndEnforce(sql)
      expect(
        await sql`SELECT id, name, owner_id, archived_at::text FROM project ORDER BY name`
      ).toEqual(projects)
    })
  })

  it('keeps committed families on conflict and resumes without duplicating Projects after remediation', async () => {
    await database(async (sql) => {
      await sql`INSERT INTO workspace (id, name, owner_id, organization_id, forked_from_workspace_id) VALUES
        ('a-good', 'Good', 'owner', NULL, NULL),
        ('b-root', 'Root', 'owner', 'org', NULL),
        ('b-child', 'Child', 'owner', NULL, 'b-root')`
      await expect(prepareAndEnforce(sql)).rejects.toSatisfy(
        (error: unknown) => getPostgresErrorCode(error) === '55000'
      )
      const committed =
        await sql`SELECT project_id FROM workspace WHERE id = 'a-good' AND project_id IS NOT NULL`
      expect(committed).toHaveLength(1)
      expect(
        await sql`SELECT 1 FROM workspace WHERE id LIKE 'b-%' AND project_id IS NOT NULL`
      ).toHaveLength(0)
      expect(
        await sql`SELECT 1 FROM pg_constraint WHERE conname = 'workspace_fork_project_fk'`
      ).toHaveLength(0)
      await sql`UPDATE workspace SET organization_id = 'org' WHERE id = 'b-child'`
      await prepareAndEnforce(sql)
      expect(
        await sql`SELECT project_id FROM workspace WHERE id = 'a-good' AND project_id IS NOT NULL`
      ).toEqual(committed)
      expect(await sql`SELECT 1 FROM project`).toHaveLength(2)
      expect(await sql`SELECT 1 FROM workspace WHERE project_id IS NOT NULL`).toHaveLength(3)
    })
  })

  it('defers a locked family, commits unrelated work and detects a new fork before replay', async () => {
    await database(async (sql) => {
      await sql`INSERT INTO workspace (id,name,owner_id) VALUES ('a-free','Free','owner'),('b-busy','Busy','owner')`
      const manifest = await discoverProjectBackfill(sql, 'fixture')
      const held = createDeferred<void>()
      const release = createDeferred<void>()
      const writer = sql.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock_shared(hashtextextended('project-backfill:b-busy',0))`
        held.resolve()
        await release.promise
        await tx`INSERT INTO workspace (id,name,owner_id,forked_from_workspace_id) VALUES ('child','Child','owner','b-busy')`
      })
      await held.promise
      try {
        await expect(assignProjectBackfillBatch(sql, [manifest.families[1]])).rejects.toThrow(
          'busy'
        )
        expect(await assignProjectBackfillBatch(sql, [manifest.families[0]])).toMatchObject({
          assigned: 1,
        })
        await sql.begin(async (tx) => {
          await tx`SET LOCAL lock_timeout = '100ms'`
          await tx`SELECT pg_advisory_xact_lock_shared(hashtextextended('project-backfill:a-free',0))`
          await tx`UPDATE workspace SET name = 'Live edit' WHERE id = 'a-free'`
        })
      } finally {
        release.resolve()
        await writer
      }
      await expect(assignProjectBackfillBatch(sql, [manifest.families[1]])).rejects.toThrow(
        'gained descendants'
      )
      expect(await sql`SELECT id FROM workspace WHERE project_id IS NULL`).toHaveLength(2)
      await prepareAndEnforce(sql)
      expect(
        await sql`SELECT DISTINCT project_id FROM workspace WHERE id IN ('b-busy','child')`
      ).toHaveLength(1)
    })
  })

  it.each(['cycle', 'assigned-cycle', 'split', 'oversized'] as const)(
    'refuses %s legacy data without silently changing existing assignments',
    async (scenario) => {
      await database(async (sql) => {
        await sql`INSERT INTO workspace (id, name, owner_id, forked_from_workspace_id) VALUES ('root', 'Root', 'owner', NULL), ('child', 'Child', 'owner', 'root')`
        if (scenario === 'cycle' || scenario === 'assigned-cycle') {
          if (scenario === 'assigned-cycle') {
            await sql`INSERT INTO project (id, name, owner_id) VALUES ('existing', 'Existing', 'owner')`
            await sql`INSERT INTO project_workspace (project_id, workspace_id) VALUES ('existing', 'root'), ('existing', 'child')`
          }
          await sql`UPDATE workspace SET forked_from_workspace_id = 'child' WHERE id = 'root'`
        } else if (scenario === 'oversized') {
          await sql`INSERT INTO workspace (id, name, owner_id, forked_from_workspace_id) SELECT 'extra-' || n, 'Extra', 'owner', 'root' FROM generate_series(1, 1000) n`
        } else {
          await sql`INSERT INTO project (id, name, owner_id) VALUES ('existing', 'Existing', 'owner')`
          await sql`INSERT INTO project_workspace (project_id, workspace_id) VALUES ('existing', 'root')`
          if (scenario === 'split') {
            await sql`INSERT INTO project (id, name, owner_id) VALUES ('second', 'Second', 'owner')`
            await sql`INSERT INTO project_workspace (project_id, workspace_id) VALUES ('second', 'child')`
          }
        }
        const before = await sql`SELECT w.id, coalesce(w.project_id, pw.project_id) AS project_id
          FROM workspace w LEFT JOIN project_workspace pw ON pw.workspace_id = w.id ORDER BY w.id`
        if (scenario === 'split') {
          expect(await discoverProjectBackfill(sql, 'fixture')).toMatchObject({
            conflicts: [{ id: 'root', reason: 'Fork family spans Projects' }],
          })
        }
        await expect(prepareAndEnforce(sql)).rejects.toSatisfy(
          (error: unknown) =>
            getPostgresErrorCode(error) === (scenario === 'oversized' ? '54000' : '55000')
        )
        expect(
          await sql`SELECT w.id, coalesce(w.project_id, pw.project_id) AS project_id
          FROM workspace w LEFT JOIN project_workspace pw ON pw.workspace_id = w.id ORDER BY w.id`
        ).toEqual(before)
      })
    }
  )

  it('backfills a representative multi-family dataset through independently committed batches', async () => {
    await database(async (sql) => {
      await sql`INSERT INTO workspace (id, name, owner_id) SELECT 'root-' || n, 'Environment ' || n, 'owner' FROM generate_series(1, 100) n`
      await sql`INSERT INTO workspace (id, name, owner_id, forked_from_workspace_id)
        SELECT 'child-' || r || '-' || n, 'Child', 'owner', 'root-' || r FROM generate_series(1, 100) r CROSS JOIN generate_series(1, 20) n`
      await prepareAndEnforce(sql)
      expect((await sql`SELECT count(*)::int AS count FROM project`)[0].count).toBe(100)
      expect(
        (await sql`SELECT count(*)::int AS count FROM workspace WHERE project_id IS NOT NULL`)[0]
          .count
      ).toBe(2100)
      expect(
        await sql`SELECT project_id FROM workspace GROUP BY project_id HAVING count(*) <> 21`
      ).toHaveLength(0)
    })
  })
  it.each(['separate-roots', 'large-family'] as const)(
    'preserves a complete existing Project with %s without putting it through legacy assignment',
    async (shape) => {
      await database(async (sql) => {
        await sql`INSERT INTO project (id, name, owner_id) VALUES ('existing', 'Keep this Project', 'owner')`
        await sql`INSERT INTO workspace (id, name, owner_id) VALUES ('root', 'Root', 'owner')`
        const count = shape === 'large-family' ? 1001 : 150
        await sql`INSERT INTO workspace (id, name, owner_id, forked_from_workspace_id)
          SELECT 'other-' || n, 'Other', 'owner', ${shape === 'large-family' ? 'root' : null} FROM generate_series(1, ${count}) n`
        await sql`UPDATE workspace SET project_id = 'existing'`
        await sql`INSERT INTO project_workspace (project_id, workspace_id) SELECT 'existing', id FROM workspace`
        await prepareAndEnforce(sql)
        expect(await sql`SELECT id, name FROM project`).toEqual([
          { id: 'existing', name: 'Keep this Project' },
        ])
        expect(
          (await sql`SELECT count(*)::int AS count FROM workspace WHERE project_id IS NOT NULL`)[0]
            .count
        ).toBe(count + 1)
        expect(
          (await sql`SELECT count(*)::int AS count FROM workspace WHERE project_id = 'existing'`)[0]
            .count
        ).toBe(count + 1)
        await prepareAndEnforce(sql)
        expect(await sql`SELECT id, name FROM project`).toEqual([
          { id: 'existing', name: 'Keep this Project' },
        ])
      })
    }
  )
})
