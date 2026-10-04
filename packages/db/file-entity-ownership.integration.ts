import { readFileSync } from 'node:fs'
import { backfillWorkspaceFileEntities } from '@sim/db/script-migrations/0030_backfill_workspace_file_entities'
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const databaseUrl = readTestDatabaseUrl()
const migration = readFileSync(
  new URL('./migrations/0396_file_entity_ownership.sql', import.meta.url),
  'utf8'
)

describe('file entity ownership migration in PostgreSQL', () => {
  const schemaName = `file_entity_${generateId().replaceAll('-', '')}`
  let sql: Sql
  let admin: Sql

  async function applyMigration() {
    for (const statement of migration.split('--> statement-breakpoint')) {
      if (statement.trim()) await sql.unsafe(statement)
    }
  }

  async function waitForDatabaseLock(pid: number) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const [state] = await sql<{ waiting: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM pg_stat_activity WHERE pid = ${pid} AND wait_event_type = 'Lock'
        ) AS waiting
      `
      if (state.waiting) return
      await sleep(10)
    }
    throw new Error('Concurrent ownership operation did not wait for its parent row lock')
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
      organization_id text REFERENCES organization(id) ON DELETE RESTRICT,
      archived_at timestamp,
      updated_at timestamp NOT NULL DEFAULT '2026-10-03 01:02:03.456'
    )`
    await sql`CREATE TABLE workspace_files (
      id text PRIMARY KEY,
      context text NOT NULL,
      user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      workspace_id text REFERENCES workspace(id) ON DELETE CASCADE,
      organization_id text REFERENCES organization(id) ON DELETE CASCADE,
      folder_id text,
      chat_id text,
      key text NOT NULL DEFAULT 'unchanged-object-key',
      deleted_at timestamp,
      content_updated_at timestamp NOT NULL DEFAULT '2026-10-03 01:02:03.456',
      secret_provenance_version integer DEFAULT 1
    )`
    await applyMigration()
  })

  beforeEach(async () => {
    await sql`TRUNCATE workspace_files, project, workspace, organization, "user"`
    await sql`INSERT INTO "user" VALUES ('user-a'), ('user-b')`
    await sql`INSERT INTO workspace VALUES ('workspace-a'), ('workspace-b')`
    await sql`INSERT INTO organization VALUES ('organization-a')`
    await sql`INSERT INTO project VALUES ('project-a'), ('project-b')`
  })

  afterAll(async () => {
    try {
      await sql?.end()
      await admin?.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
    } finally {
      await admin?.end()
    }
  })

  it('backfills several bounded pages, preserves revisions, and reports unresolved legacy rows', async () => {
    await sql`ALTER TABLE workspace_files DISABLE TRIGGER workspace_files_sync_entity_binding`
    try {
      await sql`INSERT INTO workspace_files (id, context, user_id, workspace_id)
        SELECT 'file-' || lpad(id::text, 4, '0'), 'workspace', 'user-a', 'workspace-a'
        FROM generate_series(1, 506) id`
      await sql`INSERT INTO workspace_files (id, context, user_id, organization_id)
        VALUES ('org-kb', 'knowledge-base', 'user-a', 'organization-a')`
      await sql`INSERT INTO workspace_files (id, context, user_id)
        VALUES ('personal', 'copilot', 'user-a'), ('orphan-kb', 'knowledge-base', 'user-a'),
          ('unknown', 'chat', 'user-a')`
    } finally {
      await sql`ALTER TABLE workspace_files ENABLE TRIGGER workspace_files_sync_entity_binding`
    }

    const result = await backfillWorkspaceFileEntities(sql)
    expect(result.backfilled).toBe(508)
    expect(result.unresolved).toEqual([
      { context: 'knowledge-base', count: 1, sampleFileIds: ['orphan-kb'] },
      { context: 'chat', count: 1, sampleFileIds: ['unknown'] },
    ])
    const [changed] = await sql<{ count: number }[]>`
      SELECT count(*)::integer AS count FROM workspace_files
      WHERE key <> 'unchanged-object-key'
        OR content_updated_at <> TIMESTAMP '2026-10-03 01:02:03.456'
        OR secret_provenance_version <> 1
    `
    expect(changed.count).toBe(0)
    const owners = await sql`SELECT id, entity_type, entity_id FROM workspace_files
      WHERE id IN ('file-0001', 'org-kb', 'personal', 'orphan-kb') ORDER BY id`
    expect(owners).toEqual([
      { id: 'file-0001', entity_type: 'workspace', entity_id: 'workspace-a' },
      { id: 'org-kb', entity_type: 'organization', entity_id: 'organization-a' },
      { id: 'orphan-kb', entity_type: null, entity_id: null },
      { id: 'personal', entity_type: 'user', entity_id: 'user-a' },
    ])
    expect((await backfillWorkspaceFileEntities(sql)).backfilled).toBe(0)
  })

  it('keeps legacy inserts and owner changes consistent while retaining chat purpose bindings', async () => {
    await sql`INSERT INTO workspace_files (id, context, user_id, workspace_id, chat_id)
      VALUES ('chat-file', 'mothership', 'user-a', 'workspace-a', 'chat-a')`
    await sql`UPDATE workspace_files SET workspace_id = 'workspace-b' WHERE id = 'chat-file'`
    const [chat] = await sql`SELECT entity_type, entity_id, chat_id FROM workspace_files`
    expect(chat).toEqual({ entity_type: 'workspace', entity_id: 'workspace-b', chat_id: 'chat-a' })
    await sql`UPDATE workspace_files SET context = 'workspace', chat_id = NULL WHERE id = 'chat-file'`
    await sql`UPDATE workspace_files SET user_id = 'user-b' WHERE id = 'chat-file'`
    const [materialized] = await sql`SELECT entity_type, entity_id, chat_id FROM workspace_files`
    expect(materialized).toEqual({
      entity_type: 'workspace',
      entity_id: 'workspace-b',
      chat_id: null,
    })
    await sql`INSERT INTO workspace_files (id, context, user_id) VALUES ('personal', 'copilot', 'user-a')`
    await sql`UPDATE workspace_files SET user_id = 'user-b' WHERE id = 'personal'`
    const [personal] =
      await sql`SELECT entity_type, entity_id FROM workspace_files WHERE id = 'personal'`
    expect(personal).toEqual({ entity_type: 'user', entity_id: 'user-b' })
  })

  it.each(['execution', 'workspace-logos', 'knowledge-base'])(
    'maps legacy %s rows to their workspace',
    async (context) => {
      await sql`INSERT INTO workspace_files (id, context, user_id, workspace_id)
      VALUES ('file', ${context}, 'user-a', 'workspace-a')`
      const [row] = await sql`SELECT entity_type, entity_id FROM workspace_files WHERE id = 'file'`
      expect(row).toEqual({ entity_type: 'workspace', entity_id: 'workspace-a' })
    }
  )

  it('refuses contradictory, incomplete, and unregistered explicit ownership without changing stored ownership', async () => {
    await sql`INSERT INTO workspace_files (id, context, user_id, workspace_id)
      VALUES ('file', 'workspace', 'user-a', 'workspace-a')`
    for (const pair of [
      { type: 'workspace', id: 'workspace-b' },
      { type: 'workspace', id: null },
      { type: null, id: 'workspace-a' },
      { type: 'user', id: 'user-a' },
      { type: 'future', id: 'workspace-a' },
      { type: 'workspace', id: '' },
    ]) {
      await expect(sql`UPDATE workspace_files SET entity_type = ${pair.type}, entity_id = ${pair.id}
        WHERE id = 'file'`).rejects.toMatchObject({ code: '23514' })
    }
    const [row] = await sql`SELECT entity_type, entity_id FROM workspace_files WHERE id = 'file'`
    expect(row).toEqual({ entity_type: 'workspace', entity_id: 'workspace-a' })
    await expect(sql`INSERT INTO workspace_files (id, context, user_id, entity_type, entity_id)
      VALUES ('unknown', 'general', 'user-a', 'user', 'user-a')`).rejects.toMatchObject({
      code: '23514',
    })
  })

  it('requires a real Project and refuses legacy tenancy or unsupported folders on a Project file', async () => {
    await expect(sql`INSERT INTO workspace_files (id, context, user_id, entity_type, entity_id)
      VALUES ('missing', 'project', 'user-a', 'project', 'missing')`).rejects.toMatchObject({
      code: '23503',
    })
    await expect(sql`INSERT INTO workspace_files (id, context, user_id, entity_type, entity_id, workspace_id)
      VALUES ('bound', 'project', 'user-a', 'project', 'project-a', 'workspace-a')`).rejects.toMatchObject(
      { code: '23514' }
    )
    await expect(sql`INSERT INTO workspace_files (id, context, user_id, entity_type, entity_id, folder_id)
      VALUES ('folder', 'project', 'user-a', 'project', 'project-a', 'workspace-folder')`).rejects.toMatchObject(
      { code: '23514' }
    )
    await expect(sql`INSERT INTO workspace_files (id, context, user_id)
      VALUES ('unowned', 'project', 'user-a')`).rejects.toMatchObject({ code: '23514' })
  })

  it('retains Project ownership through attribution changes and blocks owner deletion while retained files exist', async () => {
    const [projectBefore] = await sql`SELECT * FROM project WHERE id = 'project-a'`
    await sql`INSERT INTO workspace_files (id, context, user_id, entity_type, entity_id)
      VALUES ('file', 'project', 'user-a', 'project', 'project-a')`
    const [projectAfter] = await sql`SELECT * FROM project WHERE id = 'project-a'`
    expect(projectAfter).toEqual(projectBefore)
    await sql`UPDATE workspace_files SET user_id = 'user-b', deleted_at = now() WHERE id = 'file'`
    await expect(
      sql`UPDATE workspace_files SET entity_type = NULL, entity_id = NULL WHERE id = 'file'`
    ).rejects.toMatchObject({ code: '23514' })
    await expect(
      sql`UPDATE workspace_files SET entity_id = 'project-b' WHERE id = 'file'`
    ).rejects.toMatchObject({ code: '23514' })
    await expect(sql`DELETE FROM project WHERE id = 'project-a'`).rejects.toMatchObject({
      code: '23503',
    })
    await expect(
      sql`UPDATE project SET id = 'replacement' WHERE id = 'project-a'`
    ).rejects.toMatchObject({ code: '23503' })
    await sql`DELETE FROM workspace_files WHERE id = 'file'`
    await sql`DELETE FROM project WHERE id = 'project-a'`
    expect(await sql`SELECT id FROM project WHERE id = 'project-a'`).toHaveLength(0)
  })

  it('protects shared Project files from uploader cascade until attribution has been reassigned', async () => {
    await sql`INSERT INTO workspace_files (id, context, user_id, entity_type, entity_id)
      VALUES ('shared-file', 'project', 'user-a', 'project', 'project-a')`
    await expect(sql`DELETE FROM "user" WHERE id = 'user-a'`).rejects.toMatchObject({
      code: '23503',
    })
    expect(await sql`SELECT id FROM workspace_files WHERE id = 'shared-file'`).toHaveLength(1)
    await sql`UPDATE workspace_files SET user_id = 'user-b' WHERE id = 'shared-file'`
    await sql`DELETE FROM "user" WHERE id = 'user-a'`
    const [file] =
      await sql`SELECT user_id, entity_type, entity_id FROM workspace_files WHERE id = 'shared-file'`
    expect(file).toEqual({ user_id: 'user-b', entity_type: 'project', entity_id: 'project-a' })
  })

  it('preserves legacy workspace, organization, and personal owner deletion behavior', async () => {
    await sql`INSERT INTO workspace_files (id, context, user_id, workspace_id)
      VALUES ('workspace-file', 'workspace', 'user-a', 'workspace-a')`
    await sql`INSERT INTO workspace_files (id, context, user_id, organization_id)
      VALUES ('organization-file', 'knowledge-base', 'user-a', 'organization-a')`
    await sql`INSERT INTO workspace_files (id, context, user_id)
      VALUES ('personal-file', 'copilot', 'user-a')`
    await sql`DELETE FROM workspace WHERE id = 'workspace-a'`
    expect(await sql`SELECT id FROM workspace_files WHERE id = 'workspace-file'`).toHaveLength(0)
    await sql`DELETE FROM organization WHERE id = 'organization-a'`
    expect(await sql`SELECT id FROM workspace_files WHERE id = 'organization-file'`).toHaveLength(0)
    await sql`DELETE FROM "user" WHERE id = 'user-a'`
    expect(await sql`SELECT id FROM workspace_files`).toHaveLength(0)
  })

  it.each(['read committed', 'repeatable read'])(
    'serializes Project deletion behind an in-flight file insert at %s isolation',
    async (isolation) => {
      const inserted = createDeferred<void>()
      const release = createDeferred<void>()
      const creation = sql.begin(async (tx) => {
        await tx`INSERT INTO workspace_files (id, context, user_id, entity_type, entity_id)
        VALUES ('file', 'project', 'user-a', 'project', 'project-a')`
        inserted.resolve()
        await release.promise
      })
      const deleting = createDeferred<number>()
      let rejection: Promise<void> | undefined
      try {
        await inserted.promise
        const deletion = sql.begin(`isolation level ${isolation}`, async (tx) => {
          await tx`SET LOCAL statement_timeout = '5s'`
          const [backend] = await tx<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`
          deleting.resolve(backend.pid)
          await tx`DELETE FROM project WHERE id = 'project-a'`
        })
        rejection = expect(deletion).rejects.toMatchObject({
          code: isolation === 'repeatable read' ? '40001' : '23503',
        })
        await waitForDatabaseLock(await deleting.promise)
      } finally {
        release.resolve()
        await creation
      }
      await rejection
      expect(await sql`SELECT id FROM project WHERE id = 'project-a'`).toHaveLength(1)
    }
  )

  it.each(['read committed', 'repeatable read'])(
    'does not cascade a concurrently created Project file when its uploader is deleted at %s isolation',
    async (isolation) => {
      const inserted = createDeferred<void>()
      const release = createDeferred<void>()
      const creation = sql.begin(async (tx) => {
        await tx`INSERT INTO workspace_files (id, context, user_id, entity_type, entity_id)
          VALUES ('file', 'project', 'user-a', 'project', 'project-a')`
        inserted.resolve()
        await release.promise
      })
      const deleting = createDeferred<number>()
      let rejection: Promise<void> | undefined
      try {
        await inserted.promise
        const deletion = sql.begin(`isolation level ${isolation}`, async (tx) => {
          await tx`SET LOCAL statement_timeout = '5s'`
          const [backend] = await tx<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`
          deleting.resolve(backend.pid)
          await tx`DELETE FROM "user" WHERE id = 'user-a'`
        })
        rejection = expect(deletion).rejects.toMatchObject({
          code: isolation === 'repeatable read' ? '40001' : '23503',
        })
        await waitForDatabaseLock(await deleting.promise)
      } finally {
        release.resolve()
        await creation
      }
      await rejection
      expect(await sql`SELECT id FROM workspace_files WHERE id = 'file'`).toHaveLength(1)
    }
  )

  it.each(['read committed', 'repeatable read'])(
    'rejects a file insert when its Project is concurrently removed at %s isolation',
    async (isolation) => {
      const deleted = createDeferred<void>()
      const release = createDeferred<void>()
      const deletion = sql.begin(async (tx) => {
        await tx`DELETE FROM project WHERE id = 'project-a'`
        deleted.resolve()
        await release.promise
      })
      const inserting = createDeferred<number>()
      let rejection: Promise<void> | undefined
      try {
        await deleted.promise
        const creation = sql.begin(`isolation level ${isolation}`, async (tx) => {
          await tx`SET LOCAL statement_timeout = '5s'`
          const [backend] = await tx<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`
          inserting.resolve(backend.pid)
          await tx`INSERT INTO workspace_files (id, context, user_id, entity_type, entity_id)
          VALUES ('file', 'project', 'user-a', 'project', 'project-a')`
        })
        rejection = expect(creation).rejects.toMatchObject({
          code: isolation === 'repeatable read' ? '40001' : '23503',
        })
        await waitForDatabaseLock(await inserting.promise)
      } finally {
        release.resolve()
        await deletion
      }
      await rejection
      expect(await sql`SELECT id FROM workspace_files WHERE id = 'file'`).toHaveLength(0)
    }
  )

  it('can replay the additive SQL after files are present', async () => {
    await sql`INSERT INTO workspace_files (id, context, user_id, workspace_id)
      VALUES ('file', 'workspace', 'user-a', 'workspace-a')`
    await applyMigration()
    const [row] = await sql`SELECT id, entity_type, entity_id FROM workspace_files`
    expect(row).toEqual({ id: 'file', entity_type: 'workspace', entity_id: 'workspace-a' })
  })
})
