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
  '0396_file_entity_ownership.sql',
  '0397_file_folder_version_ownership.sql',
  '0398_file_creator_lifetime.sql',
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

describe('Project creator lifetime in PostgreSQL', () => {
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
    'creator deletion preserves Project folders, heads, history and immutable attribution',
    async () => {
      await sql`INSERT INTO folder (id, name, user_id, resource_type, entity_type, entity_id)
      VALUES ('folder', 'Docs', 'user-a', 'file', 'project', 'project-a')`
      await sql`INSERT INTO workspace_files (id, context, user_id, entity_type, entity_id, folder_id)
      VALUES ('file', 'project', 'user-a', 'project', 'project-a', 'folder')`
      await sql`INSERT INTO workspace_file_version (id, file_id, author_user_ids)
      VALUES ('version', 'file', ARRAY['user-a'])`
      const [before] =
        await sql`SELECT key, content_updated_at, secret_provenance_version FROM workspace_files`
      await sql`DELETE FROM "user" WHERE id = 'user-a'`
      expect(
        await sql`SELECT user_id, original_creator_user_id, entity_id FROM workspace_files`
      ).toEqual([{ user_id: null, original_creator_user_id: 'user-a', entity_id: 'project-a' }])
      expect(await sql`SELECT user_id, original_creator_user_id, entity_id FROM folder`).toEqual([
        { user_id: null, original_creator_user_id: 'user-a', entity_id: 'project-a' },
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

  check(
    'legacy workspace and personal creator cascades still remove only their own rows',
    async () => {
      await sql`INSERT INTO folder (id, name, user_id, workspace_id, resource_type)
      VALUES ('folder', 'Docs', 'user-a', 'workspace-a', 'file')`
      await sql`INSERT INTO workspace_files (id, context, user_id, workspace_id, folder_id)
      VALUES ('file', 'workspace', 'user-a', 'workspace-a', 'folder'),
        ('personal', 'copilot', 'user-a', NULL, NULL)`
      await sql`INSERT INTO workspace_file_version (id, file_id) VALUES ('version', 'file')`
      await sql`DELETE FROM "user" WHERE id = 'user-a'`
      expect(await sql`SELECT id FROM workspace_files`).toHaveLength(0)
      expect(await sql`SELECT id FROM folder`).toHaveLength(0)
      expect(await sql`SELECT id FROM workspace_file_version`).toHaveLength(0)
      expect(await sql`SELECT id FROM workspace`).toHaveLength(3)
    }
  )

  check(
    'backfills legacy Project attribution in bounded pages without changing live creator or content',
    async () => {
      await sql`ALTER TABLE workspace_files DISABLE TRIGGER workspace_files_creator_lifetime`
      await sql`ALTER TABLE folder DISABLE TRIGGER folder_creator_lifetime`
      try {
        await sql`INSERT INTO workspace_files (id, context, user_id, entity_type, entity_id, original_name)
        SELECT 'file-' || lpad(id::text, 4, '0'), 'project', 'user-a', 'project', 'project-a', 'document-' || id
        FROM generate_series(1, 507) id`
        await sql`INSERT INTO folder (id, name, user_id, resource_type, entity_type, entity_id)
        SELECT 'folder-' || lpad(id::text, 4, '0'), 'Docs ' || id, 'user-a', 'file', 'project', 'project-a'
        FROM generate_series(1, 507) id`
      } finally {
        await sql`ALTER TABLE workspace_files ENABLE TRIGGER workspace_files_creator_lifetime`
        await sql`ALTER TABLE folder ENABLE TRIGGER folder_creator_lifetime`
      }
      const { backfillProjectFileCreators } = await import(
        '@sim/db/script-migrations/0032_backfill_project_file_creators'
      )
      expect(await backfillProjectFileCreators(sql)).toEqual({ files: 507, folders: 507 })
      expect(await backfillProjectFileCreators(sql)).toEqual({ files: 0, folders: 0 })
      expect(
        await sql`SELECT DISTINCT user_id, original_creator_user_id, key, secret_provenance_version FROM workspace_files`
      ).toEqual([
        {
          user_id: 'user-a',
          original_creator_user_id: 'user-a',
          key: 'unchanged-object-key',
          secret_provenance_version: 1,
        },
      ])
      await sql`DELETE FROM "user" WHERE id = 'user-a'`
      expect(
        (
          await sql`SELECT count(*)::integer AS count FROM workspace_files WHERE user_id IS NULL AND original_creator_user_id = 'user-a'`
        )[0].count
      ).toBe(507)
      expect(
        (
          await sql`SELECT count(*)::integer AS count FROM folder WHERE user_id IS NULL AND original_creator_user_id = 'user-a'`
        )[0].count
      ).toBe(507)
    }
  )

  check(
    'rejects missing and forged Project creators and immutable snapshot replacement',
    async () => {
      await expect(sql`INSERT INTO workspace_files (id, context, user_id, entity_type, entity_id, original_creator_user_id)
      VALUES ('missing', 'project', NULL, 'project', 'project-a', 'user-a')`).rejects.toMatchObject(
        { code: '23514' }
      )
      await expect(sql`INSERT INTO workspace_files (id, context, user_id, entity_type, entity_id, original_creator_user_id)
      VALUES ('forged', 'project', 'user-a', 'project', 'project-a', 'user-b')`).rejects.toMatchObject(
        { code: '23514' }
      )
      await sql`INSERT INTO workspace_files (id, context, user_id, entity_type, entity_id)
      VALUES ('file', 'project', 'user-a', 'project', 'project-a')`
      for (const creator of ['user-b', null]) {
        await expect(
          sql`UPDATE workspace_files SET original_creator_user_id = ${creator} WHERE id = 'file'`
        ).rejects.toMatchObject({ code: '23514' })
      }
      await expect(
        sql`UPDATE workspace_files SET user_id = 'user-b' WHERE id = 'file'`
      ).rejects.toMatchObject({ code: '23514' })
      await expect(sql`INSERT INTO folder (id, name, user_id, resource_type, entity_type, entity_id, original_creator_user_id)
      VALUES ('forged', 'Docs', 'user-a', 'file', 'project', 'project-a', 'user-b')`).rejects.toMatchObject(
        { code: '23514' }
      )
      await expect(sql`INSERT INTO workspace_files (id, context, user_id, workspace_id)
      VALUES ('legacy-null', 'workspace', NULL, 'workspace-a')`).rejects.toMatchObject({
        code: '23514',
      })
    }
  )

  check(
    'retained Project owner deletion stays fail-closed and rolls back creator cleanup',
    async () => {
      await sql`UPDATE project SET owner_id = 'user-a' WHERE id = 'project-a'`
      await sql`INSERT INTO workspace_files (id, context, user_id, entity_type, entity_id)
      VALUES ('file', 'project', 'user-a', 'project', 'project-a')`
      await expect(sql`DELETE FROM "user" WHERE id = 'user-a'`).rejects.toMatchObject({
        code: '23503',
      })
      expect((await sql`SELECT user_id, original_creator_user_id FROM workspace_files`)[0]).toEqual(
        { user_id: 'user-a', original_creator_user_id: 'user-a' }
      )
      await expect(sql`DELETE FROM project WHERE id = 'project-a'`).rejects.toMatchObject({
        code: '23503',
      })
    }
  )

  for (const isolation of ['read committed', 'repeatable read'] as const) {
    check(
      `queued ${isolation} creator deletion preserves a committed concurrent Project file or retries`,
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
          await tx`INSERT INTO workspace_files (id, context, user_id, entity_type, entity_id)
          VALUES ('file', 'project', 'user-a', 'project', 'project-a')`
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
        expect(
          (await sql`SELECT user_id, original_creator_user_id FROM workspace_files`)[0]
        ).toEqual({
          user_id: isolation === 'repeatable read' ? 'user-a' : null,
          original_creator_user_id: 'user-a',
        })
      }
    )
  }

  check(
    'a Project insert queued behind creator deletion cannot resurrect a missing creator',
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
        await tx`INSERT INTO workspace_files (id, context, user_id, entity_type, entity_id)
        VALUES ('file', 'project', 'user-a', 'project', 'project-a')`
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
})
