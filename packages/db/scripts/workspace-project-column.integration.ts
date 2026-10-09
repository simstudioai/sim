import { readFileSync } from 'node:fs'
import { applyMigration, withMigrationSchema } from '@sim/db/scripts/migration-fixture'
import { getPostgresErrorCode } from '@sim/utils/errors'
import type postgres from 'postgres'
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

describe('workspace Project column compatibility migration', () => {
  it('preserves existing memberships and permits deployed writers that omit the column', async () => {
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
        { id: 'old-writer', project_id: null, membership: 'new-project', parent: null },
        { id: 'personal', project_id: null, membership: 'private', parent: null },
        { id: 'production', project_id: null, membership: 'family', parent: null },
        { id: 'staging', project_id: null, membership: 'family', parent: 'production' },
      ])
    })
  })

  it('allows old account teardown to delete a Project before its populated workspace', async () => {
    await fixture(async (sql) => {
      await applyMigration(sql, migration)
      await sql`UPDATE workspace w SET project_id = pw.project_id
        FROM project_workspace pw WHERE pw.workspace_id = w.id`

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
      await sql`UPDATE workspace w SET project_id = pw.project_id
        FROM project_workspace pw WHERE pw.workspace_id = w.id`
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
        await tx`INSERT INTO project_workspace VALUES ('family', 'new-fork')`
      })
      expect(
        await sql`SELECT count(*)::int AS count FROM workspace WHERE project_id = 'family'`
      ).toEqual([{ count: 3 }])
    })
  })
})
