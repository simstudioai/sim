import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import journal from '@sim/db/migrations/meta/_journal.json'
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { getPostgresErrorCode } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres, { type Sql } from 'postgres'
import { describe, expect, it } from 'vitest'

const migration = await readFile(
  new URL('../migrations/0404_project_membership_enforcement.sql', import.meta.url),
  'utf8'
)

const expansion = await readFile(
  new URL('../migrations/0403_workspace_project_column.sql', import.meta.url),
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
    if (!['25P04', 'CONNECTION_CLOSED'].includes(getPostgresErrorCode(error) ?? '')) {
      await reserved.unsafe('ROLLBACK')
    }
    throw error
  } finally {
    reserved.release()
  }
}

async function enforce(sql: Sql) {
  await applyMigration(sql, migration)
}

async function seed(sql: Sql) {
  await sql`INSERT INTO workspace (id, name, owner_id) VALUES ('root', 'Production', 'owner')`
  await sql`INSERT INTO workspace (id, name, owner_id, forked_from_workspace_id) VALUES ('child', 'Staging', 'owner', 'root')`
  await sql`INSERT INTO workflow VALUES ('flow', 'root', NULL)`
  await enforce(sql)
}

const constraintFailure = (error: unknown) => getPostgresErrorCode(error) === '23514'

