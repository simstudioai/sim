import { readFileSync } from 'node:fs'
import { applyMigration, withMigrationSchema } from '@sim/db/scripts/migration-fixture'
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { getPostgresErrorCode } from '@sim/utils/errors'
import postgres from 'postgres'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL('../migrations/0403_workspace_project_column.sql', import.meta.url),
  'utf8'
)

async function fixture(run: (sql: postgres.Sql) => Promise<void>): Promise<void> {
  await withMigrationSchema('workspace_project_column', async (sql) => {
    await sql`CREATE TABLE project (id text PRIMARY KEY)`
    await sql`CREATE TABLE workspace (
      id text PRIMARY KEY,
      forked_from_workspace_id text REFERENCES workspace(id) ON DELETE SET NULL
    )`
    await sql`CREATE TABLE project_workspace (
      project_id text NOT NULL REFERENCES project(id) ON DELETE RESTRICT,
      workspace_id text NOT NULL UNIQUE REFERENCES workspace(id) ON DELETE CASCADE,
      PRIMARY KEY (project_id, workspace_id)
    )`
    await sql`INSERT INTO project VALUES ('family'), ('private')`
    await sql`INSERT INTO workspace VALUES ('production', NULL), ('staging', 'production'), ('personal', NULL)`
    await sql`INSERT INTO project_workspace VALUES
      ('family', 'production'), ('family', 'staging'), ('private', 'personal')`
    await run(sql)
  })
}

async function installBridgeBeforeCopy(sql: postgres.Sql): Promise<void> {
  for (const statement of migration.split('--> statement-breakpoint')) {
    if (statement.trim().startsWith('CALL pg_temp.copy_workspace_projects()')) return
    if (statement.trim()) await sql.unsafe(statement)
  }
  throw new Error('Migration has no Project copy entry point')
}

async function withConnections(
  sql: postgres.Sql,
  run: (writer: postgres.Sql, fork: postgres.Sql, observer: postgres.Sql) => Promise<void>
): Promise<void> {
  const [scope] = await sql<{ schema: string }[]>`SELECT current_schema() AS schema`
  if (!scope) throw new Error('Migration fixture has no current schema')
  const writer = postgres(readTestDatabaseUrl(), { max: 1, onnotice: () => {} })
  const fork = postgres(readTestDatabaseUrl(), { max: 1, onnotice: () => {} })
  const observer = postgres(readTestDatabaseUrl(), { max: 1, onnotice: () => {} })
  try {
    for (const connection of [writer, fork, observer]) {
      await connection`SET search_path = ${connection(scope.schema)}`
      await connection`SET statement_timeout = '10s'`
    }
    await run(writer, fork, observer)
  } finally {
    await Promise.all([writer.end(), fork.end(), observer.end()])
  }
}

