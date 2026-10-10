import { readFileSync } from 'node:fs'
import { applyMigration, withMigrationSchema } from '@sim/db/scripts/migration-fixture'
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { getPostgresErrorCode } from '@sim/utils/errors'
import postgres from 'postgres'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL('../migrations/0405_workspace_project_column.sql', import.meta.url),
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

describe('workspace Project column compatibility migration', () => {
  it('leaves legacy rows unassigned and accepts old workspace-before-Project creation', async () => {
    await fixture(async (sql) => {
      await applyMigration(sql, migration)
      expect(await sql`SELECT id, phase FROM project_membership_rollout`).toEqual([
        { id: 'membership', phase: 'connector' },
      ])
      await sql.begin(async (tx) => {
        await tx`INSERT INTO workspace (id) VALUES ('old-writer')`
        await tx`INSERT INTO project VALUES ('new-project')`
        await tx`INSERT INTO project_workspace VALUES ('new-project', 'old-writer')`
      })
      expect(await sql`SELECT id, project_id FROM workspace ORDER BY id`).toEqual([
        { id: 'old-writer', project_id: null },
        { id: 'personal', project_id: null },
        { id: 'production', project_id: null },
        { id: 'staging', project_id: null },
      ])
      expect(
        await sql`SELECT project_id FROM project_workspace WHERE workspace_id = 'old-writer'`
      ).toEqual([{ project_id: 'new-project' }])
    })
  })

  it('new column writes do not create or overwrite legacy connector assignments', async () => {
    await fixture(async (sql) => {
      await applyMigration(sql, migration)
      await sql`UPDATE project_membership_rollout SET phase = 'column' WHERE id = 'membership'`
      await sql`INSERT INTO workspace (id, project_id) VALUES ('new-writer', 'private')`
      await sql`UPDATE workspace SET project_id = 'private', forked_from_workspace_id = NULL
        WHERE id = 'staging'`
      expect(
        await sql`SELECT project_id, workspace_id FROM project_workspace ORDER BY workspace_id`
      ).toEqual([
        { project_id: 'private', workspace_id: 'personal' },
        { project_id: 'family', workspace_id: 'production' },
        { project_id: 'family', workspace_id: 'staging' },
      ])
      await sql`UPDATE project_workspace SET project_id = 'family' WHERE workspace_id = 'personal'`
      expect(await sql`SELECT project_id FROM workspace WHERE id = 'personal'`).toEqual([
        { project_id: null },
      ])
    })
  })

  it('rejects dangling assignments and deletion of Projects with surviving column memberships', async () => {
    await fixture(async (sql) => {
      await applyMigration(sql, migration)
      await sql`UPDATE project_membership_rollout SET phase = 'column' WHERE id = 'membership'`
      await expect(
        sql`INSERT INTO workspace (id, project_id) VALUES ('invalid', 'missing')`
      ).rejects.toSatisfy((error: unknown) => getPostgresErrorCode(error) === '23503')
      await sql`INSERT INTO project VALUES ('column-only')`
      await sql`INSERT INTO workspace (id, project_id) VALUES ('new-writer', 'column-only')`
      await expect(
        sql.begin(async (tx) => {
          await tx`DELETE FROM project_workspace WHERE project_id = 'column-only'`
          await tx`DELETE FROM project WHERE id = 'column-only'`
        })
      ).rejects.toSatisfy((error: unknown) => getPostgresErrorCode(error) === '23503')
      expect(await sql`SELECT id FROM project WHERE id = 'column-only'`).toEqual([
        { id: 'column-only' },
      ])
      expect(await sql`SELECT project_id FROM workspace WHERE id = 'new-writer'`).toEqual([
        { project_id: 'column-only' },
      ])
    })
  })

  it('keeps old teardown valid for untouched legacy workspaces', async () => {
    await fixture(async (sql) => {
      await applyMigration(sql, migration)
      await sql.begin(async (tx) => {
        await tx`DELETE FROM project_workspace WHERE project_id = 'private'`
        await tx`DELETE FROM project WHERE id = 'private'`
        await tx`DELETE FROM workspace WHERE id = 'personal'`
      })
      expect(await sql`SELECT id, project_id FROM workspace ORDER BY id`).toEqual([
        { id: 'production', project_id: null },
        { id: 'staging', project_id: null },
      ])
    })
  })

  it('replays without copying stale legacy assignments over columns or detached forks', async () => {
    await fixture(async (sql) => {
      await applyMigration(sql, migration)
      await sql`UPDATE project_membership_rollout SET phase = 'column' WHERE id = 'membership'`
      await sql`UPDATE workspace SET project_id = 'private', forked_from_workspace_id = NULL
        WHERE id = 'staging'`
      await applyMigration(sql, migration)
      await applyMigration(sql, migration)
      expect(await sql`SELECT phase FROM project_membership_rollout`).toEqual([{ phase: 'column' }])
      expect(
        await sql`SELECT w.id, w.project_id, pw.project_id AS legacy,
        w.forked_from_workspace_id AS parent FROM workspace w
        JOIN project_workspace pw ON pw.workspace_id = w.id ORDER BY w.id`
      ).toEqual([
        { id: 'personal', project_id: null, legacy: 'private', parent: null },
        { id: 'production', project_id: null, legacy: 'family', parent: null },
        { id: 'staging', project_id: 'private', legacy: 'family', parent: null },
      ])
    })
  })

  it('refuses to initialize missing authority over populated columns', async () => {
    await fixture(async (sql) => {
      await sql`ALTER TABLE workspace ADD COLUMN project_id text`
      await sql`UPDATE workspace SET project_id = 'family' WHERE id = 'production'`
      await expect(applyMigration(sql, migration)).rejects.toSatisfy(
        (error: unknown) => getPostgresErrorCode(error) === '55000'
      )
      await sql.unsafe('ROLLBACK')
      expect(await sql`SELECT project_id FROM workspace WHERE id = 'production'`).toEqual([
        { project_id: 'family' },
      ])
      expect(await sql`SELECT to_regclass('project_membership_rollout') AS marker`).toEqual([
        { marker: null },
      ])
    })
  })

  it('refuses a busy expansion immediately without blocking unrelated writes', async () => {
    await fixture(async (sql) => {
      const [scope] = await sql<{ schema: string }[]>`SELECT current_schema() AS schema`
      const writer = postgres(readTestDatabaseUrl(), { max: 1 })
      try {
        await writer`SET search_path = ${writer(scope.schema)}`
        await writer.unsafe('BEGIN')
        await writer`UPDATE workspace SET forked_from_workspace_id = NULL WHERE id = 'personal'`
        await expect(applyMigration(sql, migration)).rejects.toSatisfy(
          (error: unknown) => getPostgresErrorCode(error) === '55P03'
        )
        await sql.unsafe('ROLLBACK')
        await sql`INSERT INTO workspace (id) VALUES ('unblocked-writer')`
      } finally {
        await writer.unsafe('ROLLBACK')
        await writer.end()
      }
      await applyMigration(sql, migration)
      expect(await sql`SELECT project_id FROM workspace WHERE id = 'unblocked-writer'`).toEqual([
        { project_id: null },
      ])
    })
  })

  it('repairs an interrupted index build without changing assignments', async () => {
    await fixture(async (sql) => {
      await applyMigration(sql, migration)
      await sql`UPDATE project_membership_rollout SET phase = 'column' WHERE id = 'membership'`
      await sql`UPDATE workspace SET project_id = 'family' WHERE id IN ('production', 'staging')`
      await sql`DROP INDEX CONCURRENTLY workspace_project_id_id_idx`
      await expect(
        sql`CREATE UNIQUE INDEX CONCURRENTLY workspace_project_id_id_idx ON workspace(project_id)`
      ).rejects.toSatisfy((error: unknown) => getPostgresErrorCode(error) === '23505')
      await applyMigration(sql, migration)
      expect(
        await sql`SELECT indisvalid, indisunique FROM pg_index
        WHERE indexrelid = 'workspace_project_id_id_idx'::regclass`
      ).toEqual([{ indisvalid: true, indisunique: false }])
      expect(await sql`SELECT id, project_id FROM workspace ORDER BY id`).toEqual([
        { id: 'personal', project_id: null },
        { id: 'production', project_id: 'family' },
        { id: 'staging', project_id: 'family' },
      ])
    })
  })
})
