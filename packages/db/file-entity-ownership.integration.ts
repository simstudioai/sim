import { readFileSync } from 'node:fs'
import { validateFileWorkspaceBindingMigration } from '@sim/db/script-migrations/0034_validate_file_workspace_binding'
import { runScriptMigrations } from '@sim/db/script-migrations/index'
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const databaseUrl = readTestDatabaseUrl()
const migration = readFileSync(
  new URL('./migrations/0402_file_entity_ownership.sql', import.meta.url),
  'utf8'
)

const workspaceBindingMigration = readFileSync(
  new URL('./migrations/0408_file_workspace_binding.sql', import.meta.url),
  'utf8'
)

describe('file entity ownership migration in PostgreSQL', () => {
  const schemaName = `file_entity_${generateId().replaceAll('-', '')}`
  let sql: Sql
  let admin: Sql

  async function applyMigration() {
    for (const statement of `${migration}\n--> statement-breakpoint\n${workspaceBindingMigration}`.split(
      '--> statement-breakpoint'
    )) {
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

  it('keeps legacy inserts and owner changes consistent while retaining chat purpose bindings', async () => {
    await sql`INSERT INTO workspace_files (id, context, user_id, workspace_id, chat_id)
      VALUES ('chat-file', 'mothership', 'user-a', 'workspace-a', 'chat-a')`
    await sql`UPDATE workspace_files SET workspace_id = 'workspace-b' WHERE id = 'chat-file'`
    const [chat] = await sql`SELECT workspace_id, project_id, chat_id FROM workspace_files`
    expect(chat).toEqual({ workspace_id: 'workspace-b', project_id: null, chat_id: 'chat-a' })
    await sql`UPDATE workspace_files SET context = 'workspace', chat_id = NULL WHERE id = 'chat-file'`
    await sql`UPDATE workspace_files SET user_id = 'user-b' WHERE id = 'chat-file'`
    const [materialized] = await sql`SELECT workspace_id, project_id, chat_id FROM workspace_files`
    expect(materialized).toEqual({
      workspace_id: 'workspace-b',
      project_id: null,
      chat_id: null,
    })
    await sql`INSERT INTO workspace_files (id, context, user_id) VALUES ('personal', 'copilot', 'user-a')`
    await sql`UPDATE workspace_files SET user_id = 'user-b' WHERE id = 'personal'`
    const [personal] =
      await sql`SELECT user_id, workspace_id, project_id, organization_id FROM workspace_files WHERE id = 'personal'`
    expect(personal).toEqual({
      user_id: 'user-b',
      workspace_id: null,
      project_id: null,
      organization_id: null,
    })
  })

  it.each(['chat', 'execution', 'workspace-logos', 'knowledge-base'])(
    'maps legacy %s rows to their workspace',
    async (context) => {
      await sql`INSERT INTO workspace_files (id, context, user_id, workspace_id)
      VALUES ('file', ${context}, 'user-a', 'workspace-a')`
      const [row] = await sql`SELECT owner.entity_type, owner.entity_id
        FROM workspace_files file
        CROSS JOIN LATERAL workspace_file_owner(
          file.context, file.workspace_id, file.project_id, file.organization_id, file.user_id
        ) owner
        WHERE file.id = 'file'`
      expect(row).toEqual({ entity_type: 'workspace', entity_id: 'workspace-a' })
    }
  )

  it.each([
    ['workspace-a', 'project-a', null],
    ['workspace-a', null, 'organization-a'],
    [null, 'project-a', 'organization-a'],
    ['workspace-a', 'project-a', 'organization-a'],
  ])(
    'rejects competing workspace %s, project %s, and organization %s owners',
    async (workspaceId, projectId, organizationId) => {
      const context = projectId ? 'project' : 'knowledge-base'
      await expect(sql`INSERT INTO workspace_files
      (id, context, user_id, workspace_id, project_id, organization_id, deleted_at)
      VALUES ('mixed', ${context}, 'user-a', ${workspaceId}, ${projectId}, ${organizationId}, now())`).rejects.toMatchObject(
        { code: '23514', constraint_name: 'workspace_files_owner_check' }
      )
      await sql`INSERT INTO workspace_files (id, context, user_id) VALUES ('file', 'copilot', 'user-a')`
      await expect(sql`UPDATE workspace_files SET context = ${context}, workspace_id = ${workspaceId},
      project_id = ${projectId}, organization_id = ${organizationId} WHERE id = 'file'`).rejects.toMatchObject(
        { code: '23514', constraint_name: 'workspace_files_owner_check' }
      )
      expect(
        await sql`SELECT workspace_id, project_id, organization_id FROM workspace_files`
      ).toEqual([{ workspace_id: null, project_id: null, organization_id: null }])
    }
  )

  it('requires a real Project and rejects absent, incorrect-purpose, or chat-bound Project ownership', async () => {
    await expect(sql`INSERT INTO workspace_files (id, context, user_id, project_id)
      VALUES ('missing', 'project', 'user-a', 'missing')`).rejects.toMatchObject({ code: '23503' })
    await expect(sql`INSERT INTO workspace_files (id, context, user_id)
      VALUES ('unowned', 'project', 'user-a')`).rejects.toMatchObject({ code: '23514' })
    await expect(sql`INSERT INTO workspace_files (id, context, user_id, project_id)
      VALUES ('purpose', 'workspace', 'user-a', 'project-a')`).rejects.toMatchObject({
      code: '23514',
    })
    await expect(sql`INSERT INTO workspace_files (id, context, user_id, project_id, chat_id)
      VALUES ('chat', 'project', 'user-a', 'project-a', 'chat-a')`).rejects.toMatchObject({
      code: '23514',
    })
  })

  it.each(['workspace', 'chat', 'mothership', 'execution', 'workspace-logos'])(
    'requires a workspace owner on insert and update for %s files, including archived files',
    async (context) => {
      for (const deletedAt of [null, new Date()]) {
        await expect(sql`INSERT INTO workspace_files (id, context, user_id, deleted_at)
          VALUES ('unowned', ${context}, 'user-a', ${deletedAt})`).rejects.toMatchObject({
          code: '23514',
        })
      }
      await expect(sql`INSERT INTO workspace_files (id, context, user_id, organization_id)
        VALUES ('wrong-owner', ${context}, 'user-a', 'organization-a')`).rejects.toMatchObject({
        code: '23514',
      })
      await sql`INSERT INTO workspace_files (id, context, user_id, workspace_id)
        VALUES ('owned', ${context}, 'user-a', 'workspace-a')`
      await expect(
        sql`UPDATE workspace_files SET workspace_id = NULL WHERE id = 'owned'`
      ).rejects.toMatchObject({ code: '23514' })
      await sql`INSERT INTO workspace_files (id, context, user_id)
        VALUES ('personal', 'copilot', 'user-a')`
      await expect(
        sql`UPDATE workspace_files SET context = ${context} WHERE id = 'personal'`
      ).rejects.toMatchObject({ code: '23514' })
      expect(await sql`SELECT workspace_id FROM workspace_files WHERE id = 'owned'`).toEqual([
        { workspace_id: 'workspace-a' },
      ])
    }
  )

  it('keeps personal and both knowledge-base owner types valid', async () => {
    await sql`INSERT INTO workspace_files (id, context, user_id, workspace_id, organization_id)
      VALUES ('avatar', 'profile-pictures', 'user-a', NULL, NULL),
        ('personal', 'copilot', 'user-a', NULL, NULL),
        ('workspace-kb', 'knowledge-base', 'user-a', 'workspace-a', NULL),
        ('organization-kb', 'knowledge-base', 'user-a', NULL, 'organization-a')`
    expect(
      await sql`SELECT file.id, owner.entity_type, owner.entity_id
      FROM workspace_files file CROSS JOIN LATERAL workspace_file_owner(
        file.context, file.workspace_id, file.project_id, file.organization_id, file.user_id
      ) owner ORDER BY file.id`
    ).toEqual([
      { id: 'avatar', entity_type: 'user', entity_id: 'user-a' },
      { id: 'organization-kb', entity_type: 'organization', entity_id: 'organization-a' },
      { id: 'personal', entity_type: 'user', entity_id: 'user-a' },
      { id: 'workspace-kb', entity_type: 'workspace', entity_id: 'workspace-a' },
    ])
  })

  it('reports retained ownerless files without guessing, then validates after explicit repair and replays safely', async () => {
    await sql`ALTER TABLE workspace_files DROP CONSTRAINT workspace_files_workspace_binding_check`
    await sql`INSERT INTO workspace_files (id, context, user_id, deleted_at)
      VALUES ('legacy-unowned', 'workspace', 'user-a', now())`
    await applyMigration()
    await applyMigration()
    await expect(runScriptMigrations(sql, [validateFileWorkspaceBindingMigration])).rejects.toThrow(
      'Workspace-scoped files are missing workspace_id'
    )
    expect(await sql`SELECT name FROM script_migrations`).toEqual([])
    expect(await sql`SELECT workspace_id, user_id, key FROM workspace_files`).toEqual([
      { workspace_id: null, user_id: 'user-a', key: 'unchanged-object-key' },
    ])
    expect(
      await sql`SELECT convalidated FROM pg_constraint
      WHERE conrelid = 'workspace_files'::regclass
        AND conname = 'workspace_files_workspace_binding_check'`
    ).toEqual([{ convalidated: false }])
    await sql`UPDATE workspace_files SET workspace_id = 'workspace-b' WHERE id = 'legacy-unowned'`
    await runScriptMigrations(sql, [validateFileWorkspaceBindingMigration])
    await runScriptMigrations(sql, [validateFileWorkspaceBindingMigration])
    expect(await sql`SELECT name FROM script_migrations`).toEqual([
      { name: '0034_validate_file_workspace_binding' },
    ])
    expect(
      await sql`SELECT convalidated FROM pg_constraint
      WHERE conrelid = 'workspace_files'::regclass
        AND conname = 'workspace_files_workspace_binding_check'`
    ).toEqual([{ convalidated: true }])
  })

  it('allows independent concurrent file inserts into the same Project', async () => {
    const inserted = createDeferred<void>()
    const release = createDeferred<void>()
    const first = sql.begin(async (tx) => {
      await tx`INSERT INTO workspace_files (id, context, user_id, project_id)
        VALUES ('first', 'project', 'user-a', 'project-a')`
      inserted.resolve()
      await release.promise
    })
    try {
      await inserted.promise
      await sql.begin(async (tx) => {
        await tx`SET LOCAL statement_timeout = '2s'`
        await tx`INSERT INTO workspace_files (id, context, user_id, project_id)
          VALUES ('second', 'project', 'user-b', 'project-a')`
      })
    } finally {
      release.resolve()
      await first
    }
    expect(await sql`SELECT id FROM workspace_files ORDER BY id`).toEqual([
      { id: 'first' },
      { id: 'second' },
    ])
  })

  it('retains Project ownership through attribution changes and blocks owner deletion while retained files exist', async () => {
    const [projectBefore] = await sql`SELECT * FROM project WHERE id = 'project-a'`
    await sql`INSERT INTO workspace_files (id, context, user_id, project_id)
      VALUES ('file', 'project', 'user-a', 'project-a')`
    const [projectAfter] = await sql`SELECT * FROM project WHERE id = 'project-a'`
    expect(projectAfter).toEqual(projectBefore)
    await sql`UPDATE workspace_files SET user_id = 'user-b', deleted_at = now() WHERE id = 'file'`
    await expect(
      sql`UPDATE workspace_files SET project_id = NULL WHERE id = 'file'`
    ).rejects.toMatchObject({ code: '23514' })
    await expect(
      sql`UPDATE workspace_files SET project_id = 'project-b' WHERE id = 'file'`
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
    await sql`INSERT INTO workspace_files (id, context, user_id, project_id)
      VALUES ('shared-file', 'project', 'user-a', 'project-a')`
    await expect(sql`DELETE FROM "user" WHERE id = 'user-a'`).rejects.toMatchObject({
      code: '23503',
    })
    expect(await sql`SELECT id FROM workspace_files WHERE id = 'shared-file'`).toHaveLength(1)
    await sql`UPDATE workspace_files SET user_id = 'user-b' WHERE id = 'shared-file'`
    await sql`DELETE FROM "user" WHERE id = 'user-a'`
    const [file] =
      await sql`SELECT user_id, project_id FROM workspace_files WHERE id = 'shared-file'`
    expect(file).toEqual({ user_id: 'user-b', project_id: 'project-a' })
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
        await tx`INSERT INTO workspace_files (id, context, user_id, project_id)
        VALUES ('file', 'project', 'user-a', 'project-a')`
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
          code: '23503',
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
        await tx`INSERT INTO workspace_files (id, context, user_id, project_id)
          VALUES ('file', 'project', 'user-a', 'project-a')`
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
          await tx`INSERT INTO workspace_files (id, context, user_id, project_id)
          VALUES ('file', 'project', 'user-a', 'project-a')`
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
    const [row] = await sql`SELECT id, workspace_id, project_id FROM workspace_files`
    expect(row).toEqual({ id: 'file', workspace_id: 'workspace-a', project_id: null })
  })
})
