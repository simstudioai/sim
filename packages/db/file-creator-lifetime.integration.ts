import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const databaseUrl = readTestDatabaseUrl()
const migrations = [
  '0398_file_entity_ownership.sql',
  '0399_file_folder_version_ownership.sql',
  '0400_file_creator_lifetime.sql',
].map((name) => readFileSync(new URL(`./migrations/${name}`, import.meta.url), 'utf8'))
const checks: { name: string; status: 'passed' | 'failed'; durationMs: number; error?: string }[] =
  []
function check(name: string, run: () => Promise<void>) {
  it(name, async () => {
    const started = performance.now()
    try {
      await run()
      checks.push({ name, status: 'passed', durationMs: performance.now() - started })
    } catch (error) {
      checks.push({
        name,
        status: 'failed',
        durationMs: performance.now() - started,
        error: getErrorMessage(error),
      })
      throw error
    }
  })
}

describe('Shared file creator lifetime in PostgreSQL', () => {
  const schemaName = `file_creator_${generateId().replaceAll('-', '')}`
  let sql: Sql
  let admin: Sql
  async function applyMigration(migration: string) {
    for (const statement of migration.split('--> statement-breakpoint')) {
      if (statement.trim()) await sql.unsafe(statement)
    }
  }
  async function waitForDatabaseLock(pid: number) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const [state] = await sql<{ waiting: boolean }[]>`SELECT EXISTS (
        SELECT 1 FROM pg_stat_activity WHERE pid = ${pid} AND wait_event_type = 'Lock'
      ) AS waiting`
      if (state.waiting) return
      await sleep(10)
    }
    throw new Error('Creator operation did not wait for its database lock')
  }
  beforeAll(async () => {
    admin = postgres(databaseUrl, { max: 1, onnotice: () => undefined })
    await admin.unsafe(`CREATE SCHEMA "${schemaName}"`)
    sql = postgres(databaseUrl, {
      max: 3,
      onnotice: () => undefined,
      connection: { search_path: schemaName, TimeZone: 'UTC' },
    })
    await sql`CREATE TABLE "user" (id text PRIMARY KEY)`
    await sql`CREATE TABLE workspace (id text PRIMARY KEY)`
    await sql`CREATE TABLE organization (id text PRIMARY KEY)`
    await sql`CREATE TABLE project (
      id text PRIMARY KEY, name text NOT NULL DEFAULT 'Project',
      owner_id text NOT NULL DEFAULT 'user-b' REFERENCES "user"(id) ON DELETE RESTRICT,
      updated_at timestamp NOT NULL DEFAULT '2026-10-03 01:02:03.456'
    )`
    await sql`CREATE TABLE folder (
      id text PRIMARY KEY, name text NOT NULL,
      user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      workspace_id text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
      resource_type text NOT NULL DEFAULT 'workflow',
      parent_id text REFERENCES folder(id) ON DELETE SET NULL,
      deleted_at timestamp
    )`
    await sql`CREATE UNIQUE INDEX folder_workspace_resource_parent_name_active_unique
      ON folder(workspace_id, resource_type, coalesce(parent_id, ''), name)
      WHERE deleted_at IS NULL`
    await sql`CREATE TABLE workspace_files (
      id text PRIMARY KEY, context text NOT NULL,
      user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      workspace_id text REFERENCES workspace(id) ON DELETE CASCADE,
      organization_id text REFERENCES organization(id) ON DELETE CASCADE,
      folder_id text REFERENCES folder(id) ON DELETE SET NULL,
      chat_id text, original_name text NOT NULL DEFAULT 'document.md',
      key text NOT NULL DEFAULT 'unchanged-object-key', deleted_at timestamp,
      content_updated_at timestamp NOT NULL DEFAULT '2026-10-03 01:02:03.456',
      secret_provenance_version integer DEFAULT 1
    )`
    await sql`CREATE UNIQUE INDEX workspace_files_workspace_folder_name_active_unique
      ON workspace_files(workspace_id, coalesce(folder_id, ''), original_name)
      WHERE deleted_at IS NULL AND context = 'workspace'`
    await sql`CREATE TABLE workspace_file_version (
      id text PRIMARY KEY, file_id text NOT NULL REFERENCES workspace_files(id) ON DELETE CASCADE,
      workspace_id text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
      version integer NOT NULL DEFAULT 1, key text NOT NULL DEFAULT 'unchanged-version-key',
      author_user_ids text[] NOT NULL DEFAULT '{}'::text[], UNIQUE(file_id, version)
    )`
    for (const migration of migrations) await applyMigration(migration)
  })

  beforeEach(async () => {
    await sql`TRUNCATE workspace_file_version, workspace_files, folder, project, workspace, organization, "user"`
    await sql`INSERT INTO "user" VALUES ('user-a'), ('user-b')`
    await sql`INSERT INTO workspace VALUES ('workspace-a'), ('workspace-b'), ('same-id')`
    await sql`INSERT INTO organization VALUES ('organization-a')`
    await sql`INSERT INTO project (id) VALUES ('project-a'), ('project-b'), ('same-id')`
  })

  afterAll(async () => {
    try {
      await sql?.end()
      await admin?.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
    } finally {
      await admin?.end()
      const reportPath = process.env.FILE_CREATOR_LIFETIME_REPORT_PATH
      if (reportPath) {
        await mkdir(dirname(reportPath), { recursive: true })
        await writeFile(reportPath, JSON.stringify({ checks }, null, 2))
      }
    }
  })

  check(
    'creator deletion preserves Project folders, heads and history with a nullable creator',
    async () => {
      await sql`INSERT INTO folder (id, name, user_id, resource_type, project_id)
      VALUES ('folder', 'Docs', 'user-a', 'file', 'project-a')`
      await sql`INSERT INTO workspace_files (id, context, user_id, project_id, folder_id)
      VALUES ('file', 'project', 'user-a', 'project-a', 'folder')`
      await sql`INSERT INTO workspace_file_version (id, file_id, author_user_ids)
      VALUES ('version', 'file', ARRAY['user-a'])`
      const [before] =
        await sql`SELECT key, content_updated_at, secret_provenance_version FROM workspace_files`
      await sql`DELETE FROM "user" WHERE id = 'user-a'`
      expect(await sql`SELECT user_id, project_id FROM workspace_files`).toEqual([
        { user_id: null, project_id: 'project-a' },
      ])
      expect(await sql`SELECT user_id, project_id FROM folder`).toEqual([
        { user_id: null, project_id: 'project-a' },
      ])
      expect(
        (
          await sql`SELECT key, content_updated_at, secret_provenance_version FROM workspace_files`
        )[0]
      ).toEqual(before)
      expect(await sql`SELECT key, author_user_ids FROM workspace_file_version`).toEqual([
        { key: 'unchanged-version-key', author_user_ids: ['user-a'] },
      ])
    }
  )

  check('workspace creator deletion preserves durable files, folders and history', async () => {
    await sql`INSERT INTO folder (id, name, user_id, workspace_id, resource_type)
      VALUES ('folder', 'Docs', 'user-a', 'workspace-a', 'file')`
    await sql`INSERT INTO workspace_files (id, context, user_id, workspace_id, folder_id)
      VALUES ('file', 'workspace', 'user-a', 'workspace-a', 'folder')`
    await sql`INSERT INTO workspace_file_version (id, file_id) VALUES ('version', 'file')`
    await sql`DELETE FROM "user" WHERE id = 'user-a'`
    expect(await sql`SELECT id, user_id FROM workspace_files`).toEqual([
      { id: 'file', user_id: null },
    ])
    expect(await sql`SELECT id, user_id FROM folder`).toEqual([{ id: 'folder', user_id: null }])
    expect(await sql`SELECT id FROM workspace_file_version`).toEqual([{ id: 'version' }])
  })

  check('other file contexts and folder types retain creator cascades', async () => {
    for (const context of [
      'mothership',
      'chat',
      'execution',
      'knowledge-base',
      'workspace-logos',
      'copilot',
      'profile-pictures',
      'general',
    ]) {
      await sql`INSERT INTO workspace_files (id, context, user_id, workspace_id)
        VALUES (${context}, ${context}, 'user-a', ${['copilot', 'profile-pictures', 'general'].includes(context) ? null : 'workspace-a'})`
    }
    await sql`INSERT INTO folder (id, name, user_id, workspace_id, resource_type)
      VALUES ('workflow', 'Workflows', 'user-a', 'workspace-a', 'workflow')`
    await sql`DELETE FROM "user" WHERE id = 'user-a'`
    expect(await sql`SELECT id FROM workspace_files`).toEqual([])
    expect(await sql`SELECT id FROM folder`).toEqual([])
  })

  check('new resources require a live creator in either scope', async () => {
    for (const context of ['workspace', 'project']) {
      for (const userId of [null, 'missing-user']) {
        await expect(sql`INSERT INTO workspace_files (id, context, user_id, workspace_id, project_id)
          VALUES ('missing', ${context}, ${userId}, ${context === 'workspace' ? 'workspace-a' : null}, ${context === 'project' ? 'project-a' : null})`).rejects.toMatchObject(
          { code: userId === null ? '23514' : '23503' }
        )
        await expect(sql`INSERT INTO folder (id, name, user_id, resource_type, workspace_id, project_id)
          VALUES ('missing', 'Docs', ${userId}, 'file', ${context === 'workspace' ? 'workspace-a' : null}, ${context === 'project' ? 'project-a' : null})`).rejects.toMatchObject(
          { code: userId === null ? '23514' : '23503' }
        )
      }
    }
  })

  check(
    'surviving workspace content remains editable without claiming creator attribution',
    async () => {
      await sql`INSERT INTO workspace_files (id, context, user_id, workspace_id)
      VALUES ('file', 'workspace', 'user-a', 'workspace-a')`
      await sql`DELETE FROM "user" WHERE id = 'user-a'`
      await sql`UPDATE workspace_files SET key = 'edited-content' WHERE id = 'file'`
      expect(await sql`SELECT user_id, key FROM workspace_files`).toEqual([
        { user_id: null, key: 'edited-content' },
      ])
      await sql`DELETE FROM workspace WHERE id = 'workspace-a'`
      expect(await sql`SELECT id FROM workspace_files`).toEqual([])
    }
  )

  check(
    'retained Project owner deletion stays fail-closed and rolls back creator cleanup',
    async () => {
      await sql`UPDATE project SET owner_id = 'user-a' WHERE id = 'project-a'`
      await sql`INSERT INTO workspace_files (id, context, user_id, project_id)
      VALUES ('file', 'project', 'user-a', 'project-a')`
      await expect(sql`DELETE FROM "user" WHERE id = 'user-a'`).rejects.toMatchObject({
        code: '23503',
      })
      expect((await sql`SELECT user_id FROM workspace_files`)[0]).toEqual({ user_id: 'user-a' })
      await expect(sql`DELETE FROM project WHERE id = 'project-a'`).rejects.toMatchObject({
        code: '23503',
      })
    }
  )

  for (const context of ['workspace', 'project'] as const) {
    for (const isolation of ['read committed', 'repeatable read'] as const) {
      check(
        `queued ${isolation} creator deletion preserves a committed concurrent ${context} file or retries`,
        async () => {
          const snapshot = createDeferred<void>()
          const startDelete = createDeferred<void>()
          const deletePid = createDeferred<number>()
          const inserted = createDeferred<void>()
          const releaseInsert = createDeferred<void>()
          const deletion = sql.begin(`isolation level ${isolation}`, async (tx) => {
            const [connection] = await tx`SELECT pg_backend_pid() AS pid, count(*) FROM "user"`
            deletePid.resolve(connection.pid)
            snapshot.resolve()
            await startDelete.promise
            await tx`DELETE FROM "user" WHERE id = 'user-a'`
          })
          const deletionOutcome = deletion.then(
            () => ({ code: null }),
            (error: unknown) => ({ code: (error as { code: string }).code })
          )
          await snapshot.promise
          const insertion = sql.begin(async (tx) => {
            await tx`INSERT INTO workspace_files (id, context, user_id, workspace_id, project_id)
          VALUES ('file', ${context}, 'user-a', ${context === 'workspace' ? 'workspace-a' : null}, ${context === 'project' ? 'project-a' : null})`
            inserted.resolve()
            await releaseInsert.promise
          })
          await Promise.race([insertion, inserted.promise])
          startDelete.resolve()
          try {
            await waitForDatabaseLock(await deletePid.promise)
          } finally {
            releaseInsert.resolve()
          }
          await insertion
          const outcome = await deletionOutcome
          expect(outcome.code).toBe(isolation === 'repeatable read' ? '40001' : null)
          expect((await sql`SELECT user_id FROM workspace_files`)[0]).toEqual({
            user_id: isolation === 'repeatable read' ? 'user-a' : null,
          })
        }
      )
    }

    check(
      `a ${context} insert queued behind creator deletion cannot resurrect a missing creator`,
      async () => {
        const deleted = createDeferred<void>()
        const releaseDelete = createDeferred<void>()
        const insertPid = createDeferred<number>()
        const deletion = sql.begin(async (tx) => {
          await tx`DELETE FROM "user" WHERE id = 'user-a'`
          deleted.resolve()
          await releaseDelete.promise
        })
        await Promise.race([deletion, deleted.promise])
        const insertion = sql.begin(async (tx) => {
          const [connection] = await tx`SELECT pg_backend_pid() AS pid`
          insertPid.resolve(connection.pid)
          await tx`INSERT INTO workspace_files (id, context, user_id, workspace_id, project_id)
          VALUES ('file', ${context}, 'user-a', ${context === 'workspace' ? 'workspace-a' : null}, ${context === 'project' ? 'project-a' : null})`
        })
        const insertionOutcome = insertion.then(
          () => ({ code: null }),
          (error: unknown) => ({ code: (error as { code: string }).code })
        )
        try {
          await waitForDatabaseLock(await insertPid.promise)
        } finally {
          releaseDelete.resolve()
        }
        await deletion
        expect((await insertionOutcome).code).toBe('23503')
        expect(await sql`SELECT id FROM workspace_files`).toHaveLength(0)
      }
    )
    check(
      `${context} content write racing creator deletion retains the committed content`,
      async () => {
        await sql`INSERT INTO workspace_files (id, context, user_id, workspace_id, project_id)
        VALUES ('file', ${context}, 'user-a', ${context === 'workspace' ? 'workspace-a' : null}, ${context === 'project' ? 'project-a' : null})`
        const updated = createDeferred<void>()
        const releaseUpdate = createDeferred<void>()
        const deletePid = createDeferred<number>()
        const update = sql.begin(async (tx) => {
          await tx`UPDATE workspace_files SET key = 'committed-content' WHERE id = 'file'`
          updated.resolve()
          await releaseUpdate.promise
        })
        await Promise.race([update, updated.promise])
        const deletion = sql.begin(async (tx) => {
          const [connection] = await tx`SELECT pg_backend_pid() AS pid`
          deletePid.resolve(connection.pid)
          await tx`DELETE FROM "user" WHERE id = 'user-a'`
        })
        try {
          await waitForDatabaseLock(await deletePid.promise)
        } finally {
          releaseUpdate.resolve()
        }
        await Promise.all([update, deletion])
        expect(await sql`SELECT user_id, key FROM workspace_files`).toEqual([
          { user_id: null, key: 'committed-content' },
        ])
      }
    )
  }
})
