import { readFileSync } from 'node:fs'
import { validateFileOwnershipMigration } from '@sim/db/script-migrations/0031_validate_file_ownership'
import { runScriptMigrations } from '@sim/db/script-migrations/index'
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const databaseUrl = readTestDatabaseUrl()
const migrations = ['0404_file_entity_ownership.sql', '0405_file_folder_version_ownership.sql'].map(
  (name) => readFileSync(new URL(`./migrations/${name}`, import.meta.url), 'utf8')
)

describe('file folder and version ownership in PostgreSQL', () => {
  const schemaName = `file_relations_${generateId().replaceAll('-', '')}`
  let sql: Sql
  let admin: Sql

  async function applyMigration(migration: string) {
    for (const statement of migration.split('--> statement-breakpoint')) {
      if (statement.trim()) await sql.unsafe(statement)
    }
  }

  async function waitForDatabaseLock(pid: number, writerPid: number) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const [state] = await sql<{ waiting: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM unnest(pg_blocking_pids(${pid})) blocker WHERE blocker = ${writerPid}
        ) AS waiting
      `
      if (state.waiting) return
      await sleep(10)
    }
    throw new Error('Concurrent relationship operation did not wait for its database lock')
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
      UNIQUE(file_id, version)
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
    }
  })

  it('preserves metadata and content changes on existing workspace files with retained versions', async () => {
    await sql`INSERT INTO workspace_files (id, context, user_id, workspace_id)
      VALUES ('file', 'workspace', 'user-a', 'workspace-a')`
    await sql`INSERT INTO workspace_file_version (id, file_id) VALUES ('version', 'file')`
    await sql`UPDATE workspace_files SET key = 'new-revision-key', original_name = 'renamed.md' WHERE id = 'file'`
    const [file] =
      await sql`SELECT workspace_id, project_id, key, secret_provenance_version FROM workspace_files`
    expect(file).toEqual({
      workspace_id: 'workspace-a',
      project_id: null,
      key: 'new-revision-key',
      secret_provenance_version: 1,
    })
  })

  it('blocks release on conflicting retained ownership and retries after an explicit repair', async () => {
    await sql`INSERT INTO workspace_files (id, context, user_id, workspace_id)
      VALUES ('file', 'workspace', 'user-a', 'workspace-a')`
    await sql`ALTER TABLE workspace_file_version DISABLE TRIGGER workspace_file_version_owner_match`
    try {
      await sql`INSERT INTO workspace_file_version (id, file_id, workspace_id)
        VALUES ('conflicting-version', 'file', 'workspace-b')`
    } finally {
      await sql`ALTER TABLE workspace_file_version ENABLE TRIGGER workspace_file_version_owner_match`
    }

    await expect(runScriptMigrations(sql, [validateFileOwnershipMigration])).rejects.toThrow(
      'Retained file versions require ownership repair'
    )
    expect(await sql`SELECT name FROM script_migrations`).toEqual([])
    expect(
      await sql`SELECT workspace_id, key FROM workspace_file_version WHERE id = 'conflicting-version'`
    ).toEqual([{ workspace_id: 'workspace-b', key: 'unchanged-version-key' }])

    await sql`UPDATE workspace_file_version SET workspace_id = 'workspace-a'
      WHERE id = 'conflicting-version'`
    await runScriptMigrations(sql, [validateFileOwnershipMigration])
    await runScriptMigrations(sql, [validateFileOwnershipMigration])
    expect(await sql`SELECT name FROM script_migrations`).toEqual([
      { name: '0031_validate_file_ownership' },
    ])
    expect(
      await sql`SELECT workspace_id, key FROM workspace_file_version WHERE id = 'conflicting-version'`
    ).toEqual([{ workspace_id: 'workspace-a', key: 'unchanged-version-key' }])
  })

  it('requires explicit Project file-folder ownership and rejects unknown or conflicting bindings', async () => {
    const [before] = await sql`SELECT * FROM project WHERE id = 'project-a'`
    await sql`INSERT INTO folder (id, name, user_id, resource_type, project_id)
      VALUES ('project-folder', 'Documentation', 'user-a', 'file', 'project-a')`
    const [after] = await sql`SELECT * FROM project WHERE id = 'project-a'`
    expect(after).toEqual(before)
    for (const resourceType of ['workflow', 'knowledge_base', 'table']) {
      await expect(sql`INSERT INTO folder (id, name, user_id, resource_type, project_id)
        VALUES (${resourceType}, 'Invalid', 'user-a', ${resourceType}, 'project-a')`).rejects.toMatchObject(
        { code: '23514' }
      )
    }
    await expect(sql`INSERT INTO folder (id, name, user_id, resource_type)
      VALUES ('invalid', 'Invalid', 'user-a', 'file')`).rejects.toMatchObject({ code: '23514' })
    await expect(sql`INSERT INTO folder (id, name, user_id, workspace_id, resource_type, project_id)
      VALUES ('conflict', 'Invalid', 'user-a', 'workspace-a', 'file', 'project-a')`).rejects.toMatchObject(
      { code: '23514' }
    )
    await expect(sql`INSERT INTO folder (id, name, user_id, resource_type, project_id)
      VALUES ('missing', 'Invalid', 'user-a', 'file', 'missing')`).rejects.toMatchObject({
      code: '23503',
    })
  })

  it('keeps folder identity and type immutable and rejects cross-owner parents', async () => {
    await sql`INSERT INTO folder (id, name, user_id, workspace_id, resource_type)
      VALUES ('file-folder', 'Files', 'user-a', 'workspace-a', 'file'),
        ('other-folder', 'Files', 'user-a', 'workspace-b', 'file'),
        ('workflow-folder', 'Workflows', 'user-a', 'workspace-a', 'workflow')`
    await expect(
      sql`UPDATE folder SET parent_id = 'other-folder' WHERE id = 'file-folder'`
    ).rejects.toMatchObject({ code: '23514' })
    await expect(
      sql`UPDATE folder SET parent_id = 'workflow-folder' WHERE id = 'file-folder'`
    ).rejects.toMatchObject({ code: '23514' })
    await expect(
      sql`UPDATE folder SET workspace_id = 'workspace-b' WHERE id = 'file-folder'`
    ).rejects.toMatchObject({ code: '23514' })
    await expect(
      sql`UPDATE folder SET resource_type = 'table' WHERE id = 'file-folder'`
    ).rejects.toMatchObject({ code: '23514' })
    await expect(
      sql`UPDATE folder SET id = 'renamed-id' WHERE id = 'file-folder'`
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('supports child-before-parent bulk creation and rejects cycles after the complete statement', async () => {
    await sql`INSERT INTO folder (id, name, user_id, workspace_id, resource_type, parent_id)
      VALUES ('child', 'Child', 'user-a', 'workspace-a', 'file', 'parent'),
        ('parent', 'Parent', 'user-a', 'workspace-a', 'file', NULL)`
    await expect(
      sql`UPDATE folder SET parent_id = 'child' WHERE id = 'parent'`
    ).rejects.toMatchObject({ code: '23514' })
    await expect(sql`UPDATE folder SET parent_id = id WHERE id = 'parent'`).rejects.toMatchObject({
      code: '23514',
    })
    await expect(sql`INSERT INTO folder (id, name, user_id, workspace_id, resource_type, parent_id)
      VALUES ('cycle-a', 'A', 'user-a', 'workspace-a', 'file', 'cycle-b'),
        ('cycle-b', 'B', 'user-a', 'workspace-a', 'file', 'cycle-a')`).rejects.toMatchObject({
      code: '23514',
    })
    expect(await sql`SELECT id FROM folder ORDER BY id`).toEqual([
      { id: 'child' },
      { id: 'parent' },
    ])
  })

  it('separates active names by owner type and parent and rejects conflicting restoration', async () => {
    await sql`INSERT INTO folder (id, name, user_id, workspace_id, resource_type)
      VALUES ('workspace-folder', 'Docs', 'user-a', 'same-id', 'file')`
    await sql`INSERT INTO folder (id, name, user_id, resource_type, project_id)
      VALUES ('project-folder', 'Docs', 'user-a', 'file', 'same-id')`
    await expect(
      sql`UPDATE folder SET parent_id = 'workspace-folder' WHERE id = 'project-folder'`
    ).rejects.toMatchObject({ code: '23514' })
    await expect(sql`INSERT INTO folder (id, name, user_id, resource_type, project_id)
      VALUES ('duplicate', 'Docs', 'user-a', 'file', 'same-id')`).rejects.toMatchObject({
      code: '23505',
    })
    await sql`INSERT INTO folder (id, name, user_id, resource_type, project_id, parent_id)
      VALUES ('nested', 'Docs', 'user-a', 'file', 'same-id', 'project-folder')`
    await sql`INSERT INTO folder (id, name, user_id, resource_type, project_id, deleted_at)
      VALUES ('deleted', 'Docs', 'user-a', 'file', 'same-id', now())`
    await expect(
      sql`UPDATE folder SET deleted_at = NULL WHERE id = 'deleted'`
    ).rejects.toMatchObject({ code: '23505' })
    await sql`INSERT INTO workspace_files (id, context, user_id, project_id)
      VALUES ('project-file', 'project', 'user-a', 'same-id')`
    await sql`INSERT INTO workspace_files (id, context, user_id, workspace_id)
      VALUES ('workspace-file', 'workspace', 'user-a', 'same-id')`
    await expect(sql`INSERT INTO workspace_files (id, context, user_id, project_id)
      VALUES ('duplicate-file', 'project', 'user-a', 'same-id')`).rejects.toMatchObject({
      code: '23505',
    })
    await sql`INSERT INTO workspace_files (id, context, user_id, project_id, folder_id)
      VALUES ('nested-file', 'project', 'user-a', 'same-id', 'project-folder')`
  })

  it('accepts Project file folders and rejects mismatched owners and resource types', async () => {
    await sql`INSERT INTO folder (id, name, user_id, workspace_id, resource_type)
      VALUES ('workspace-folder', 'Files', 'user-a', 'workspace-a', 'file'),
        ('workflow-folder', 'Workflows', 'user-a', 'workspace-a', 'workflow')`
    await sql`INSERT INTO folder (id, name, user_id, resource_type, project_id)
      VALUES ('project-folder', 'Docs', 'user-a', 'file', 'project-a')`
    await sql`INSERT INTO workspace_files (id, context, user_id, project_id, folder_id)
      VALUES ('project-file', 'project', 'user-a', 'project-a', 'project-folder')`
    await expect(
      sql`UPDATE workspace_files SET folder_id = 'workspace-folder' WHERE id = 'project-file'`
    ).rejects.toMatchObject({ code: '23514' })
    await expect(sql`INSERT INTO workspace_files (id, context, user_id, workspace_id, folder_id)
      VALUES ('workspace-file', 'workspace', 'user-a', 'workspace-a', 'workflow-folder')`).rejects.toMatchObject(
      { code: '23514' }
    )
    await expect(sql`INSERT INTO workspace_files (id, context, user_id, workspace_id, folder_id)
      VALUES ('other-file', 'workspace', 'user-a', 'workspace-b', 'workspace-folder')`).rejects.toMatchObject(
      { code: '23514' }
    )
  })

  it('protects retained Project folders from parent and creator deletion', async () => {
    await sql`INSERT INTO folder (id, name, user_id, resource_type, project_id, deleted_at)
      VALUES ('project-folder', 'Docs', 'user-a', 'file', 'project-a', now())`
    await expect(sql`DELETE FROM project WHERE id = 'project-a'`).rejects.toMatchObject({
      code: '23503',
    })
    await expect(sql`DELETE FROM "user" WHERE id = 'user-a'`).rejects.toMatchObject({
      code: '23503',
    })
    await sql`UPDATE folder SET user_id = 'user-b' WHERE id = 'project-folder'`
    await sql`DELETE FROM "user" WHERE id = 'user-a'`
    expect(await sql`SELECT id FROM folder`).toHaveLength(1)
    await sql`DELETE FROM folder WHERE id = 'project-folder'`
    await sql`DELETE FROM project WHERE id = 'project-a'`
  })

  it('derives version ownership from the file and refuses incompatible legacy pointers', async () => {
    await sql`INSERT INTO workspace_files (id, context, user_id, workspace_id)
      VALUES ('workspace-file', 'workspace', 'user-a', 'workspace-a'),
        ('chat-file', 'mothership', 'user-a', 'workspace-a')`
    await sql`INSERT INTO workspace_files (id, context, user_id, project_id)
      VALUES ('project-file', 'project', 'user-a', 'project-a')`
    await sql`INSERT INTO workspace_files (id, context, user_id) VALUES ('personal', 'copilot', 'user-a')`
    await sql`INSERT INTO workspace_file_version (id, file_id)
      VALUES ('workspace-version', 'workspace-file'), ('project-version', 'project-file')`
    expect(await sql`SELECT id, workspace_id FROM workspace_file_version ORDER BY id`).toEqual([
      { id: 'project-version', workspace_id: null },
      { id: 'workspace-version', workspace_id: 'workspace-a' },
    ])
    for (const fileId of ['project-file', 'chat-file', 'personal']) {
      await expect(sql`INSERT INTO workspace_file_version (id, file_id, workspace_id, version)
        VALUES ('invalid', ${fileId}, 'workspace-a', 2)`).rejects.toMatchObject({ code: '23514' })
    }
    await expect(sql`INSERT INTO workspace_file_version (id, file_id, workspace_id, version)
      VALUES ('mismatch', 'workspace-file', 'workspace-b', 2)`).rejects.toMatchObject({
      code: '23514',
    })
    await expect(
      sql`UPDATE workspace_file_version SET file_id = 'project-file' WHERE id = 'workspace-version'`
    ).rejects.toMatchObject({ code: '23514' })
    await expect(
      sql`UPDATE workspace_files SET workspace_id = 'workspace-b' WHERE id = 'workspace-file'`
    ).rejects.toMatchObject({ code: '23514' })
    await expect(
      sql`UPDATE workspace_files SET context = 'mothership' WHERE id = 'workspace-file'`
    ).rejects.toMatchObject({ code: '23514' })
    await sql`DELETE FROM workspace_files WHERE id = 'project-file'`
    expect(
      await sql`SELECT id FROM workspace_file_version WHERE id = 'project-version'`
    ).toHaveLength(0)
    await sql`DELETE FROM workspace WHERE id = 'workspace-a'`
    expect(await sql`SELECT id FROM workspace_file_version`).toHaveLength(0)
  })

  it.each([
    ['workspace', 'read committed'],
    ['workspace', 'repeatable read'],
    ['project', 'read committed'],
    ['project', 'repeatable read'],
  ])(
    'prevents concurrent crossed folder moves for %s at %s isolation',
    async (ownerType, isolation) => {
      const ownerId = ownerType === 'workspace' ? 'workspace-a' : 'project-a'
      const workspaceId = ownerType === 'workspace' ? ownerId : null
      const projectId = ownerType === 'project' ? ownerId : null
      const lockKey = `resource_folders:file:${ownerType === 'workspace' ? ownerId : `${ownerType}:${ownerId}`}`
      await sql`INSERT INTO folder (id, name, user_id, workspace_id, resource_type, project_id)
      VALUES ('folder-a', 'A', 'user-a', ${workspaceId}, 'file', ${projectId}),
        ('folder-b', 'B', 'user-a', ${workspaceId}, 'file', ${projectId})`
      const moved = createDeferred<number>()
      const release = createDeferred<void>()
      const firstMove = sql.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`
        await tx`UPDATE folder SET parent_id = 'folder-b' WHERE id = 'folder-a'`
        const [writer] = await tx<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`
        moved.resolve(writer.pid)
        await release.promise
      })
      const waiting = createDeferred<number>()
      let rejection: Promise<void> | undefined
      try {
        await moved.promise
        const secondMove = sql.begin(`isolation level ${isolation}`, async (tx) => {
          await tx`SET LOCAL statement_timeout = '5s'`
          const [backend] = await tx<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`
          waiting.resolve(backend.pid)
          await tx`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`
          await tx`UPDATE folder SET parent_id = 'folder-a' WHERE id = 'folder-b'`
        })
        rejection = expect(secondMove).rejects.toMatchObject({
          code: isolation === 'repeatable read' ? '40001' : '23514',
        })
        await waitForDatabaseLock(await waiting.promise, await moved.promise)
      } finally {
        release.resolve()
        await firstMove
        await rejection
      }
      expect(await sql`SELECT id, parent_id FROM folder ORDER BY id`).toEqual([
        { id: 'folder-a', parent_id: 'folder-b' },
        { id: 'folder-b', parent_id: null },
      ])
    }
  )

  it.each(['read committed', 'repeatable read'])(
    'prevents an owner change from racing a retained version at %s isolation',
    async (isolation) => {
      await sql`INSERT INTO workspace_files (id, context, user_id, workspace_id)
        VALUES ('file', 'workspace', 'user-a', 'workspace-a')`
      const inserted = createDeferred<number>()
      const release = createDeferred<void>()
      const creation = sql.begin(async (tx) => {
        await tx`INSERT INTO workspace_file_version (id, file_id, workspace_id)
          VALUES ('version', 'file', 'workspace-a')`
        const [writer] = await tx<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`
        inserted.resolve(writer.pid)
        await release.promise
      })
      const waiting = createDeferred<number>()
      let rejection: Promise<void> | undefined
      try {
        await inserted.promise
        const transfer = sql.begin(`isolation level ${isolation}`, async (tx) => {
          await tx`SET LOCAL statement_timeout = '5s'`
          const [backend] = await tx<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`
          waiting.resolve(backend.pid)
          await tx`UPDATE workspace_files SET workspace_id = 'workspace-b' WHERE id = 'file'`
        })
        rejection = expect(transfer).rejects.toMatchObject({
          code: isolation === 'repeatable read' ? '40001' : '23514',
        })
        await waitForDatabaseLock(await waiting.promise, await inserted.promise)
      } finally {
        release.resolve()
        await creation
        await rejection
      }
      const [file] = await sql`SELECT workspace_id FROM workspace_files WHERE id = 'file'`
      expect(file.workspace_id).toBe('workspace-a')
    }
  )

  it.each(['read committed', 'repeatable read'])(
    'rejects a stale version pointer after a concurrent owner change at %s isolation',
    async (isolation) => {
      await sql`INSERT INTO workspace_files (id, context, user_id, workspace_id)
        VALUES ('file', 'workspace', 'user-a', 'workspace-a')`
      const moved = createDeferred<number>()
      const release = createDeferred<void>()
      const transfer = sql.begin(async (tx) => {
        await tx`UPDATE workspace_files SET workspace_id = 'workspace-b' WHERE id = 'file'`
        const [writer] = await tx<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`
        moved.resolve(writer.pid)
        await release.promise
      })
      const waiting = createDeferred<number>()
      let rejection: Promise<void> | undefined
      try {
        await moved.promise
        const creation = sql.begin(`isolation level ${isolation}`, async (tx) => {
          await tx`SET LOCAL statement_timeout = '5s'`
          const [backend] = await tx<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`
          waiting.resolve(backend.pid)
          await tx`INSERT INTO workspace_file_version (id, file_id, workspace_id)
            VALUES ('version', 'file', 'workspace-a')`
        })
        rejection = expect(creation).rejects.toMatchObject({
          code: isolation === 'repeatable read' ? '40001' : '23514',
        })
        await waitForDatabaseLock(await waiting.promise, await moved.promise)
      } finally {
        release.resolve()
        await transfer
        await rejection
      }
      expect(await sql`SELECT id FROM workspace_file_version`).toHaveLength(0)
    }
  )

  it.each(['read committed', 'repeatable read'])(
    'protects a Project from concurrent folder creation and deletion at %s isolation',
    async (isolation) => {
      const inserted = createDeferred<number>()
      const release = createDeferred<void>()
      const creation = sql.begin(async (tx) => {
        await tx`INSERT INTO folder (id, name, user_id, resource_type, project_id)
          VALUES ('folder', 'Docs', 'user-a', 'file', 'project-a')`
        const [writer] = await tx<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`
        inserted.resolve(writer.pid)
        await release.promise
      })
      const waiting = createDeferred<number>()
      let rejection: Promise<void> | undefined
      try {
        await inserted.promise
        const deletion = sql.begin(`isolation level ${isolation}`, async (tx) => {
          await tx`SET LOCAL statement_timeout = '5s'`
          const [backend] = await tx<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`
          waiting.resolve(backend.pid)
          await tx`DELETE FROM project WHERE id = 'project-a'`
        })
        rejection = expect(deletion).rejects.toMatchObject({
          code: '23503',
        })
        await waitForDatabaseLock(await waiting.promise, await inserted.promise)
      } finally {
        release.resolve()
        await creation
        await rejection
      }
      expect(await sql`SELECT id FROM folder WHERE id = 'folder'`).toHaveLength(1)
    }
  )

  it('replays the expansion while preserving existing Project folders and version pointers', async () => {
    await sql`INSERT INTO folder (id, name, user_id, resource_type, project_id)
      VALUES ('folder', 'Docs', 'user-a', 'file', 'project-a')`
    await sql`INSERT INTO workspace_files (id, context, user_id, project_id, folder_id)
      VALUES ('file', 'project', 'user-a', 'project-a', 'folder')`
    await sql`INSERT INTO workspace_file_version (id, file_id) VALUES ('version', 'file')`
    await applyMigration(migrations[1])
    const [file] = await sql`SELECT folder_id, key,
      content_updated_at = TIMESTAMP '2026-10-03 01:02:03.456' AS revision_unchanged,
      secret_provenance_version FROM workspace_files`
    expect(file).toMatchObject({
      folder_id: 'folder',
      key: 'unchanged-object-key',
      secret_provenance_version: 1,
      revision_unchanged: true,
    })
    expect(await sql`SELECT file_id, key FROM workspace_file_version`).toEqual([
      { file_id: 'file', key: 'unchanged-version-key' },
    ])
  })
})

