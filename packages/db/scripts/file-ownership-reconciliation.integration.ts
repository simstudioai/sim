import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { getPostgresErrorCode } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres, { type Sql } from 'postgres'
import { describe, expect, it } from 'vitest'

const databaseUrl = readTestDatabaseUrl()

async function withDatabase(run: (sql: Sql, url: string) => Promise<void>) {
  const admin = postgres(databaseUrl, { max: 1, onnotice: () => undefined })
  const name = `file_reconciliation_test_${generateId().replaceAll('-', '')}`
  let sql: Sql | undefined
  try {
    await admin`CREATE DATABASE ${admin(name)}`
    const url = new URL(databaseUrl)
    url.pathname = `/${name}`
    sql = postgres(url.toString(), { max: 1, onnotice: () => undefined })
    await run(sql, url.toString())
  } finally {
    await sql?.end()
    await admin`DROP DATABASE IF EXISTS ${admin(name)}`
    await admin.end()
  }
}

describe('file ownership provisioning and interrupted migration recovery', () => {
  it('retries an enum addition that committed before its journal insert failed', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'file-enum-replay-'))
    try {
      await mkdir(join(directory, 'meta'))
      await writeFile(join(directory, '0000_commit.sql'), 'COMMIT;')
      await writeFile(
        join(directory, '0001_upload_purpose.sql'),
        await readFile(
          new URL('../migrations/0411_project_file_upload_sessions.sql', import.meta.url)
        )
      )
      await writeFile(
        join(directory, 'meta/_journal.json'),
        JSON.stringify({
          version: '7',
          dialect: 'postgresql',
          entries: [
            { idx: 0, version: '7', when: 1, tag: '0000_commit', breakpoints: true },
            { idx: 1, version: '7', when: 2, tag: '0001_upload_purpose', breakpoints: true },
          ],
        })
      )
      await withDatabase(async (sql) => {
        await sql`CREATE TYPE upload_session_purpose AS ENUM ('workspace_file', 'table_import')`
        await sql`CREATE SCHEMA drizzle`
        await sql`CREATE TABLE drizzle.__drizzle_migrations (
          id serial PRIMARY KEY, hash text NOT NULL, created_at bigint,
          CONSTRAINT reject_enum_journal CHECK (created_at <> 2)
        )`
        const run = () => migrate(drizzle(sql), { migrationsFolder: directory })
        await expect(run()).rejects.toSatisfy(
          (error: unknown) => getPostgresErrorCode(error) === '23514'
        )
        expect(await sql`SELECT enum_range(NULL::upload_session_purpose)::text AS labels`).toEqual([
          { labels: '{workspace_file,project_file,table_import}' },
        ])
        expect(await sql`SELECT created_at::int FROM drizzle.__drizzle_migrations`).toEqual([
          { created_at: 1 },
        ])
        await sql`ALTER TABLE drizzle.__drizzle_migrations DROP CONSTRAINT reject_enum_journal`
        await run()
        await run()
        expect(
          await sql`SELECT created_at::int FROM drizzle.__drizzle_migrations ORDER BY created_at`
        ).toEqual([{ created_at: 1 }, { created_at: 2 }])
        expect(await sql`SELECT enum_range(NULL::upload_session_purpose)::text AS labels`).toEqual([
          { labels: '{workspace_file,project_file,table_import}' },
        ])
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('reconciles missing precision triggers while preserving legacy no-op fences', async () => {
    await withDatabase(async (sql, url) => {
      const run = (script: string) =>
        promisify(execFile)('bun', ['--no-env-file', script], {
          cwd: new URL('..', import.meta.url),
          env: { ...process.env, DATABASE_URL: url, MIGRATION_DATABASE_URL: url },
          timeout: 120_000,
        })
      await run('scripts/migrate.ts')
      await sql`DROP TRIGGER workspace_files_content_version_millisecond ON workspace_files`
      await sql`INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
        VALUES ('owner', 'Owner', 'owner@example.com', false, now(), now())`
      await sql`INSERT INTO workspace_files
        (id, key, user_id, context, original_name, content_type, content_updated_at)
        VALUES ('legacy', 'legacy-key', 'owner', 'copilot', 'legacy.txt', 'text/plain',
          '2026-08-01 03:30:51.566952')`
      await run('scripts/reconcile-file-ownership.ts')
      await run('scripts/reconcile-file-ownership.ts')
      await sql`UPDATE workspace_files SET id = id WHERE id = 'legacy'`
      expect(await sql`SELECT content_updated_at::text AS revision FROM workspace_files`).toEqual([
        { revision: '2026-08-01 03:30:51.566952' },
      ])
      await sql`UPDATE workspace_files SET original_name = 'renamed.txt' WHERE id = 'legacy'`
      expect(await sql`SELECT content_updated_at::text AS revision FROM workspace_files`).toEqual([
        { revision: '2026-08-01 03:30:51.566' },
      ])
      await sql`INSERT INTO workspace_files
        (id, key, user_id, context, original_name, content_type, content_updated_at)
        VALUES ('raw', 'raw-key', 'owner', 'copilot', 'raw.txt', 'text/plain',
          '2026-08-01 03:30:51.123456')`
      expect(
        await sql`SELECT content_updated_at::text AS revision FROM workspace_files WHERE id = 'raw'`
      ).toEqual([{ revision: '2026-08-01 03:30:51.123' }])
    })
  })
})
