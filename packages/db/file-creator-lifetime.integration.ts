import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const databaseUrl = readTestDatabaseUrl()
const migrations = [
  '0404_file_entity_ownership.sql',
  '0405_file_folder_version_ownership.sql',
  '0406_file_creator_lifetime.sql',
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
    'Project deletion guard refuses cascading creator erasure until the handoff is complete',
    async () => {
      await sql`INSERT INTO folder (id,name,user_id,resource_type,project_id) VALUES ('folder','Docs','user-a','file','project-a')`
      await sql`INSERT INTO workspace_files (id,context,user_id,project_id,folder_id) VALUES ('file','project','user-a','project-a','folder')`
      await sql`INSERT INTO workspace_file_version (id,file_id,author_user_ids) VALUES ('version','file',ARRAY['user-a'])`
      await expect(sql`DELETE FROM "user" WHERE id='user-a'`).rejects.toMatchObject({
        code: '23514',
      })
      await sql`UPDATE workspace_files SET user_id='user-b' WHERE id='file'`
      await expect(sql`DELETE FROM "user" WHERE id='user-a'`).rejects.toMatchObject({
        code: '23514',
      })
      await sql`UPDATE folder SET user_id='user-b' WHERE id='folder'`
      await sql`DELETE FROM "user" WHERE id='user-a'`
      expect(await sql`SELECT user_id,key FROM workspace_files`).toEqual([
        { user_id: 'user-b', key: 'unchanged-object-key' },
      ])
      expect(await sql`SELECT author_user_ids FROM workspace_file_version`).toEqual([
        { author_user_ids: ['user-a'] },
      ])
    }
  )
  check('file creators remain required and actual user references in both scopes', async () => {
    for (const context of ['workspace', 'project'])
      for (const userId of [null, 'missing']) {
        await expect(
          sql`INSERT INTO workspace_files (id,context,user_id,workspace_id,project_id) VALUES ('file',${context},${userId},${context === 'workspace' ? 'workspace-a' : null},${context === 'project' ? 'project-a' : null})`
        ).rejects.toMatchObject({ code: userId === null ? '23502' : '23503' })
        await expect(
          sql`INSERT INTO folder (id,name,user_id,resource_type,workspace_id,project_id) VALUES ('folder','Docs',${userId},'file',${context === 'workspace' ? 'workspace-a' : null},${context === 'project' ? 'project-a' : null})`
        ).rejects.toMatchObject({ code: userId === null ? '23502' : '23503' })
      }
  })
  check('native Project owner references still refuse direct root deletion', async () => {
    await sql`INSERT INTO workspace_files (id,context,user_id,project_id) VALUES ('file','project','user-a','project-a')`
    await expect(sql`DELETE FROM project WHERE id='project-a'`).rejects.toMatchObject({
      code: '23503',
    })
  })
  check(
    'creator guard can be replayed without weakening existing resource protection',
    async () => {
      await applyMigration(migrations[2])
      await applyMigration(migrations[2])
      await sql`INSERT INTO folder (id,name,user_id,resource_type,project_id,deleted_at) VALUES ('folder','Archived','user-a','file','project-a',now())`
      await expect(sql`DELETE FROM "user" WHERE id='user-a'`).rejects.toMatchObject({
        code: '23514',
      })
    }
  )
})