async function backendPid(sql: postgres.Sql): Promise<number> {
  const [backend] = await sql<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`
  if (!backend) throw new Error('Migration fixture connection has no backend PID')
  return backend.pid
}

async function expectBlockedBy(
  observer: postgres.Sql,
  waitingPid: number,
  blockingPid: number
): Promise<void> {
  await expect
    .poll(
      async () => {
        const [state] = await observer<{ waiting: boolean }[]>`
      SELECT ${blockingPid} = ANY(pg_blocking_pids(${waitingPid})) AS waiting`
        return state?.waiting
      },
      { timeout: 5_000 }
    )
    .toBe(true)
}

describe('workspace Project column compatibility migration', () => {
  it('copies existing memberships and permits old workspace-before-Project creation', async () => {
    await fixture(async (sql) => {
      await applyMigration(sql, migration)

      await sql.begin(async (tx) => {
        await tx`INSERT INTO workspace (id) VALUES ('old-writer')`
        await tx`INSERT INTO project VALUES ('new-project')`
        await tx`INSERT INTO project_workspace VALUES ('new-project', 'old-writer')`
      })

      expect(
        await sql`SELECT w.id, w.project_id, pw.project_id AS membership, w.forked_from_workspace_id AS parent
          FROM workspace w JOIN project_workspace pw ON pw.workspace_id = w.id ORDER BY w.id`
      ).toEqual([
        { id: 'old-writer', project_id: 'new-project', membership: 'new-project', parent: null },
        { id: 'personal', project_id: 'private', membership: 'private', parent: null },
        { id: 'production', project_id: 'family', membership: 'family', parent: null },
        { id: 'staging', project_id: 'family', membership: 'family', parent: 'production' },
      ])
    })
  })

  it('mirrors old connector reassignment and removal while rejecting workspace identity changes', async () => {
    await fixture(async (sql) => {
      await applyMigration(sql, migration)
      await sql`INSERT INTO workspace (id) VALUES ('moved-target')`
      await sql`UPDATE project_workspace SET project_id = 'private' WHERE workspace_id = 'staging'`
      expect(await sql`SELECT project_id FROM workspace WHERE id = 'staging'`).toEqual([
        { project_id: 'private' },
      ])

      await expect(sql`UPDATE project_workspace SET workspace_id = 'moved-target'
        WHERE workspace_id = 'staging'`).rejects.toSatisfy(
        (error: unknown) => getPostgresErrorCode(error) === '55000'
      )
      expect(
        await sql`SELECT id, project_id FROM workspace WHERE id IN ('staging', 'moved-target') ORDER BY id`
      ).toEqual([
        { id: 'moved-target', project_id: null },
        { id: 'staging', project_id: 'private' },
      ])
      expect(
        await sql`SELECT project_id, workspace_id FROM project_workspace WHERE workspace_id = 'staging'`
      ).toEqual([{ project_id: 'private', workspace_id: 'staging' }])

      await sql`DELETE FROM project_workspace WHERE workspace_id = 'staging'`
      expect(await sql`SELECT project_id FROM workspace WHERE id = 'staging'`).toEqual([
        { project_id: null },
      ])
      expect(await sql`SELECT workspace_id FROM project_workspace ORDER BY workspace_id`).toEqual([
        { workspace_id: 'personal' },
        { workspace_id: 'production' },
      ])
    })
  })

  it('mirrors new column writes, fork detach and workspace cascades into old readers', async () => {
    await fixture(async (sql) => {
      await applyMigration(sql, migration)
      await sql`INSERT INTO workspace (id, project_id, forked_from_workspace_id)
        VALUES ('new-fork', 'family', 'production')`
      expect(
        await sql`SELECT project_id FROM project_workspace WHERE workspace_id = 'new-fork'`
      ).toEqual([{ project_id: 'family' }])
      await sql`UPDATE workspace SET project_id = 'private' WHERE id = 'new-fork'`
      expect(
        await sql`SELECT project_id FROM project_workspace WHERE workspace_id = 'new-fork'`
      ).toEqual([{ project_id: 'private' }])

      await sql`UPDATE workspace SET project_id = NULL, forked_from_workspace_id = NULL
        WHERE id = 'new-fork'`
      expect(
        await sql`SELECT workspace_id FROM project_workspace WHERE workspace_id = 'new-fork'`
      ).toEqual([])
      expect(
        await sql`SELECT project_id, forked_from_workspace_id FROM workspace WHERE id = 'new-fork'`
      ).toEqual([{ project_id: null, forked_from_workspace_id: null }])

      await sql`DELETE FROM workspace WHERE id = 'production'`
      expect(await sql`SELECT workspace_id FROM project_workspace ORDER BY workspace_id`).toEqual([
        { workspace_id: 'personal' },
        { workspace_id: 'staging' },
      ])
      expect(
        await sql`SELECT project_id, forked_from_workspace_id FROM workspace WHERE id = 'staging'`
      ).toEqual([{ project_id: 'family', forked_from_workspace_id: null }])
    })
  })

  it('rejects missing Projects atomically and rolls back both representations with the writer', async () => {
    await fixture(async (sql) => {
      await applyMigration(sql, migration)
      await expect(
        sql`INSERT INTO workspace (id, project_id) VALUES ('valid-new', 'family'), ('invalid-new', 'missing')`
      ).rejects.toSatisfy((error: unknown) => getPostgresErrorCode(error) === '23503')
      expect(await sql`SELECT id FROM workspace WHERE id IN ('valid-new', 'invalid-new')`).toEqual(
        []
      )
      expect(
        await sql`SELECT workspace_id FROM project_workspace WHERE workspace_id = 'valid-new'`
      ).toEqual([])

      await expect(
        sql.begin(async (tx) => {
          await tx`UPDATE workspace SET project_id = 'private' WHERE id = 'staging'`
          await tx`UPDATE workspace SET project_id = 'missing' WHERE id = 'production'`
        })
      ).rejects.toSatisfy((error: unknown) => getPostgresErrorCode(error) === '23503')
      expect(
        await sql`SELECT w.id, w.project_id, pw.project_id AS membership
          FROM workspace w JOIN project_workspace pw ON pw.workspace_id = w.id
          WHERE w.id IN ('production', 'staging') ORDER BY w.id`
      ).toEqual([
        { id: 'production', project_id: 'family', membership: 'family' },
        { id: 'staging', project_id: 'family', membership: 'family' },
      ])
    })
  })

  it('replays without restoring a detached fork or overwriting a newer Project assignment', async () => {
    await fixture(async (sql) => {
      await applyMigration(sql, migration)
      await sql`UPDATE workspace SET project_id = 'private' WHERE id = 'production'`
      await sql`UPDATE workspace SET project_id = NULL, forked_from_workspace_id = NULL
        WHERE id = 'staging'`

      await applyMigration(sql, migration)
      await applyMigration(sql, migration)

      expect(
        await sql`SELECT w.id, w.project_id, pw.project_id AS membership, w.forked_from_workspace_id AS parent
          FROM workspace w LEFT JOIN project_workspace pw ON pw.workspace_id = w.id ORDER BY w.id`
      ).toEqual([
        { id: 'personal', project_id: 'private', membership: 'private', parent: null },
        { id: 'production', project_id: 'private', membership: 'private', parent: null },
        { id: 'staging', project_id: null, membership: null, parent: null },
      ])

      await sql`INSERT INTO project_workspace VALUES ('family', 'staging')`
      expect(await sql`SELECT project_id FROM workspace WHERE id = 'staging'`).toEqual([
        { project_id: 'family' },
      ])
    })
  })

  it('commits bounded copy batches, retains completed work on failure and safely resumes', async () => {
    await fixture(async (sql) => {
      await sql`ALTER TABLE workspace ADD COLUMN project_id text`
      await sql`INSERT INTO workspace (id)
        SELECT 'batch-' || lpad(n::text, 4, '0') FROM generate_series(1, 251) n`
      await sql`INSERT INTO project_workspace (project_id, workspace_id)
        SELECT 'family', id FROM workspace WHERE id LIKE 'batch-%'`
      await sql`CREATE TABLE copy_commit_audit (workspace_id text PRIMARY KEY, transaction_id bigint NOT NULL)`
      await sql.unsafe(`CREATE FUNCTION record_copy_transaction() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.project_id IS NOT NULL AND OLD.project_id IS DISTINCT FROM NEW.project_id THEN
            INSERT INTO copy_commit_audit VALUES (NEW.id, txid_current()) ON CONFLICT DO NOTHING;
          END IF;
          RETURN NEW;
        END;
        $$`)
      await sql`CREATE TRIGGER record_copy_transaction AFTER UPDATE OF project_id ON workspace
        FOR EACH ROW EXECUTE FUNCTION record_copy_transaction()`
      await sql`ALTER TABLE workspace ADD CONSTRAINT reject_later_copy
        CHECK (id <> 'batch-0201' OR project_id IS NULL)`

      await expect(applyMigration(sql, migration)).rejects.toSatisfy(
        (error: unknown) => getPostgresErrorCode(error) === '23514'
      )
      expect(
        await sql`SELECT count(*)::int AS count FROM workspace WHERE project_id IS NOT NULL`
      ).toEqual([{ count: 200 }])
      expect(
        await sql`SELECT count(*)::int AS count FROM copy_commit_audit GROUP BY transaction_id ORDER BY transaction_id`
      ).toEqual([{ count: 100 }, { count: 100 }])
      expect(await sql`SELECT project_id FROM workspace WHERE id = 'batch-0201'`).toEqual([
        { project_id: null },
      ])

      await sql`ALTER TABLE workspace DROP CONSTRAINT reject_later_copy`
      await sql`UPDATE project_workspace SET project_id = 'private' WHERE workspace_id = 'batch-0001'`
      await sql`DELETE FROM project_workspace WHERE workspace_id = 'batch-0002'`
      await applyMigration(sql, migration)
      await applyMigration(sql, migration)

      expect(
        await sql`SELECT w.id, w.project_id, pw.project_id AS membership FROM workspace w
          LEFT JOIN project_workspace pw ON pw.workspace_id = w.id
          WHERE w.id IN ('batch-0001', 'batch-0002', 'batch-0201', 'batch-0251') ORDER BY w.id`
      ).toEqual([
        { id: 'batch-0001', project_id: 'private', membership: 'private' },
        { id: 'batch-0002', project_id: null, membership: null },
        { id: 'batch-0201', project_id: 'family', membership: 'family' },
        { id: 'batch-0251', project_id: 'family', membership: 'family' },
      ])
      expect(
        await sql`SELECT count(*)::int AS count FROM workspace w
          LEFT JOIN project_workspace pw ON pw.workspace_id = w.id
          WHERE w.project_id IS DISTINCT FROM pw.project_id`
      ).toEqual([{ count: 0 }])
      expect(
        await sql`SELECT count(*)::int AS count FROM copy_commit_audit GROUP BY transaction_id ORDER BY transaction_id`
      ).toEqual([{ count: 100 }, { count: 100 }, { count: 54 }])
    })
  })

  it.each([
    { change: 'legacy reassignment', projectId: 'private' },
    { change: 'legacy removal', projectId: null },
  ])(
    'preserves $change and a waiting fork detach during concurrent copy',
    async ({ projectId }) => {
      await fixture(async (sql) => {
        await installBridgeBeforeCopy(sql)
        await sql`UPDATE workspace SET project_id = 'family' WHERE id = 'staging'`
        await withConnections(sql, async (writer, fork, observer) => {
          const writerPid = await backendPid(writer)
          const forkPid = await backendPid(fork)
          const copyPid = await backendPid(sql)
          let forkLock: Promise<void> | undefined
          let copy: Promise<void> | undefined
          await writer.unsafe('BEGIN')
          await fork.unsafe('BEGIN')
          try {
            await writer`SELECT pg_advisory_xact_lock(hashtextextended('project:family', 0))`
            if (projectId === null) {
              await writer`DELETE FROM project_workspace WHERE workspace_id = 'production'`
            } else {
              await writer`UPDATE project_workspace SET project_id = ${projectId}
              WHERE workspace_id = 'production'`
            }
            forkLock =
              fork`SELECT pg_advisory_xact_lock(hashtextextended('project:family', 0))`.then(
                () => undefined
              )
            void forkLock.catch(() => undefined)
            await expectBlockedBy(observer, forkPid, writerPid)

            copy = sql.unsafe('CALL pg_temp.copy_workspace_projects()').then(() => undefined)
            void copy.catch(() => undefined)
            await expect
              .poll(
                async () => {
                  const [activity] = await observer<{ wait_event: string | null }[]>`
              SELECT wait_event FROM pg_stat_activity WHERE pid = ${copyPid}`
                  return activity?.wait_event
                },
                { timeout: 5_000 }
              )
              .toBe('PgSleep')

            await writer.unsafe('COMMIT')
            await forkLock
            await fork`UPDATE workspace SET project_id = NULL, forked_from_workspace_id = NULL
            WHERE id = 'staging'`
            await fork.unsafe('COMMIT')
            await copy

            expect(
              await observer`SELECT w.id, w.project_id, pw.project_id AS membership,
              w.forked_from_workspace_id AS parent FROM workspace w
              LEFT JOIN project_workspace pw ON pw.workspace_id = w.id
              WHERE w.id IN ('production', 'staging') ORDER BY w.id`
            ).toEqual([
              { id: 'production', project_id: projectId, membership: projectId, parent: null },
              { id: 'staging', project_id: null, membership: null, parent: null },
            ])
          } finally {
            await writer.unsafe('ROLLBACK')
            await forkLock?.catch(() => undefined)
            await fork.unsafe('ROLLBACK')
            await copy?.catch(() => undefined)
          }
        })
      })
    }
  )

  it('allows old account teardown to delete a Project before its populated workspace', async () => {
    await fixture(async (sql) => {
      await applyMigration(sql, migration)

      await sql.begin(async (tx) => {
        await tx`DELETE FROM project_workspace WHERE project_id = 'private'`
        await tx`DELETE FROM project WHERE id = 'private'`
        await tx`DELETE FROM workspace WHERE id = 'personal'`
      })

      expect(await sql`SELECT id, project_id FROM workspace ORDER BY id`).toEqual([
        { id: 'production', project_id: 'family' },
        { id: 'staging', project_id: 'family' },
      ])
      expect(await sql`SELECT id FROM project`).toEqual([{ id: 'family' }])
      expect(await sql`SELECT workspace_id FROM project_workspace ORDER BY workspace_id`).toEqual([
        { workspace_id: 'production' },
        { workspace_id: 'staging' },
      ])
    })
  })

  it('repairs an interrupted concurrent index build on replay without changing Project assignments', async () => {
    await fixture(async (sql) => {
      await applyMigration(sql, migration)
      await sql`DROP INDEX CONCURRENTLY workspace_project_id_id_idx`
      await expect(
        sql`CREATE UNIQUE INDEX CONCURRENTLY workspace_project_id_id_idx ON workspace(project_id)`
      ).rejects.toSatisfy((error: unknown) => getPostgresErrorCode(error) === '23505')
      expect(
        await sql`SELECT indisvalid FROM pg_index
          WHERE indexrelid = 'workspace_project_id_id_idx'::regclass`
      ).toEqual([{ indisvalid: false }])

      await applyMigration(sql, migration)
      await applyMigration(sql, migration)

      expect(
        await sql`SELECT indisvalid, indisunique FROM pg_index
          WHERE indexrelid = 'workspace_project_id_id_idx'::regclass`
      ).toEqual([{ indisvalid: true, indisunique: false }])
      expect(await sql`SELECT id, project_id FROM workspace ORDER BY id`).toEqual([
        { id: 'personal', project_id: 'private' },
        { id: 'production', project_id: 'family' },
        { id: 'staging', project_id: 'family' },
      ])
      await sql.begin(async (tx) => {
        await tx`INSERT INTO workspace (id, project_id, forked_from_workspace_id)
          VALUES ('new-fork', 'family', 'production')`
      })
      expect(
        await sql`SELECT count(*)::int AS count FROM workspace WHERE project_id = 'family'`
      ).toEqual([{ count: 3 }])
    })
  })
})
