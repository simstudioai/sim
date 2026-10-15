import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  backfillPublicShareEntities,
  backfillPublicShareEntitiesMigration,
} from '@sim/db/script-migrations/0034_backfill_public_share_entities'
import { runScriptMigrations } from '@sim/db/script-migrations/index'
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import postgres, { type Sql, type TransactionSql } from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const databaseUrl = readTestDatabaseUrl()
const migrations = [
  '0358_workspace_file_content_version_precision.sql',
  '0422_file_entity_ownership.sql',
  '0423_file_folder_version_ownership.sql',
  '0425_public_share_entity_ownership.sql',
].map((name) => readFileSync(new URL(`./migrations/${name}`, import.meta.url), 'utf8'))
const checks: { name: string; status: 'passed' | 'failed'; durationMs: number; error?: string }[] =
  []
function check(name: string, run: () => Promise<void>, timeout = 10_000) {
  it(
    name,
    async () => {
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
    },
    timeout
  )
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
  async function waitForDatabaseLock(pid: number, writerPid: number) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const [state] = await sql<{ waiting: boolean }[]>`SELECT EXISTS (
        SELECT 1 FROM unnest(pg_blocking_pids(${pid})) blocker WHERE blocker = ${writerPid}
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
      auth_type text NOT NULL DEFAULT 'password', password text DEFAULT 'fixture-hash',
      allowed_emails json DEFAULT '["reader@example.test"]',
      updated_at timestamp NOT NULL DEFAULT '2026-10-03 01:02:03.456',
      UNIQUE(resource_type, resource_id)
    )`
    const provenanceMigration = readFileSync(
      new URL('./migrations/0283_military_fabian_cortez.sql', import.meta.url),
      'utf8'
    )
    for (const statement of provenanceMigration.split('--> statement-breakpoint')) {
      if (
        statement.includes('CREATE OR REPLACE FUNCTION "demote_secret_provenance_version"') ||
        statement.includes('CREATE TRIGGER "workspace_files_secret_provenance_demote"')
      ) {
        await sql.unsafe(statement)
      }
    }
    await sql`CREATE TABLE workspace_file_secret_provenance (file_id text PRIMARY KEY, content_updated_at timestamp NOT NULL)`
    for (const migration of migrations) await applyMigration(migration)
    await sql`CREATE TABLE script_migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now())`
  })

  beforeEach(async () => {
    await sql`TRUNCATE script_migrations, workspace_file_secret_provenance, public_share, workspace_file_version, workspace_files, folder, project, workspace, organization, "user"`
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
    executor: Sql | TransactionSql,
    id = 'share',
    fileId = 'file',
    owner = 'project-a',
    kind: 'project' | 'workspace' = 'project'
  ) {
    return executor`INSERT INTO public_share (id, resource_type, resource_id, workspace_id, created_by, token, entity_type, entity_id)
      VALUES (${id}, 'file', ${fileId}, ${kind === 'workspace' ? owner : null}, 'user-a', ${id}, ${kind}, ${owner})`
  }

  for (const relationship of ['share', 'version'] as const) {
    check(
      `${relationship} creation preserves a legacy revision's exact timestamp and tracked provenance`,
      async () => {
        await sql`ALTER TABLE workspace_files DISABLE TRIGGER workspace_files_content_version_millisecond`
        try {
          await sql`INSERT INTO workspace_files (id, context, user_id, workspace_id, content_updated_at)
        VALUES ('file', 'workspace', 'user-a', 'workspace-a', '2026-10-03 01:02:03.456789')`
        } finally {
          await sql`ALTER TABLE workspace_files ENABLE TRIGGER workspace_files_content_version_millisecond`
        }
        await sql`INSERT INTO workspace_file_secret_provenance SELECT id, content_updated_at FROM workspace_files WHERE id = 'file'`
        const before = await sql`SELECT content_updated_at::text, secret_provenance_version, key
      FROM workspace_files WHERE id = 'file'`
        if (relationship === 'share') await share(sql, 'share', 'file', 'workspace-a', 'workspace')
        else
          await sql`INSERT INTO workspace_file_version (id, file_id, workspace_id) VALUES ('version', 'file', 'workspace-a')`
        expect(
          await sql`SELECT content_updated_at::text, secret_provenance_version, key
      FROM workspace_files WHERE id = 'file'`
        ).toEqual(before)
        if (relationship === 'share') {
          expect(await sql`SELECT resource_id, entity_id FROM public_share`).toEqual([
            { resource_id: 'file', entity_id: 'workspace-a' },
          ])
        } else {
          expect(await sql`SELECT file_id, workspace_id FROM workspace_file_version`).toEqual([
            { file_id: 'file', workspace_id: 'workspace-a' },
          ])
        }
        expect(
          await sql`SELECT f.content_updated_at = p.content_updated_at AS matches
      FROM workspace_files f JOIN workspace_file_secret_provenance p ON p.file_id = f.id`
        ).toEqual([{ matches: true }])
        await sql`UPDATE workspace_files SET original_name = 'renamed' WHERE id = 'file'`
        expect(
          await sql`SELECT content_updated_at::text, secret_provenance_version FROM workspace_files`
        ).toEqual([{ content_updated_at: '2026-10-03 01:02:03.456', secret_provenance_version: 1 }])
        await sql`UPDATE workspace_files SET content_updated_at = content_updated_at + INTERVAL '1 millisecond' WHERE id = 'file'`
        expect(await sql`SELECT secret_provenance_version FROM workspace_files`).toEqual([
          { secret_provenance_version: null },
        ])
      }
    )
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
      await sql.begin(async (tx) => {
        await tx`UPDATE workspace_files SET user_id = 'user-b' WHERE user_id = 'user-a'`
        await tx`DELETE FROM "user" WHERE id = 'user-a'`
      })
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
    'workspace owner changes are refused while file shares exist, preserving links and configuration',
    async () => {
      await file('file', 'workspace-a', 'workspace')
      await share(sql, 'share', 'file', 'workspace-a', 'workspace')
      const before = await sql`SELECT * FROM public_share WHERE id = 'share'`
      await expect(
        sql`UPDATE workspace_files SET workspace_id = 'workspace-b' WHERE id = 'file'`
      ).rejects.toMatchObject({ code: '23514' })
      expect(await sql`SELECT * FROM public_share WHERE id = 'share'`).toEqual(before)
      expect(await sql`SELECT workspace_id FROM workspace_files WHERE id = 'file'`).toEqual([
        { workspace_id: 'workspace-a' },
      ])
      await sql.begin(async (tx) => {
        await tx`DELETE FROM public_share WHERE id = 'share'`
        await tx`UPDATE workspace_files SET workspace_id = 'workspace-b' WHERE id = 'file'`
      })
      expect(await sql`SELECT workspace_id FROM workspace_files WHERE id = 'file'`).toEqual([
        { workspace_id: 'workspace-b' },
      ])
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

  async function seedLegacyFileShares() {
    await sql`INSERT INTO workspace_files (id, context, user_id, workspace_id, original_name, deleted_at)
      SELECT 'file-' || lpad(n::text, 4, '0'), 'workspace', 'user-a', 'workspace-a',
        'file-' || n, CASE WHEN n % 10 = 0 THEN NULL ELSE timestamp '2026-10-01 01:02:03.456' END
      FROM generate_series(1, 1001) n`
    await sql`ALTER TABLE public_share DISABLE TRIGGER public_share_entity_binding`
    try {
      await sql`INSERT INTO public_share (id, resource_type, resource_id, workspace_id, token, is_active)
        SELECT 'share-' || lpad(n::text, 4, '0'), 'file', 'file-' || lpad(n::text, 4, '0'),
          'workspace-a', 'token-' || n, n % 2 = 0 FROM generate_series(1, 1001) n`
    } finally {
      await sql`ALTER TABLE public_share ENABLE TRIGGER public_share_entity_binding`
    }
  }

  async function retainedFileShareState() {
    return sql`SELECT
      (SELECT md5(string_agg((to_jsonb(s) - 'entity_type' - 'entity_id')::text, '' ORDER BY id))
        FROM public_share s WHERE id LIKE 'share-%') AS shares,
      (SELECT md5(string_agg(to_jsonb(f)::text, '' ORDER BY id))
        FROM workspace_files f WHERE id LIKE 'file-%') AS files`
  }

  async function committedShareCount() {
    const [row] = await sql<{ count: number }[]>`SELECT count(*)::integer AS count
      FROM public_share WHERE entity_type = 'workspace' AND entity_id = workspace_id`
    return row.count
  }

  for (const target of ['file', 'share'] as const) {
    for (const persistent of [false, true]) {
      check(
        `backfill ${persistent ? 'stops after bounded retries under persistent' : 'recovers after temporary'} ${target} lock contention without losing committed batches`,
        async () => {
          await seedLegacyFileShares()
          const before = await retainedFileShareState()
          const firstRollback = createDeferred<void>()
          let rollbacks = 0
          const worker = postgres(databaseUrl, {
            max: 1,
            onnotice: () => undefined,
            connection: { search_path: schemaName },
            debug: (_connection, query) => {
              if (query.toLowerCase() === 'rollback') {
                rollbacks += 1
                firstRollback.resolve()
              }
            },
          })
          const held = createDeferred<void>()
          const release = createDeferred<void>()
          const holding = sql.begin(async (tx) => {
            if (target === 'file')
              await tx`SELECT id FROM workspace_files WHERE id = 'file-0501' FOR UPDATE`
            else await tx`SELECT id FROM public_share WHERE id = 'share-0501' FOR UPDATE`
            held.resolve()
            await release.promise
          })
          await Promise.race([held.promise, holding])
          const running = runScriptMigrations(worker, [backfillPublicShareEntitiesMigration]).then(
            () => null,
            (error: unknown) => error
          )
          try {
            if (!persistent) {
              await Promise.race([firstRollback.promise, running])
              expect(await committedShareCount()).toBe(500)
              expect(await sql`SELECT name FROM script_migrations`).toEqual([])
              release.resolve()
              await holding
            }
            const error = await running
            if (persistent) {
              expect(error).toMatchObject({ code: '55P03' })
              expect(rollbacks).toBe(3)
              expect(await committedShareCount()).toBe(500)
              expect(await sql`SELECT name FROM script_migrations`).toEqual([])
              release.resolve()
              await holding
              await runScriptMigrations(worker, [backfillPublicShareEntitiesMigration])
            } else {
              expect(error).toBeNull()
              expect(rollbacks).toBe(1)
            }
            expect(await committedShareCount()).toBe(1001)
            expect(await retainedFileShareState()).toEqual(before)
            const receipts = await sql`SELECT * FROM script_migrations`
            expect(receipts).toHaveLength(1)
            expect(receipts[0].name).toBe(backfillPublicShareEntitiesMigration.name)
            await runScriptMigrations(worker, [backfillPublicShareEntitiesMigration])
            expect(await sql`SELECT * FROM script_migrations`).toEqual(receipts)
          } finally {
            release.resolve()
            await holding
            await running
            await worker.end({ timeout: 1 })
          }
        },
        40_000
      )
    }
  }

  check(
    'cancelled backfill rolls back its incomplete batch, preserves progress, and resumes without missing concurrent legacy inserts',
    async () => {
      await seedLegacyFileShares()
      const before = await retainedFileShareState()
      await sql`CREATE SEQUENCE backfill_write_attempts`
      await sql`CREATE FUNCTION pause_backfill_batch() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        PERFORM nextval('backfill_write_attempts');
        IF NEW.id = 'share-0750' THEN PERFORM pg_advisory_xact_lock(86090034); END IF;
        RETURN NEW;
      END
    $$`
      await sql`CREATE TRIGGER pause_backfill_batch BEFORE UPDATE ON public_share
      FOR EACH ROW EXECUTE FUNCTION pause_backfill_batch()`
      const worker = postgres(databaseUrl, {
        max: 1,
        onnotice: () => undefined,
        connection: { search_path: schemaName },
      })
      const [connection] = await worker<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`
      const held = createDeferred<number>()
      const release = createDeferred<void>()
      const holding = sql.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(86090034)`
        const [holder] = await tx<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`
        held.resolve(holder.pid)
        await release.promise
      })
      const holderPid = await Promise.race([held.promise, holding.then(() => 0)])
      const running = runScriptMigrations(worker, [backfillPublicShareEntitiesMigration]).then(
        () => null,
        (error: unknown) => error
      )
      try {
        expect(await waitForDatabaseLock(connection.pid, holderPid)).toBe(true)
        expect(await committedShareCount()).toBe(500)
        const [attempts] = await sql<
          { count: number }[]
        >`SELECT last_value::integer AS count FROM backfill_write_attempts`
        expect(attempts.count).toBeGreaterThan(501)
        await sql`INSERT INTO public_share (id, resource_type, resource_id, workspace_id, token)
        VALUES ('before-cursor', 'folder', 'concurrent-folder', 'workspace-a', 'concurrent-token')`
        expect(
          await sql`SELECT entity_type, entity_id FROM public_share WHERE id = 'before-cursor'`
        ).toEqual([{ entity_type: 'workspace', entity_id: 'workspace-a' }])
        await sql`SELECT pg_cancel_backend(${connection.pid})`
        expect(await running).toMatchObject({ code: '57014' })
        expect(await committedShareCount()).toBe(501)
        expect(await sql`SELECT name FROM script_migrations`).toEqual([])
        expect(await retainedFileShareState()).toEqual(before)
        release.resolve()
        await holding
        await runScriptMigrations(worker, [backfillPublicShareEntitiesMigration])
        expect(await committedShareCount()).toBe(1002)
        expect(await retainedFileShareState()).toEqual(before)
        expect(await sql`SELECT name FROM script_migrations`).toEqual([
          { name: backfillPublicShareEntitiesMigration.name },
        ])
      } finally {
        release.resolve()
        await holding
        await running
        await worker.end({ timeout: 1 })
        await sql`DROP TRIGGER pause_backfill_batch ON public_share`
        await sql`DROP FUNCTION pause_backfill_batch()`
        await sql`DROP SEQUENCE backfill_write_attempts`
      }
    }
  )

  for (const isolation of ['read committed', 'repeatable read'] as const) {
    for (const operation of ['deletion', 'owner change'] as const) {
      check(
        `${isolation}: file ${operation} waits for share insertion and preserves ownership`,
        async () => {
          await file('file', 'workspace-a', 'workspace')
          const snapshot = createDeferred<void>()
          const startMutation = createDeferred<void>()
          const pid = createDeferred<number>()
          const mutating = sql
            .begin(`isolation level ${isolation}`, async (tx) => {
              await tx`SELECT count(*) FROM public_share`
              snapshot.resolve()
              await startMutation.promise
              const [connection] = await tx<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`
              pid.resolve(connection.pid)
              if (operation === 'deletion') await tx`DELETE FROM workspace_files WHERE id = 'file'`
              else
                await tx`UPDATE workspace_files SET workspace_id = 'workspace-b' WHERE id = 'file'`
            })
            .then(
              () => null,
              (error: unknown) => error
            )
          await Promise.race([
            snapshot.promise,
            mutating.then((error) => {
              if (error) throw error
              throw new Error('Mutation ended before acquiring its snapshot')
            }),
          ])
          const inserted = createDeferred<number>()
          const release = createDeferred<void>()
          const inserting = sql.begin(async (tx) => {
            await share(tx, 'share', 'file', 'workspace-a', 'workspace')
            const [writer] = await tx<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`
            inserted.resolve(writer.pid)
            await release.promise
          })
          let waited = false
          try {
            await Promise.race([inserted.promise, inserting])
            startMutation.resolve()
            const mutationPid = await Promise.race([
              pid.promise,
              mutating.then((error) => {
                if (error) throw error
                throw new Error('Mutation ended before publishing its connection')
              }),
            ])
            waited = await waitForDatabaseLock(mutationPid, await inserted.promise)
          } finally {
            startMutation.resolve()
            release.resolve()
            await inserting
            await mutating
          }
          expect(waited, 'target mutation must wait for share insertion').toBe(true)
          const result = await mutating
          expect(
            await sql`SELECT share.id FROM public_share share
          LEFT JOIN workspace_files file ON file.id = share.resource_id
          WHERE share.resource_type = 'file' AND file.id IS NULL`
          ).toEqual([])
          if (isolation === 'repeatable read') expect(result).toMatchObject({ code: '40001' })
          else if (operation === 'deletion') expect(result).toBeNull()
          else expect(result).toMatchObject({ code: '23514' })
          if (operation === 'owner change') {
            expect(await sql`SELECT workspace_id FROM workspace_files WHERE id = 'file'`).toEqual([
              { workspace_id: 'workspace-a' },
            ])
            expect(await sql`SELECT token, entity_id FROM public_share WHERE id = 'share'`).toEqual(
              [{ token: 'share', entity_id: 'workspace-a' }]
            )
          }
          await sql`DELETE FROM workspace_files WHERE id = 'file'`
          expect(await sql`SELECT id FROM public_share`).toEqual([])
        }
      )
    }
    check(`${isolation}: a new share cannot commit behind target deletion`, async () => {
      await file()
      const deleted = createDeferred<number>()
      const release = createDeferred<void>()
      const deleting = sql.begin(async (tx) => {
        await tx`DELETE FROM workspace_files WHERE id = 'file'`
        const [writer] = await tx<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`
        deleted.resolve(writer.pid)
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
        waited = await waitForDatabaseLock(insertPid, await deleted.promise)
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