describe('file ownership composed with enforced Project membership', () => {
  it('preserves Project lifecycle checks and public metadata through folder, file, and version writes', async () => {
    const admin = postgres(databaseUrl, { max: 1, onnotice: () => undefined })
    const name = `file_owner_chain_test_${generateId().replaceAll('-', '')}`
    const url = new URL(databaseUrl)
    url.pathname = `/${name}`
    await admin.unsafe(`CREATE DATABASE "${name}"`)
    const chain = postgres(url.toString(), { max: 1, onnotice: () => undefined })
    try {
      await chain.unsafe(`
        CREATE TABLE "user" (id text PRIMARY KEY);
        CREATE TABLE organization (id text PRIMARY KEY);
        CREATE TABLE workspace (
          id text PRIMARY KEY, name text NOT NULL, owner_id text NOT NULL,
          organization_id text, archived_at timestamp,
          forked_from_workspace_id text REFERENCES workspace(id) ON DELETE SET NULL
        );
        CREATE TABLE workflow (
          id text PRIMARY KEY, workspace_id text REFERENCES workspace(id) ON DELETE CASCADE,
          archived_at timestamp
        );
        CREATE TABLE folder (
          id text PRIMARY KEY, name text NOT NULL,
          user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
          workspace_id text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
          resource_type text NOT NULL, parent_id text REFERENCES folder(id) ON DELETE SET NULL,
          deleted_at timestamp
        );
        CREATE TABLE workspace_files (
          id text PRIMARY KEY, context text NOT NULL,
          user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
          workspace_id text REFERENCES workspace(id) ON DELETE CASCADE,
          organization_id text REFERENCES organization(id) ON DELETE CASCADE,
          folder_id text REFERENCES folder(id) ON DELETE SET NULL,
          chat_id text, original_name text NOT NULL DEFAULT 'document.md', deleted_at timestamp
        );
        CREATE TABLE workspace_file_version (
          id text PRIMARY KEY, file_id text NOT NULL REFERENCES workspace_files(id) ON DELETE CASCADE,
          workspace_id text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE
        );
        INSERT INTO "user" VALUES ('owner'), ('creator');
        INSERT INTO workspace (id, name, owner_id) VALUES ('environment', 'Production', 'owner');
      `)
      for (const source of [
        readFileSync(new URL('./migrations/0394_project_foundation.sql', import.meta.url), 'utf8'),
        readFileSync(
          new URL('./migrations/0403_project_membership_enforcement.sql', import.meta.url),
          'utf8'
        ),
        ...migrations,
      ]) {
        for (const statement of source.split('--> statement-breakpoint')) {
          if (statement.trim()) await chain.unsafe(statement)
        }
      }
      const [project] = await chain<{ id: string }[]>`SELECT id FROM project`
      const [before] = await chain`SELECT * FROM project WHERE id = ${project.id}`
      await chain`INSERT INTO folder (id, name, user_id, resource_type, project_id)
        VALUES ('folder', 'Architecture', 'creator', 'file', ${project.id})`
      await chain`INSERT INTO workspace_files (id, context, user_id, project_id, folder_id)
        VALUES ('file', 'project', 'creator', ${project.id}, 'folder')`
      await chain`INSERT INTO workspace_file_version (id, file_id) VALUES ('version', 'file')`
      const [after] = await chain`SELECT * FROM project WHERE id = ${project.id}`
      expect(after).toEqual(before)
      await expect(chain`DELETE FROM "user" WHERE id = 'creator'`).rejects.toMatchObject({
        code: '23503',
      })
      await expect(chain`DELETE FROM workspace WHERE id = 'environment'`).rejects.toMatchObject({
        code: '23514',
      })
      await chain.begin(async (tx) => {
        await tx`UPDATE workspace SET archived_at = now() WHERE id = 'environment'`
        await tx`UPDATE project SET archived_at = now() WHERE id = ${project.id}`
      })
      expect(await chain`SELECT id, workspace_id FROM workspace_file_version`).toEqual([
        { id: 'version', workspace_id: null },
      ])
      expect(await chain`SELECT id FROM folder`).toEqual([{ id: 'folder' }])
      expect(await chain`SELECT id FROM workspace_files`).toEqual([{ id: 'file' }])
    } finally {
      await chain.end({ timeout: 2 })
      await admin.unsafe(`DROP DATABASE "${name}" WITH (FORCE)`)
      await admin.end()
    }
  })
})