describe('Project expand/backfill/contract against PostgreSQL', () => {
  it('validates a bulk archive once per final Project row version', async () => {
    await database(async (sql) => {
      await sql`INSERT INTO workspace (id, name, owner_id) VALUES ('root', 'Root', 'owner')`
      await sql`INSERT INTO workspace (id, name, owner_id, forked_from_workspace_id)
        SELECT 'child-' || n, 'Child', 'owner', 'root' FROM generate_series(1, 200) n`
      await enforce(sql)
      await sql.unsafe(`
        CREATE SEQUENCE project_validation_count;
        ALTER FUNCTION project_contract_assert_project(text) RENAME TO measured_project_assert;
        CREATE FUNCTION project_contract_assert_project(target_id text) RETURNS void LANGUAGE plpgsql AS $$
        BEGIN
          PERFORM nextval('project_validation_count');
          PERFORM measured_project_assert(target_id);
        END $$;
      `)
      await sql.begin(async (tx) => {
        await tx`UPDATE workspace SET archived_at = now()`
        await tx`UPDATE project SET archived_at = now()`
      })
      const [calls] =
        await sql`SELECT CASE WHEN is_called THEN last_value::int ELSE 0 END AS count FROM project_validation_count`
      expect(calls.count).toBe(1)
      const [state] =
        await sql`SELECT count(*)::int AS count FROM workspace WHERE archived_at IS NOT NULL`
      expect(state.count).toBe(201)
    })
  })

  it('revalidates each mutation after constraints switch to immediate mode', async () => {
    await database(async (sql) => {
      await seed(sql)
      await expect(
        sql.begin(async (tx) => {
          await tx`UPDATE workspace SET archived_at = now() WHERE id = 'root'`
          await tx`SET CONSTRAINTS ALL IMMEDIATE`
          await tx`UPDATE workspace SET archived_at = now() WHERE id = 'child'`
        })
      ).rejects.toSatisfy(constraintFailure)
      const [active] =
        await sql`SELECT count(*)::int AS count FROM workspace WHERE archived_at IS NULL`
      expect(active.count).toBe(2)
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
      const expanded = journal.entries.find((item) => item.tag === '0403_workspace_project_column')
      const entry = journal.entries.find(
        (item) => item.tag === '0404_project_membership_enforcement'
      )
      if (!expanded || !entry) throw new Error('Missing Project migration metadata')
      await sql`INSERT INTO drizzle.__drizzle_migrations VALUES (${expanded.when - 1})`
      await expect(run()).rejects.toMatchObject({ code: 1 })
      await sql`INSERT INTO drizzle.__drizzle_migrations VALUES (${expanded.when})`
      expect((await run()).stdout.trim()).toBe('required=true')
      await sql`ALTER TABLE workspace DROP COLUMN project_id CASCADE`
      await expect(run()).rejects.toMatchObject({ code: 1 })
      await applyMigration(sql, expansion)
      expect((await run()).stdout.trim()).toBe('required=true')
      await sql`INSERT INTO drizzle.__drizzle_migrations VALUES (${entry.when})`
      expect((await run()).stdout.trim()).toBe('required=false')
      await sql`DELETE FROM drizzle.__drizzle_migrations WHERE created_at = ${expanded.when}`
      await expect(run()).rejects.toMatchObject({ code: 1 })
      await sql`DROP TABLE workspace CASCADE`
      await sql`DROP SCHEMA drizzle CASCADE`
      expect((await run()).stdout.trim()).toBe('required=false')
    })
  })

  it('replays committed contraction without a journal receipt after recovering a failed precheck', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'project-contract-runner-'))
    try {
      await mkdir(join(directory, 'meta'))
      await writeFile(join(directory, '0403_workspace_project_column.sql'), expansion)
      await writeFile(join(directory, '0404_project_membership_enforcement.sql'), migration)
      await writeFile(
        join(directory, 'meta/_journal.json'),
        JSON.stringify({
          ...journal,
          entries: journal.entries.filter(
            (entry) =>
              entry.tag === '0403_workspace_project_column' ||
              entry.tag === '0404_project_membership_enforcement'
          ),
        })
      )
      await database(async (sql, url) => {
        const runner = postgres(url, { max: 1, onnotice: () => undefined })
        const run = () => migrate(drizzle(runner), { migrationsFolder: directory })
        try {
          await sql`INSERT INTO project (id, name, owner_id) VALUES ('empty', 'Empty', 'owner')`
          await expect(run()).rejects.toSatisfy(
            (error: unknown) => getPostgresErrorCode(error) === '55000'
          )
          const expanded = journal.entries.find(
            (entry) => entry.tag === '0403_workspace_project_column'
          )
          const contracted = journal.entries.find(
            (entry) => entry.tag === '0404_project_membership_enforcement'
          )
          if (!expanded || !contracted) throw new Error('Missing Project migration metadata')
          expect(await sql`SELECT created_at::text FROM drizzle.__drizzle_migrations`).toEqual([
            { created_at: String(expanded.when) },
          ])
          await sql`DELETE FROM project WHERE id = 'empty'`
          await sql`INSERT INTO workspace (id, name, owner_id) VALUES ('legacy', 'Legacy', 'owner')`
          await writeFile(
            join(directory, '0404_project_membership_enforcement.sql'),
            `${migration}\n--> statement-breakpoint\nSELECT 1 / 0;\n`
          )
          await expect(run()).rejects.toSatisfy(
            (error: unknown) => getPostgresErrorCode(error) === '22012'
          )
          expect(await sql`SELECT to_regclass('project_workspace')::text AS connector`).toEqual([
            { connector: null },
          ])
          expect(await sql`SELECT created_at::text FROM drizzle.__drizzle_migrations`).toEqual([
            { created_at: String(expanded.when) },
          ])
          await expect(
            sql`INSERT INTO workspace (id, name, owner_id) VALUES ('unassigned', 'Invalid', 'owner')`
          ).rejects.toSatisfy((error: unknown) => getPostgresErrorCode(error) === '23502')
          await expect(
            sql`INSERT INTO workspace (id, project_id, name, owner_id)
              VALUES ('missing-project', 'missing', 'Invalid', 'owner')`
          ).rejects.toSatisfy((error: unknown) => getPostgresErrorCode(error) === '23503')
          await sql.begin(async (tx) => {
            await tx`INSERT INTO project (id, name, owner_id) VALUES ('after-gap', 'After gap', 'owner')`
            await tx`INSERT INTO workspace (id, project_id, name, owner_id)
              VALUES ('after-gap', 'after-gap', 'After gap', 'owner')`
          })
          const assignments = await sql`SELECT id, project_id FROM workspace ORDER BY id`
          const projects = await sql`SELECT id, name FROM project ORDER BY id`

          await writeFile(join(directory, '0404_project_membership_enforcement.sql'), migration)
          await run()
          await run()
          expect(await sql`SELECT * FROM drizzle.__drizzle_migrations`).toHaveLength(2)
          expect(
            await sql`SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations
              WHERE created_at = ${contracted.when}`
          ).toEqual([{ count: 1 }])
          expect(await sql`SELECT id, project_id FROM workspace ORDER BY id`).toEqual(assignments)
          expect(await sql`SELECT id, name FROM project ORDER BY id`).toEqual(projects)
          await expect(sql`DELETE FROM workspace`).rejects.toSatisfy(constraintFailure)
        } finally {
          await runner.end()
        }
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it.each(['workspace', 'project_workspace'] as const)(
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
          await expect(enforce(sql)).rejects.toSatisfy(
            (error: unknown) => getPostgresErrorCode(error) === '55P03'
          )
          expect(performance.now() - started).toBeLessThan(2000)
          await sql.begin(async (tx) => {
            await tx`SET LOCAL statement_timeout = '500ms'`
            await tx`INSERT INTO project (id, name, owner_id) VALUES ('live-project', 'Live project', 'owner')`
            await tx`INSERT INTO workspace (id, project_id, name, owner_id) VALUES ('live', 'live-project', 'Live', 'owner')`
            await tx`SELECT * FROM project`
          })
          expect(
            await sql`SELECT project_id FROM project_workspace WHERE workspace_id = 'live'`
          ).toEqual([{ project_id: 'live-project' }])
        } finally {
          release.resolve()
          await reader
        }
        await enforce(sql)
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
        const migration = await readFile('migrations/0404_project_membership_enforcement.sql', 'utf8');
        for (const statement of migration.split('--> statement-breakpoint')) {
          await sql.unsafe(statement);
          if (statement.includes('LOCK TABLE workspace,')) {
            const before = await locks();
            await sleep(6500);
            process.stdout.write(JSON.stringify({ before, after: await locks() }));
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
      await enforce(sql)
      expect(
        await sql`SELECT id FROM workspace WHERE id = 'live' AND project_id = 'live-project'`
      ).toHaveLength(1)
    })
  }, 15000)

  it('backfills legacy environments before installing mandatory membership', async () => {
    await database(async (sql) => {
      await sql`INSERT INTO workspace (id, name, owner_id) VALUES ('legacy', 'Legacy', 'owner')`
      await enforce(sql)
      expect(
        await sql`SELECT 1 FROM workspace WHERE id = 'legacy' AND project_id IS NOT NULL`
      ).toHaveLength(1)
      await expect(
        sql`INSERT INTO workspace (id, name, owner_id) VALUES ('unassigned', 'Invalid', 'owner')`
      ).rejects.toSatisfy((error: unknown) => getPostgresErrorCode(error) === '23502')
      expect(await sql`SELECT 1 FROM workspace WHERE id = 'unassigned'`).toHaveLength(0)
    })
  })

  it('supports a fresh database, repeated installation, and atomic first-environment creation', async () => {
    await database(async (sql) => {
      await enforce(sql)
      await enforce(sql)
      await sql.begin(async (tx) => {
        await tx`INSERT INTO project (id, name, owner_id) VALUES ('new', 'New', 'owner')`
        await tx`INSERT INTO workspace (id, project_id, name, owner_id) VALUES ('first', 'new', 'First', 'owner')`
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

  it('requires workflows to be archived when archiving their Project and environments', async () => {
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
      await expect(
        sql`UPDATE workspace SET archived_at = NULL WHERE id = 'root'`
      ).rejects.toSatisfy(constraintFailure)
      expect(await sql`SELECT 1 FROM workspace WHERE archived_at IS NULL`).toHaveLength(0)
    })
  })

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
        const started = createDeferred<number>()
        const second = sql
          .begin(`isolation level ${isolation}`, async (tx) => {
            const [connection] =
              await tx`SELECT pg_backend_pid() AS pid, count(*) FROM workspace WHERE archived_at IS NULL`
            started.resolve(connection.pid)
            await tx`UPDATE workspace SET archived_at = now() WHERE id = 'child'`
          })
          .then(
            () => null,
            (error: unknown) => error
          )
        const secondPid = await started.promise
        try {
          let waiting = false
          for (let attempt = 0; attempt < 100; attempt++) {
            const [state] =
              await sql`SELECT cardinality(pg_blocking_pids(${secondPid})) > 0 AS waiting`
            if (state.waiting) {
              waiting = true
              break
            }
            await sleep(10)
          }
          expect(waiting).toBe(true)
        } finally {
          release.resolve()
          await first
        }
        const failure = await second
        expect(['23514', '40001', '40P01']).toContain(getPostgresErrorCode(failure))
        expect(await sql`SELECT 1 FROM workspace WHERE archived_at IS NULL`).toHaveLength(1)
      })
    }
  )

  it('refuses enforcement when an archived Project retains an active workflow', async () => {
    await database(async (sql) => {
      await sql`INSERT INTO workspace (id, name, owner_id) VALUES ('root', 'Root', 'owner')`
      await sql`INSERT INTO workflow VALUES ('flow', 'root', NULL)`
      await sql`UPDATE workspace SET archived_at = now()`
      await sql`UPDATE project SET archived_at = now()`
      await expect(enforce(sql)).rejects.toSatisfy(
        (error: unknown) => getPostgresErrorCode(error) === '55000'
      )
      await sql`UPDATE workflow SET archived_at = now()`
      await enforce(sql)
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
      await enforce(sql)
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
      await enforce(sql)
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
      await expect(enforce(sql)).rejects.toSatisfy(
        (error: unknown) => getPostgresErrorCode(error) === '55000'
      )
      const committed =
        await sql`SELECT project_id FROM workspace WHERE id = 'a-good' AND project_id IS NOT NULL`
      expect(committed).toHaveLength(1)
      expect(
        await sql`SELECT 1 FROM workspace WHERE id LIKE 'b-%' AND project_id IS NOT NULL`
      ).toHaveLength(0)
      expect(
        await sql`SELECT 1 FROM pg_trigger WHERE tgname = 'project_contract_check'`
      ).toHaveLength(0)
      await sql`UPDATE workspace SET organization_id = 'org' WHERE id = 'b-child'`
      await enforce(sql)
      expect(
        await sql`SELECT project_id FROM workspace WHERE id = 'a-good' AND project_id IS NOT NULL`
      ).toEqual(committed)
      expect(await sql`SELECT 1 FROM project`).toHaveLength(2)
      expect(await sql`SELECT 1 FROM workspace WHERE project_id IS NOT NULL`).toHaveLength(3)
    })
  })

  it('releases completed-family locks while a busy family retries and leaves unrelated writes available', async () => {
    await database(async (sql) => {
      await sql`INSERT INTO workspace (id, name, owner_id) VALUES ('a-complete', 'First', 'owner'), ('b-busy', 'Second', 'owner')`
      const locked = createDeferred<void>()
      const release = createDeferred<void>()
      const writer = sql.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock_shared(hashtextextended('project-backfill:b-busy', 0))`
        locked.resolve()
        await release.promise
        await tx`UPDATE workspace SET name = 'Updated before backfill' WHERE id = 'b-busy'`
      })
      await locked.promise
      const migrationResult = enforce(sql).then(
        () => null,
        (error: unknown) => error
      )
      try {
        let committed = false
        for (let attempt = 0; attempt < 100; attempt++) {
          if (
            (await sql`SELECT 1 FROM workspace WHERE id = 'a-complete' AND project_id IS NOT NULL`)
              .length
          ) {
            committed = true
            break
          }
          await sleep(10)
        }
        expect(committed).toBe(true)
        expect(
          await sql`SELECT 1 FROM workspace WHERE id = 'b-busy' AND project_id IS NOT NULL`
        ).toHaveLength(0)
        await sql.begin(async (tx) => {
          await tx`SET LOCAL statement_timeout = '500ms'`
          await tx`SELECT pg_advisory_xact_lock_shared(hashtextextended('project-backfill:a-complete', 0))`
          await tx`UPDATE workspace SET name = 'Unrelated live edit' WHERE id = 'a-complete'`
          await tx`INSERT INTO workflow VALUES ('live-workflow', 'a-complete', NULL)`
        })
      } finally {
        release.resolve()
        await writer
        await migrationResult
      }
      expect(await migrationResult).toBeNull()
      expect(
        (
          await sql`SELECT p.name FROM project p JOIN workspace w ON w.project_id = p.id WHERE w.id = 'b-busy'`
        )[0].name
      ).toBe('Updated before backfill - Project')
    })
  })

  it('re-discovers a fork added while the family is busy instead of committing partial membership', async () => {
    await database(async (sql) => {
      await sql`INSERT INTO workspace (id, name, owner_id) VALUES ('root', 'Root', 'owner')`
      const locked = createDeferred<void>()
      const release = createDeferred<void>()
      const writer = sql.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock_shared(hashtextextended('project-backfill:root', 0))`
        locked.resolve()
        await release.promise
        await tx`INSERT INTO workspace (id, name, owner_id, forked_from_workspace_id) VALUES ('new-child', 'Child', 'owner', 'root')`
      })
      await locked.promise
      const migrationResult = enforce(sql).then(
        () => null,
        (error: unknown) => error
      )
      try {
        let retrying = false
        for (let attempt = 0; attempt < 100; attempt++) {
          if (
            (
              await sql`SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND query LIKE '%CALL pg_temp.backfill_project_families%' AND wait_event = 'PgSleep'`
            ).length
          ) {
            retrying = true
            break
          }
          await sleep(10)
        }
        expect(retrying).toBe(true)
      } finally {
        release.resolve()
        await writer
        await migrationResult
      }
      expect(await migrationResult).toBeNull()
      expect(
        await sql`SELECT DISTINCT project_id FROM workspace WHERE project_id IS NOT NULL`
      ).toHaveLength(1)
      expect(await sql`SELECT 1 FROM workspace WHERE project_id IS NOT NULL`).toHaveLength(2)
    })
  })

  it.each([
    'cycle',
    'assigned-cycle',
    'split',
    'scope',
    'archive',
    'outside-family',
    'oversized',
  ] as const)(
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
          } else if (scenario === 'scope') {
            await sql`UPDATE project SET organization_id = 'org'`
          } else if (scenario === 'archive') {
            await sql`UPDATE project SET archived_at = now()`
          } else {
            await sql`INSERT INTO workspace (id, name, owner_id) VALUES ('outside', 'Outside', 'owner')`
            await sql`INSERT INTO project_workspace (project_id, workspace_id) VALUES ('existing', 'outside')`
          }
        }
        const before = await sql`SELECT id, project_id FROM workspace ORDER BY id`
        await expect(enforce(sql)).rejects.toSatisfy(
          (error: unknown) =>
            getPostgresErrorCode(error) === (scenario === 'oversized' ? '54000' : '55000')
        )
        expect(await sql`SELECT id, project_id FROM workspace ORDER BY id`).toEqual(before)
      })
    }
  )

  it('resumes after cancellation between committed families without retaining environment locks', async () => {
    await database(async (sql) => {
      await sql`INSERT INTO workspace (id, name, owner_id) VALUES ('a-first', 'First', 'owner'), ('b-busy', 'Busy', 'owner')`
      const locked = createDeferred<void>()
      const release = createDeferred<void>()
      const writer = sql.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock_shared(hashtextextended('project-backfill:b-busy', 0))`
        locked.resolve()
        await release.promise
      })
      await locked.promise
      const result = enforce(sql).then(
        () => null,
        (error: unknown) => error
      )
      let committed: string | undefined
      try {
        for (let attempt = 0; attempt < 100; attempt++) {
          const [row] =
            await sql`SELECT project_id FROM workspace WHERE id = 'a-first' AND project_id IS NOT NULL`
          if (row) {
            committed = row.project_id
            break
          }
          await sleep(10)
        }
        expect(committed).toBeTruthy()
        await sql`SELECT pg_cancel_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND query LIKE '%CALL pg_temp.backfill_project_families%'`
        expect(getPostgresErrorCode(await result)).toBe('57014')
      } finally {
        release.resolve()
        await writer
        await result
      }
      await enforce(sql)
      expect(
        (
          await sql`SELECT project_id FROM workspace WHERE id = 'a-first' AND project_id IS NOT NULL`
        )[0].project_id
      ).toBe(committed)
      expect(await sql`SELECT 1 FROM workspace WHERE project_id IS NOT NULL`).toHaveLength(2)
    })
  })

  it('backfills a representative multi-family dataset through independently committed batches', async () => {
    await database(async (sql) => {
      await sql`INSERT INTO workspace (id, name, owner_id) SELECT 'root-' || n, 'Environment ' || n, 'owner' FROM generate_series(1, 100) n`
      await sql`INSERT INTO workspace (id, name, owner_id, forked_from_workspace_id)
        SELECT 'child-' || r || '-' || n, 'Child', 'owner', 'root-' || r FROM generate_series(1, 100) r CROSS JOIN generate_series(1, 20) n`
      await enforce(sql)
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
  it('rolls back an overlong family while preserving earlier commits and safely resumes', async () => {
    await database(async (sql, url) => {
      await sql`INSERT INTO workspace (id, name, owner_id) VALUES ('a-fast', 'Fast', 'owner'), ('b-slow', 'Slow', 'owner')`
      await sql.unsafe(`
        CREATE FUNCTION delay_project_fixture() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.name = 'Slow - Project' THEN PERFORM pg_sleep(10); END IF;
          RETURN NEW;
        END; $$;
        CREATE TRIGGER delay_project_fixture BEFORE INSERT ON project FOR EACH ROW EXECUTE FUNCTION delay_project_fixture();
      `)
      const run = promisify(execFile)(
        'bun',
        [
          '--no-env-file',
          '-e',
          `
        import { readFile } from 'node:fs/promises';
        import { getPostgresErrorCode } from '@sim/utils/errors';
        import postgres from 'postgres';
        const sql = postgres(process.env.TEST_DATABASE_URL, { max: 1, onnotice: () => undefined });
        try {
          const migration = await readFile('migrations/0404_project_membership_enforcement.sql', 'utf8');
          for (const statement of migration.split('--> statement-breakpoint')) await sql.unsafe(statement);
          await sql.end();
        } catch (error) {
          process.stderr.write(getPostgresErrorCode(error) ?? 'unknown');
          process.exit(1);
        }
      `,
        ],
        {
          cwd: new URL('..', import.meta.url),
          env: { ...process.env, TEST_DATABASE_URL: url },
          timeout: 12000,
        }
      )
      await expect(run).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringMatching(/^(25P04|CONNECTION_CLOSED)$/),
      })
      const committed =
        await sql`SELECT project_id FROM workspace WHERE id = 'a-fast' AND project_id IS NOT NULL`
      expect(committed).toHaveLength(1)
      expect(
        await sql`SELECT 1 FROM workspace WHERE id = 'b-slow' AND project_id IS NOT NULL`
      ).toHaveLength(0)
      await sql`DROP TRIGGER delay_project_fixture ON project`
      await enforce(sql)
      expect(
        await sql`SELECT project_id FROM workspace WHERE id = 'a-fast' AND project_id IS NOT NULL`
      ).toEqual(committed)
      expect(await sql`SELECT 1 FROM workspace WHERE project_id IS NOT NULL`).toHaveLength(2)
    })
  }, 15000)
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
        await enforce(sql)
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
        await enforce(sql)
        expect(await sql`SELECT id, name FROM project`).toEqual([
          { id: 'existing', name: 'Keep this Project' },
        ])
      })
    }
  )
})
