import { readFileSync } from 'node:fs'
import path from 'node:path'
import { backfillFileDiscoveryMigration } from '@sim/db/script-migrations/0025_backfill_file_discovery'
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { generateId } from '@sim/utils/id'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

describe('file discovery migration in PostgreSQL', () => {
  const schema = `discovery_${generateId().replaceAll('-', '')}`
  let connection: Sql
  let admin: Sql

  beforeAll(async () => {
    admin = postgres(readTestDatabaseUrl(), { max: 1, onnotice: () => undefined })
    await admin`CREATE SCHEMA ${admin(schema)}`
    connection = postgres(readTestDatabaseUrl(), {
      max: 2,
      connection: { search_path: schema },
      onnotice: () => undefined,
    })
    await connection`CREATE TABLE workspace_files (
      id text PRIMARY KEY, workspace_id text, context text NOT NULL, content_type text,
      key text NOT NULL DEFAULT 'unchanged', deleted_at timestamp,
      content_updated_at timestamp NOT NULL DEFAULT '2026-01-01', updated_at timestamp NOT NULL DEFAULT '2026-01-01'
    )`
    await connection`CREATE TABLE workspace_file_search_build (id text PRIMARY KEY, expires_at timestamp)`
    await connection`CREATE TABLE workspace_file_search_revision (
      file_id text PRIMARY KEY, workspace_id text, source_content_updated_at timestamp, build_id text
    )`
    await connection`CREATE TABLE workspace_file_search_dispatch_queue (
      workspace_id text PRIMARY KEY, enqueued_at timestamp, updated_at timestamp
    )`
    await connection`INSERT INTO workspace_files (id, context, content_type)
      VALUES ('workspace', 'workspace', 'text/plain'), ('dashboard', 'workspace', 'text/x-sim-dashboard')`
    await connection`INSERT INTO workspace_files (id, context, deleted_at)
      SELECT 'upload-' || lpad(n::text, 5, '0'), 'mothership',
        CASE WHEN n % 2 = 0 THEN timestamp '2026-02-01' END FROM generate_series(1, 1005) n`
    const source = readFileSync(
      path.join(__dirname, '../migrations/0385_file_discovery.sql'),
      'utf8'
    ).replaceAll('"public".', `"${schema}".`)
    for (const statement of source.split('--> statement-breakpoint')) {
      if (statement.trim()) await connection.unsafe(statement)
    }
  })

  afterAll(async () => {
    await connection?.end()
    await admin?.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await admin?.end()
  })

  it('backfills across pages without migrating dashboard rows or changing content/ownership', async () => {
    await backfillFileDiscoveryMigration.up(connection)
    const [row] = await connection`SELECT count(*)::int AS count FROM workspace_files
      WHERE context = 'mothership' AND discovery = 'unlisted' AND key = 'unchanged'
        AND content_updated_at = '2026-01-01' AND updated_at = '2026-01-01'`
    expect(row.count).toBe(1005)
    const visible =
      await connection`SELECT id FROM workspace_files WHERE discovery = 'listed' ORDER BY id`
    expect(visible.map((file) => file.id)).toEqual(['dashboard', 'workspace'])
    const before = await connection`SELECT id, xmin::text FROM workspace_files ORDER BY id`
    await backfillFileDiscoveryMigration.up(connection)
    expect(await connection`SELECT id, xmin::text FROM workspace_files ORDER BY id`).toEqual(before)
  })

  it('covers old chat writers and ownership promotion while preserving explicit workspace discovery', async () => {
    await connection`INSERT INTO workspace_files (id, workspace_id, context)
      VALUES ('old-chat', 'ws', 'mothership')`
    expect(
      (await connection`SELECT discovery FROM workspace_files WHERE id = 'old-chat'`)[0].discovery
    ).toBe('unlisted')
    await connection`UPDATE workspace_files SET context = 'workspace' WHERE id = 'old-chat'`
    expect(
      (await connection`SELECT discovery FROM workspace_files WHERE id = 'old-chat'`)[0].discovery
    ).toBe('listed')
    await connection`INSERT INTO workspace_files (id, workspace_id, context, discovery)
      VALUES ('new-dashboard', 'ws', 'workspace', 'unlisted')`
    await connection`UPDATE workspace_files SET updated_at = now(), context = 'workspace' WHERE id = 'new-dashboard'`
    expect(
      (await connection`SELECT discovery FROM workspace_files WHERE id = 'new-dashboard'`)[0]
        .discovery
    ).toBe('unlisted')
    await expect(connection`INSERT INTO workspace_files (id, context, discovery)
      VALUES ('bad', 'workspace', 'typo')`).rejects.toMatchObject({ code: '22P02' })
  })

  it('retires indexed content on hide and schedules it again on relist without advancing its revision', async () => {
    await connection`INSERT INTO workspace_files (id, workspace_id, context) VALUES ('search', 'ws', 'workspace')`
    await connection`INSERT INTO workspace_file_search_build (id) VALUES ('build')`
    await connection`UPDATE workspace_file_search_revision SET build_id = 'build' WHERE file_id = 'search'`
    await connection`UPDATE workspace_files SET discovery = 'unlisted' WHERE id = 'search'`
    expect(
      await connection`SELECT * FROM workspace_file_search_revision WHERE file_id = 'search'`
    ).toHaveLength(0)
    expect(
      (
        await connection`SELECT expires_at IS NOT NULL AS retired FROM workspace_file_search_build WHERE id = 'build'`
      )[0].retired
    ).toBe(true)
    await connection`UPDATE workspace_files SET discovery = 'listed' WHERE id = 'search'`
    expect(
      (
        await connection`SELECT source_content_updated_at = '2026-01-01' AS same FROM workspace_file_search_revision WHERE file_id = 'search'`
      )[0].same
    ).toBe(true)
  })
})
