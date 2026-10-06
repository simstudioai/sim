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
  '0402_public_share_entity_ownership.sql',
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
  }, 10_000)
}

describe('Public share canonical ownership in PostgreSQL', () => {
  const schemaName = `public_share_owner_${generateId().replaceAll('-', '')}`
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
      if (state.waiting) return true
      await sleep(10)
    }
    return false
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
    await sql`CREATE TABLE public_share (
      id text PRIMARY KEY, resource_type text NOT NULL, resource_id text NOT NULL,
      workspace_id text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
      created_by text REFERENCES "user"(id) ON DELETE SET NULL,
      token text NOT NULL UNIQUE, is_active boolean NOT NULL DEFAULT true,
      updated_at timestamp NOT NULL DEFAULT '2026-10-03 01:02:03.456',
      UNIQUE(resource_type, resource_id)
    )`
    for (const migration of migrations) await applyMigration(migration)
  })

  beforeEach(async () => {
    await sql`TRUNCATE public_share, workspace_file_version, workspace_files, folder, project, workspace, organization, "user"`
    await sql`INSERT INTO "user" VALUES ('user-a'), ('user-b')`
    await sql`INSERT INTO workspace VALUES ('workspace-a'), ('workspace-b'), ('same-id')`
    await sql`INSERT INTO organization VALUES ('organization-a')`
    await sql`INSERT INTO project (id) VALUES ('project-a'), ('project-b'), ('same-id')`
  })

  afterAll(async () => {
    try {
      await sql?.end({ timeout: 1 })
      await admin?.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
    } finally {
      await admin?.end({ timeout: 1 })
      const reportPath = process.env.PUBLIC_SHARE_OWNERSHIP_REPORT_PATH
      if (reportPath) {
        await mkdir(dirname(reportPath), { recursive: true })
        await writeFile(reportPath, JSON.stringify({ checks }, null, 2))
      }
    }
  })

  async function file(id = 'file', owner = 'project-a', kind: 'project' | 'workspace' = 'project') {
    await sql`INSERT INTO workspace_files (id, context, user_id, workspace_id, project_id, original_name)
      VALUES (${id}, ${kind}, 'user-a', ${kind === 'workspace' ? owner : null}, ${kind === 'project' ? owner : null}, ${id})`
  }
  function share(
    executor: Sql,
    id = 'share',
    fileId = 'file',
    owner = 'project-a',
    kind: 'project' | 'workspace' = 'project'
  ) {
    return executor`INSERT INTO public_share (id, resource_type, resource_id, workspace_id, created_by, token, entity_type, entity_id)
      VALUES (${id}, 'file', ${fileId}, ${kind === 'workspace' ? owner : null}, 'user-a', ${id}, ${kind}, ${owner})`
  }

  check(
    'legacy file shares derive the exact workspace and reject a different target owner',
    async () => {
      await file('file', 'workspace-a', 'workspace')
      await expect(sql`INSERT INTO public_share (id, resource_type, resource_id, workspace_id, token)
      VALUES ('wrong', 'file', 'file', 'workspace-b', 'wrong')`).rejects.toMatchObject({
        code: '23514',
      })
      await sql`INSERT INTO public_share (id, resource_type, resource_id, workspace_id, token)
      VALUES ('legacy', 'file', 'file', 'workspace-a', 'legacy')`
      expect(await sql`SELECT entity_type, entity_id FROM public_share`).toEqual([
        { entity_type: 'workspace', entity_id: 'workspace-a' },
      ])
    }
  )

  check(
    'Project shares reject foreign, missing and nonfile targets without borrowing workspace ownership',
    async () => {
      await file()
      await expect(share(sql, 'wrong', 'file', 'project-b')).rejects.toMatchObject({
        code: '23514',
      })
      await expect(share(sql, 'missing', 'missing')).rejects.toMatchObject({ code: '23503' })
      await expect(sql`INSERT INTO public_share (id, resource_type, resource_id, token, entity_type, entity_id)
      VALUES ('folder', 'folder', 'file', 'folder', 'project', 'project-a')`).rejects.toMatchObject(
        { code: '23514' }
      )
      await share(sql)
      await expect(
        sql`UPDATE public_share SET entity_id = 'project-b' WHERE id = 'share'`
      ).rejects.toMatchObject({ code: '23514' })
      await expect(
        sql`UPDATE public_share SET resource_id = 'missing' WHERE id = 'share'`
      ).rejects.toMatchObject({ code: '23514' })
    }
  )

  check(
    'creator deletion and archive restore preserve a token; hard deletion invalidates it',
    async () => {
      await file()
      await share(sql)
      await sql`DELETE FROM "user" WHERE id = 'user-a'`
      expect(await sql`SELECT token, created_by FROM public_share`).toEqual([
        { token: 'share', created_by: null },
      ])
      await sql`UPDATE workspace_files SET deleted_at = now() WHERE id = 'file'`
      await sql`UPDATE workspace_files SET deleted_at = NULL WHERE id = 'file'`
      expect(await sql`SELECT token FROM public_share`).toEqual([{ token: 'share' }])
      await sql`DELETE FROM workspace_files WHERE id = 'file'`
      expect(await sql`SELECT id FROM public_share`).toEqual([])
    }
  )

  check(
    'workspace owner changes invalidate existing links and preserve legacy nonfile shares',
    async () => {
      await file('file', 'workspace-a', 'workspace')
      await share(sql, 'share', 'file', 'workspace-a', 'workspace')
      await sql`UPDATE workspace_files SET workspace_id = 'workspace-b' WHERE id = 'file'`
      expect(await sql`SELECT id FROM public_share`).toEqual([])
      await sql`INSERT INTO public_share (id, resource_type, resource_id, workspace_id, token)
      VALUES ('legacy', 'folder', 'unregistered-legacy-target', 'workspace-a', 'legacy')`
      expect(await sql`SELECT entity_type, entity_id FROM public_share`).toEqual([
        { entity_type: 'workspace', entity_id: 'workspace-a' },
      ])
    }
  )

  check(
    'bounded backfill stamps compatible owners, preserves share settings, and quarantines stale targets',
    async () => {
      await file('valid-file', 'workspace-a', 'workspace')
      await file('foreign-file', 'workspace-b', 'workspace')
      await sql`INSERT INTO workspace_files (id, context, user_id, workspace_id)
      VALUES ('unknown-file', 'unreviewed-purpose', 'user-a', 'workspace-a')`
      await sql`ALTER TABLE public_share DISABLE TRIGGER public_share_entity_binding`
      try {
        await sql`INSERT INTO public_share (id, resource_type, resource_id, workspace_id, token, is_active)
        SELECT 'legacy-' || lpad(n::text, 4, '0'), 'folder', 'legacy-folder-' || n,
          'workspace-a', 'legacy-token-' || n, false FROM generate_series(1, 501) n`
        await sql`INSERT INTO public_share (id, resource_type, resource_id, workspace_id, token)
        VALUES ('valid', 'file', 'valid-file', 'workspace-a', 'valid-token'),
          ('foreign', 'file', 'foreign-file', 'workspace-a', 'foreign-token'),
          ('missing', 'file', 'missing-file', 'workspace-a', 'missing-token'),
          ('unknown', 'file', 'unknown-file', 'workspace-a', 'unknown-token')`
      } finally {
        await sql`ALTER TABLE public_share ENABLE TRIGGER public_share_entity_binding`
      }
      const before =
        await sql`SELECT id, resource_type, resource_id, workspace_id, token, is_active, updated_at FROM public_share ORDER BY id`
      const { backfillPublicShareEntities } = await import(
        './script-migrations/0033_backfill_public_share_entities'
      )
      const first = await backfillPublicShareEntities(sql)
      expect(first).toMatchObject({ backfilled: 502, unresolved: 3 })
      expect(first.sampleShareIds.sort()).toEqual(['foreign', 'missing', 'unknown'])
      expect(await sql`SELECT id FROM public_share WHERE entity_type IS NULL ORDER BY id`).toEqual([
        { id: 'foreign' },
        { id: 'missing' },
        { id: 'unknown' },
      ])
      expect(
        await sql`SELECT id, resource_type, resource_id, workspace_id, token, is_active, updated_at FROM public_share ORDER BY id`
      ).toEqual(before)
      expect(await backfillPublicShareEntities(sql)).toMatchObject({ backfilled: 0, unresolved: 3 })
    }
  )

  for (const isolation of ['read committed', 'repeatable read'] as const) {
    check(
      `${isolation}: file deletion waits for share insertion and cannot leave an orphan`,
      async () => {
        await file()
        const snapshot = createDeferred<void>()
        const startDelete = createDeferred<void>()
        const pid = createDeferred<number>()
        const deleting = sql
          .begin(`isolation level ${isolation}`, async (tx) => {
            await tx`SELECT count(*) FROM public_share`
            snapshot.resolve()
            await startDelete.promise
            const [connection] = await tx<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`
            pid.resolve(connection.pid)
            await tx`DELETE FROM workspace_files WHERE id = 'file'`
          })
          .then(
            () => null,
            (error: unknown) => error
          )
        await Promise.race([
          snapshot.promise,
          deleting.then((error) => {
            if (error) throw error
            throw new Error('Deletion ended before acquiring its snapshot')
          }),
        ])
        const inserted = createDeferred<void>()
        const release = createDeferred<void>()
        const inserting = sql.begin(async (tx) => {
          await tx`INSERT INTO public_share (id, resource_type, resource_id, token, entity_type, entity_id)
          VALUES ('share', 'file', 'file', 'share', 'project', 'project-a')`
          inserted.resolve()
          await release.promise
        })
        let waited = false
        try {
          await Promise.race([inserted.promise, inserting])
          startDelete.resolve()
          const deletePid = await Promise.race([
            pid.promise,
            deleting.then((error) => {
              if (error) throw error
              throw new Error('Deletion ended before publishing its connection')
            }),
          ])
          waited = await waitForDatabaseLock(deletePid)
        } finally {
          startDelete.resolve()
          release.resolve()
          await inserting
          await deleting
        }
        expect(waited, 'target deletion must wait for share insertion').toBe(true)
        const result = await deleting
        expect(
          await sql`SELECT share.id FROM public_share share
          LEFT JOIN workspace_files file ON file.id = share.resource_id
          WHERE share.resource_type = 'file' AND file.id IS NULL`
        ).toEqual([])
        if (isolation === 'repeatable read') expect(result).toMatchObject({ code: '40001' })
        else expect(result).toBeNull()
        await sql`DELETE FROM workspace_files WHERE id = 'file'`
        expect(await sql`SELECT id FROM public_share`).toEqual([])
      }
    )

    check(`${isolation}: a new share cannot commit behind target deletion`, async () => {
      await file()
      const deleted = createDeferred<void>()
      const release = createDeferred<void>()
      const deleting = sql.begin(async (tx) => {
        await tx`DELETE FROM workspace_files WHERE id = 'file'`
        deleted.resolve()
        await release.promise
      })
      await Promise.race([deleted.promise, deleting])
      const pid = createDeferred<number>()
      const inserting = sql
        .begin(`isolation level ${isolation}`, async (tx) => {
          const [connection] = await tx<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`
          pid.resolve(connection.pid)
          await tx`INSERT INTO public_share (id, resource_type, resource_id, token, entity_type, entity_id)
          VALUES ('share', 'file', 'file', 'share', 'project', 'project-a')`
        })
        .then(
          () => null,
          (error: unknown) => error
        )
      let waited = false
      try {
        const insertPid = await Promise.race([
          pid.promise,
          inserting.then((error) => {
            if (error) throw error
            throw new Error('Insertion ended before publishing its connection')
          }),
        ])
        waited = await waitForDatabaseLock(insertPid)
      } finally {
        release.resolve()
        await deleting
        await inserting
      }
      expect(waited, 'share insertion must wait for target deletion').toBe(true)
      expect(await inserting).toMatchObject({
        code: isolation === 'repeatable read' ? '40001' : '23503',
      })
      expect(await sql`SELECT id FROM public_share`).toEqual([])
    })
  }
})
