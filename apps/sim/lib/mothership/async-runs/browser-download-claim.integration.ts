/**
 * Exercises download admission and its additive migration against an isolated local PostgreSQL
 * schema in the disposable integration database (TEST_DATABASE_URL).
 */
import { readFile } from 'node:fs/promises'
import { generateShortId } from '@sim/utils/id'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { database } = vi.hoisted(() => ({
  database: { current: undefined as PostgresJsDatabase | undefined },
}))
vi.mock('@sim/db', () => ({
  db: {
    update: (...args: unknown[]) => {
      if (!database.current) throw new Error('PostgreSQL test database is not initialized')
      return Reflect.apply(database.current.update, database.current, args)
    },
  },
}))

import {
  claimBrowserDownloadSave,
  completeClaimedAsyncToolCall,
} from '@/lib/mothership/async-runs/repository'

const databaseUrl = process.env.TEST_DATABASE_URL
if (databaseUrl && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(databaseUrl).hostname)) {
  throw new Error('Browser download PostgreSQL tests require a local database')
}
const schema = `browser_download_${generateShortId()
  .replace(/[^a-zA-Z0-9]/g, '')
  .toLowerCase()}`
const connection = databaseUrl
  ? postgres(databaseUrl, { max: 4, connection: { search_path: schema } })
  : undefined

afterAll(async () => {
  if (!connection) return
  await connection.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
  await connection.end()
})

describe.skipIf(!connection)('browser download admission with PostgreSQL', () => {
  beforeAll(async () => {
    if (!connection) throw new Error('PostgreSQL test database is not initialized')
    await connection.unsafe(`CREATE SCHEMA "${schema}"`)
    await connection.unsafe(`CREATE TABLE copilot_async_tool_calls (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid NOT NULL, checkpoint_id uuid,
      tool_call_id text NOT NULL UNIQUE, tool_name text NOT NULL,
      args jsonb NOT NULL DEFAULT '{}', status text NOT NULL DEFAULT 'pending',
      result jsonb, error text, permission_decision text, permission_decided_at timestamp,
      claimed_at timestamp, claimed_by text, execution_started_at timestamp,
      execution_settled_at timestamp, execution_owner_token text,
      execution_lease_expires_at timestamptz, execution_revoked_at timestamptz,
      client_workflow_execution_id text, sandbox_processes jsonb NOT NULL DEFAULT '{}',
      completed_at timestamp, created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )`)
    const migration = await readFile(
      new URL(
        '../../../../../packages/db/migrations/0381_browser_download_save_claim.sql',
        import.meta.url
      ),
      'utf8'
    )
    await connection.unsafe(migration)
    await connection.unsafe(migration)
    database.current = drizzle(connection)
  })

  beforeEach(async () => {
    if (!connection) throw new Error('PostgreSQL test database is not initialized')
    await connection`TRUNCATE copilot_async_tool_calls`
    await connection`INSERT INTO copilot_async_tool_calls (run_id, tool_call_id, tool_name, status, claimed_by)
      VALUES (gen_random_uuid(), 'download-1', 'browser_save_download', 'running', 'desktop-browser')`
  })

  it('admits exactly one concurrent write and never reopens that admission', async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, () => claimBrowserDownloadSave('download-1'))
    )
    expect(results.filter(Boolean)).toHaveLength(1)
    expect(await claimBrowserDownloadSave('download-1')).toBe(false)
    const [row] =
      await connection!`SELECT status, claimed_by, result, browser_download_started_at IS NOT NULL AS started FROM copilot_async_tool_calls`
    expect(row).toMatchObject({ status: 'running', claimed_by: 'desktop-browser', result: null })
    expect(row.started).toBe(true)
  })

  it.each([
    ['pending', 'desktop-browser', 'browser_save_download'],
    ['cancelled', 'desktop-browser', 'browser_save_download'],
    ['completed', 'desktop-browser', 'browser_save_download'],
    ['running', 'desktop-terminal', 'browser_save_download'],
    ['running', 'desktop-browser', 'browser_upload_file'],
  ])('rejects status=%s owner=%s tool=%s', async (status, owner, tool) => {
    await connection!`UPDATE copilot_async_tool_calls SET status = ${status}, claimed_by = ${owner}, tool_name = ${tool}`
    expect(await claimBrowserDownloadSave('download-1')).toBe(false)
  })

  it('does not consume an unrelated call', async () => {
    expect(await claimBrowserDownloadSave('other-download')).toBe(false)
    expect(await claimBrowserDownloadSave('download-1')).toBe(true)
  })

  it('preserves ordinary native completion and its terminal result', async () => {
    expect(await claimBrowserDownloadSave('download-1')).toBe(true)
    const row = await completeClaimedAsyncToolCall(
      { toolCallId: 'download-1', status: 'completed', result: { path: 'files/report.csv' } },
      'desktop-browser'
    )
    expect(row).toMatchObject({
      status: 'completed',
      claimedBy: null,
      result: { path: 'files/report.csv' },
      browserDownloadStartedAt: expect.any(Date),
    })
    expect(await claimBrowserDownloadSave('download-1')).toBe(false)
  })
})
