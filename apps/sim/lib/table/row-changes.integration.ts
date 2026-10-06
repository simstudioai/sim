/**
 * The table row-change log against real PostgreSQL: reads add the unfolded tail, and the fold
 * moves it into the definition row without changing what a reader sees, under concurrent appends.
 */
import { db } from '@sim/db'
import { userTableDefinitions } from '@sim/db/schema'
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { generateId } from '@sim/utils/id'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  foldPendingTableRowChanges,
  foldTableRowChanges,
  readCurrentRowsVersion,
} from '@/lib/table/row-changes'
import { getTableById, listTables } from '@/lib/table/service'

const url = readTestDatabaseUrl()
if (process.env.DATABASE_URL !== url) {
  throw new Error('This suite requires only the disposable local test database')
}
const control = postgres(url, { max: 8, onnotice: () => {} })
const workspaceId = generateId()
const userId = generateId()

async function createTable(): Promise<string> {
  const id = generateId()
  await db
    .insert(userTableDefinitions)
    .values({ id, workspaceId, name: id, schema: { columns: [] }, createdBy: userId })
  return id
}

async function logChanges(tableId: string, ...deltas: number[]) {
  for (const delta of deltas) {
    await control`INSERT INTO user_table_row_changes (table_id, row_delta) VALUES (${tableId}, ${delta})`
  }
}

async function stored(tableId: string) {
  const [row] = await control<{ row_count: number; rows_version: string; updated_at: Date }[]>`
    SELECT row_count, rows_version, updated_at FROM user_table_definitions WHERE id = ${tableId}`
  return {
    rowCount: row.row_count,
    rowsVersion: Number(row.rows_version),
    updatedAt: row.updated_at,
  }
}

async function tailLength(tableId: string): Promise<number> {
  const [{ n }] = await control<{ n: number }[]>`
    SELECT count(*)::int AS n FROM user_table_row_changes WHERE table_id = ${tableId}`
  return n
}

async function liveRowCount(tableId: string): Promise<number> {
  const table = await getTableById(tableId)
  if (!table) throw new Error('Fixture table missing')
  return table.rowCount
}

describe('table row-change log against real PostgreSQL', () => {
  beforeAll(async () => {
    await control`INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
      VALUES (${userId}, 'Row change fixture', ${`${userId}@example.test`}, true, now(), now())`
    await control`INSERT INTO workspace (id, name, owner_id, billed_account_user_id)
      VALUES (${workspaceId}, 'Row change fixtures', ${userId}, ${userId})`
  })

  afterAll(async () => {
    await control`DELETE FROM workspace WHERE id = ${workspaceId}`
    await control`DELETE FROM "user" WHERE id = ${userId}`
    await control.end()
  })

  it('reads the stored count and version plus the unfolded tail', async () => {
    const tableId = await createTable()
    await logChanges(tableId, 5, -2, 0)

    expect(await liveRowCount(tableId)).toBe(3)
    expect(await readCurrentRowsVersion(tableId)).toBe(3)
    expect(await readCurrentRowsVersion(tableId, workspaceId)).toBe(3)
    expect(await readCurrentRowsVersion(tableId, generateId())).toBeNull()
    const listed = (await listTables(workspaceId)).find((table) => table.id === tableId)
    expect(listed?.rowCount).toBe(3)
  })

  it('folds the tail into the definition row without changing what readers see', async () => {
    const tableId = await createTable()
    const before = await stored(tableId)
    await logChanges(tableId, 4, 0, -1)

    expect(await foldTableRowChanges(tableId)).toBe(true)

    expect(await tailLength(tableId)).toBe(0)
    const after = await stored(tableId)
    expect(after.rowCount).toBe(3)
    expect(after.rowsVersion).toBe(3)
    expect(after.updatedAt.getTime()).toBeGreaterThanOrEqual(before.updatedAt.getTime())
    expect(await liveRowCount(tableId)).toBe(3)
    expect(await readCurrentRowsVersion(tableId)).toBe(3)
  })

  it('leaves updated_at alone when the tail holds only updates', async () => {
    const tableId = await createTable()
    const before = await stored(tableId)
    await logChanges(tableId, 0, 0)

    await foldTableRowChanges(tableId)

    const after = await stored(tableId)
    expect(after.rowsVersion).toBe(2)
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime())
  })

  it('skips a table whose definition row is held instead of waiting on it', async () => {
    const tableId = await createTable()
    await logChanges(tableId, 2)

    const held = control.begin(async (holder) => {
      await holder`SELECT 1 FROM user_table_definitions WHERE id = ${tableId} FOR NO KEY UPDATE`
      const started = Date.now()
      const folded = await foldTableRowChanges(tableId)
      return { folded, elapsedMs: Date.now() - started }
    })
    const { folded, elapsedMs } = await held

    expect(folded).toBe(false)
    expect(elapsedMs).toBeLessThan(1_000)
    expect(await tailLength(tableId)).toBe(1)
    expect(await liveRowCount(tableId)).toBe(2)
  })

  it('keeps the live version exact and non-decreasing while writers append during folds', async () => {
    const tableId = await createTable()
    const writers = 8
    const appendsPerWriter = 40
    let appending = true

    const appenders = Array.from({ length: writers }, async () => {
      for (let i = 0; i < appendsPerWriter; i++) await logChanges(tableId, 1)
    })
    const folder = (async () => {
      while (appending) await foldTableRowChanges(tableId)
    })()
    const versionsSeen: number[] = []
    const reader = (async () => {
      while (appending) {
        const version = await readCurrentRowsVersion(tableId)
        if (version === null) throw new Error('Fixture table missing')
        versionsSeen.push(version)
      }
    })()

    await Promise.all(appenders)
    appending = false
    await Promise.all([folder, reader])

    const total = writers * appendsPerWriter
    expect(await readCurrentRowsVersion(tableId)).toBe(total)
    expect(await liveRowCount(tableId)).toBe(total)
    for (let i = 1; i < versionsSeen.length; i++) {
      expect(versionsSeen[i]).toBeGreaterThanOrEqual(versionsSeen[i - 1])
    }

    await foldTableRowChanges(tableId)
    expect(await tailLength(tableId)).toBe(0)
    expect(await stored(tableId)).toMatchObject({ rowCount: total, rowsVersion: total })
  })

  it('sweeps every table with a tail', async () => {
    const tableIds = [await createTable(), await createTable(), await createTable()]
    for (const tableId of tableIds) await logChanges(tableId, 1, 1)

    const result = await foldPendingTableRowChanges(30_000)

    expect(result.budgetExhausted).toBe(false)
    expect(result.folded).toBeGreaterThanOrEqual(tableIds.length)
    for (const tableId of tableIds) {
      expect(await tailLength(tableId)).toBe(0)
      expect(await stored(tableId)).toMatchObject({ rowCount: 2, rowsVersion: 2 })
    }
  })
})
