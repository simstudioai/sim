/** @vitest-environment node */
import { generateShortId } from '@sim/utils/id'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { database } = vi.hoisted(() => ({
  database: { current: undefined as PostgresJsDatabase | undefined },
}))
vi.unmock('@sim/db/schema')
vi.unmock('drizzle-orm')
vi.mock('@sim/db', () => ({
  db: {
    transaction: (...args: unknown[]) => {
      if (!database.current) throw new Error('Computer use test database is not initialized')
      return Reflect.apply(database.current.transaction, database.current, args)
    },
  },
}))

import { claimComputerUseTool } from '@/lib/computer-use/repository'

const databaseUrl = process.env.COMPUTER_USE_TEST_DATABASE_URL
if (databaseUrl && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(databaseUrl).hostname))
  throw new Error('Computer use tests require an isolated local PostgreSQL schema')
const schema = `computer_use_${generateShortId()
  .replace(/[^a-zA-Z0-9]/g, '')
  .toLowerCase()}`
const connection = databaseUrl
  ? postgres(databaseUrl, { max: 6, connection: { search_path: schema } })
  : undefined
const runId = '11111111-1111-4111-8111-111111111111'
const chatId = '22222222-2222-4222-8222-222222222222'
const input = { toolCallId: 'computer-1', runId, chatId, userId: 'user-1' }

afterAll(async () => {
  if (!connection) return
  await connection.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
  await connection.end()
})

describe.skipIf(!connection)('computer use one-shot admission in PostgreSQL', () => {
  beforeAll(async () => {
    if (!connection) throw new Error('Test database missing')
    await connection.unsafe(`CREATE SCHEMA "${schema}"`)
    await connection.unsafe(
      `CREATE TABLE copilot_chats (id uuid PRIMARY KEY, user_id text NOT NULL, deleted_at timestamp)`
    )
    await connection.unsafe(
      `CREATE TABLE copilot_runs (id uuid PRIMARY KEY, chat_id uuid NOT NULL, user_id text NOT NULL, status text NOT NULL, tool_admission_closed_at timestamp)`
    )
    await connection.unsafe(
      `CREATE TABLE copilot_async_tool_calls (tool_call_id text PRIMARY KEY, run_id uuid NOT NULL, tool_name text NOT NULL, args jsonb NOT NULL, status text NOT NULL, claimed_by text, claimed_at timestamp, created_at timestamp DEFAULT now(), updated_at timestamp DEFAULT now())`
    )
    database.current = drizzle(connection)
  })
  beforeEach(async () => {
    if (!connection) throw new Error('Test database missing')
    await connection`TRUNCATE copilot_chats, copilot_runs, copilot_async_tool_calls`
    await connection`INSERT INTO copilot_chats (id,user_id) VALUES (${chatId},'user-1')`
    await connection`INSERT INTO copilot_runs (id,chat_id,user_id,status) VALUES (${runId},${chatId},'user-1','active')`
    await connection`INSERT INTO copilot_async_tool_calls (tool_call_id,run_id,tool_name,args,status) VALUES ('computer-1',${runId},'computer','{"action":"list_apps","activity":{"title":"Inspecting apps"}}','pending')`
  })
  it('admits one of twelve concurrent executions and returns only canonical business arguments', async () => {
    const results = await Promise.all(Array.from({ length: 12 }, () => claimComputerUseTool(input)))
    expect(results.filter(Boolean)).toEqual([{ args: { action: 'list_apps' } }])
    expect(await claimComputerUseTool(input)).toBeNull()
    const [row] = await connection!`SELECT status, claimed_by FROM copilot_async_tool_calls`
    expect(row).toEqual({ status: 'running', claimed_by: 'desktop-computer' })
  })
  it.each(['complete', 'error', 'cancelled'])('refuses a %s run', async (status) => {
    await connection!`UPDATE copilot_runs SET status = ${status}`
    expect(await claimComputerUseTool(input)).toBeNull()
  })
  it('refuses a closed admission even while the run is still active', async () => {
    await connection!`UPDATE copilot_runs SET tool_admission_closed_at = now()`
    expect(await claimComputerUseTool(input)).toBeNull()
  })
  it('refuses old calls and leaves them unclaimed', async () => {
    await connection!`UPDATE copilot_async_tool_calls SET created_at = now() - interval '3 minutes'`
    expect(await claimComputerUseTool(input)).toBeNull()
    const [row] = await connection!`SELECT status FROM copilot_async_tool_calls`
    expect(row.status).toBe('pending')
  })
  it('binds run, chat and human owner independently', async () => {
    expect(await claimComputerUseTool({ ...input, userId: 'user-2' })).toBeNull()
    expect(await claimComputerUseTool({ ...input, chatId: runId })).toBeNull()
    expect(await claimComputerUseTool({ ...input, runId: chatId })).toBeNull()
    await connection!`UPDATE copilot_chats SET user_id = 'user-2'`
    expect(await claimComputerUseTool(input)).toBeNull()
  })
  it('rejects malformed canonical targets before consuming a claim', async () => {
    await connection!`UPDATE copilot_async_tool_calls SET args = '{"action":"click","bundleId":"com.apple.Notes"}'`
    expect(await claimComputerUseTool(input)).toBeNull()
    const [row] = await connection!`SELECT status, claimed_by FROM copilot_async_tool_calls`
    expect(row).toEqual({ status: 'pending', claimed_by: null })
  })
  it('rejects archived chats and non-computer tool names', async () => {
    await connection!`UPDATE copilot_chats SET deleted_at = now()`
    expect(await claimComputerUseTool(input)).toBeNull()
    await connection!`UPDATE copilot_chats SET deleted_at = NULL`
    await connection!`UPDATE copilot_async_tool_calls SET tool_name = 'terminal'`
    expect(await claimComputerUseTool(input)).toBeNull()
  })
})
