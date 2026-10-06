import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as schema from '@sim/db/schema'
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { withUtcTimestamps } from '@sim/db/timestamps'
import { generateId } from '@sim/utils/id'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const database = vi.hoisted(() => ({
  current: undefined as PostgresJsDatabase<typeof schema> | undefined,
}))
vi.mock('@sim/db', () => ({
  get db() {
    if (!database.current) throw new Error('Test database not initialized')
    return database.current
  },
}))

import { allocateIssueNumber, updateIssueInTx } from '@/lib/issues/repository'

const MIGRATIONS_DIR = join(__dirname, '../../../../packages/db/migrations')

/** Found by name, so renumbering on a rebase never strands the test on a missing file. */
function issueMigrationPath(): string {
  const [file, ...rest] = readdirSync(MIGRATIONS_DIR).filter((name) =>
    /^\d+_issue\.sql$/.test(name)
  )
  if (!file || rest.length > 0) throw new Error('Expected exactly one *_issue.sql migration')
  return join(MIGRATIONS_DIR, file)
}

/** The migration's own statements for the issue tables, checks, partial indexes and trigger. */
function issueStatements(): string[] {
  return readFileSync(issueMigrationPath(), 'utf-8')
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter(
      (statement) =>
        /^CREATE TABLE IF NOT EXISTS "issue(_counter|_event)?" /.test(statement) ||
        /^CREATE UNIQUE INDEX IF NOT EXISTS "issue_open_fingerprint_unique"/.test(statement) ||
        statement.includes('issue_working_chat_detached')
    )
}

/** The trigger, checks and guards that keep `in_progress` tied to a live working chat. */
describe('issue state in PostgreSQL', () => {
  const schemaName = `issue_repo_${generateId().replaceAll('-', '')}`
  const connection = postgres(
    readTestDatabaseUrl(),
    withUtcTimestamps({
      max: 2,
      connection: { search_path: schemaName },
      onnotice: () => undefined,
    })
  )

  beforeAll(async () => {
    await connection`CREATE SCHEMA ${connection(schemaName)}`
    await connection`CREATE TABLE copilot_chats (id uuid PRIMARY KEY)`
    for (const statement of issueStatements()) await connection.unsafe(statement)
    await connection`ALTER TABLE issue ADD FOREIGN KEY (working_chat_id) REFERENCES copilot_chats(id) ON DELETE SET NULL`
    database.current = drizzle(connection, { schema })
  })

  afterAll(async () => {
    await connection`DROP SCHEMA ${connection(schemaName)} CASCADE`
    await connection.end()
  })

  async function insertIssue(values: {
    number: number
    status?: string
    chatId?: string | null
    closeReason?: string | null
    fingerprint?: string | null
  }) {
    const id = generateId()
    await connection`INSERT INTO issue (id, workspace_id, number_scope_id, number, title, body_file_id, status, working_chat_id, close_reason, fingerprint, created_by_actor)
      VALUES (${id}, 'ws', 'ws', ${values.number}, 'Title', ${`file-${id}`}, ${values.status ?? 'inbox'}, ${values.chatId ?? null}, ${values.closeReason ?? null}, ${values.fingerprint ?? null}, '{}'::jsonb)`
    return id
  }

  async function newChat() {
    const id = generateId()
    await connection`INSERT INTO copilot_chats (id) VALUES (${id})`
    return id
  }

  async function read(id: string) {
    const [row] = await connection<{ status: string; working_chat_id: string | null }[]>`
      SELECT status, working_chat_id FROM issue WHERE id = ${id}`
    const events = await connection`SELECT kind, payload FROM issue_event WHERE issue_id = ${id}`
    return { ...row, events }
  }

  it('sends a working issue back to the inbox when its chat is deleted', async () => {
    const chatId = await newChat()
    const id = await insertIssue({ number: 1, status: 'in_progress', chatId })
    await connection`DELETE FROM copilot_chats WHERE id = ${chatId}`
    expect(await read(id)).toMatchObject({
      status: 'inbox',
      working_chat_id: null,
      events: [{ kind: 'chat_detached', payload: { chatId } }],
    })
  })

  it('leaves a done issue done, without a detach event, when its chat goes', async () => {
    const chatId = await newChat()
    const id = await insertIssue({
      number: 2,
      status: 'done',
      chatId,
      closeReason: 'completed',
    })
    await connection`DELETE FROM copilot_chats WHERE id = ${chatId}`
    expect(await read(id)).toMatchObject({ status: 'done', working_chat_id: null, events: [] })
  })

  it('refuses in_progress without a chat and done without a close reason', async () => {
    await expect(insertIssue({ number: 3, status: 'in_progress' })).rejects.toMatchObject({
      constraint_name: 'issue_working_chat_check',
    })
    await expect(insertIssue({ number: 4, status: 'done' })).rejects.toMatchObject({
      constraint_name: 'issue_close_reason_check',
    })
    await expect(
      insertIssue({ number: 5, status: 'inbox', closeReason: 'completed' })
    ).rejects.toMatchObject({ constraint_name: 'issue_close_reason_check' })
  })

  it('allows one open issue per fingerprint, and another once it is done', async () => {
    const first = await insertIssue({ number: 6, fingerprint: 'spike' })
    await expect(insertIssue({ number: 7, fingerprint: 'spike' })).rejects.toMatchObject({
      constraint_name: 'issue_open_fingerprint_unique',
    })
    await connection`UPDATE issue SET status = 'done', close_reason = 'completed' WHERE id = ${first}`
    await expect(insertIssue({ number: 8, fingerprint: 'spike' })).resolves.toBeTypeOf('string')
  })

  function testDb() {
    if (!database.current) throw new Error('Test database not initialized')
    return database.current
  }

  it('numbers issues per scope without gaps or collisions', async () => {
    const db = testDb()
    const numbers = await Promise.all(
      Array.from({ length: 5 }, () => db.transaction((tx) => allocateIssueNumber(tx, 'org-a')))
    )
    expect([...numbers].sort()).toEqual([1, 2, 3, 4, 5])
    expect(await db.transaction((tx) => allocateIssueNumber(tx, 'org-b'))).toBe(1)
  })

  it('refuses an edit when a field it changes no longer holds the value that was read', async () => {
    const db = testDb()
    const id = await insertIssue({ number: 11 })
    const rename = (from: string) =>
      db.transaction((tx) =>
        updateIssueInTx(
          tx,
          id,
          { statuses: ['inbox'], unchanged: { title: from } },
          { title: 'Renamed' }
        )
      )
    expect(await rename('Stale title')).toBeNull()
    expect((await rename('Title'))?.title).toBe('Renamed')
  })

  it('lets only one of two transitions from the same state win', async () => {
    const db = testDb()
    const chatA = await newChat()
    const chatB = await newChat()
    const id = await insertIssue({ number: 9 })
    const start = (chatId: string) =>
      db.transaction((tx) =>
        updateIssueInTx(
          tx,
          id,
          { statuses: ['inbox'], hasWorkingChat: false },
          { status: 'in_progress', workingChatId: chatId }
        )
      )
    const results = await Promise.all([start(chatA), start(chatB)])
    const winners = results.filter((row) => row !== null)
    expect(winners).toHaveLength(1)
    expect((await read(id)).working_chat_id).toBe(winners[0]?.workingChatId)
  })
})
