/**
 * Row-write integration tests against the provisioned, disposable TEST_DATABASE_URL database (the
 * integration setup points DATABASE_URL at it too). The unique-value locks run for real
 * everywhere; the `rows_version` cases also need the migrated deferred trigger and skip without it.
 */
import { db } from '@sim/db'
import { userTableDefinitions, userTableRows } from '@sim/db/schema'
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { storageServiceMock, storageServiceMockFns } from '@sim/testing/mocks/storage-service.mock'
import { tableBillingMock, tableBillingMockFns } from '@sim/testing/mocks/table-billing.mock'
import { tableTriggerMock, tableTriggerMockFns } from '@sim/testing/mocks/table-trigger.mock'
import { tableWorkflowColumnsMock } from '@sim/testing/mocks/table-workflow-columns.mock'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { sql } from 'drizzle-orm'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/table/billing', () => tableBillingMock)
vi.mock('@/lib/table/trigger', () => tableTriggerMock)
vi.mock('@/lib/table/workflow-columns', () => tableWorkflowColumnsMock)
vi.mock('@/lib/uploads/core/storage-service', () => storageServiceMock)

import { deleteColumn, updateColumnConstraints } from '@/lib/table/columns/service'
import { getMaxRowSizeBytes } from '@/lib/table/constants'
import { bulkInsertImportBatch, importAppendRows, importReplaceRows } from '@/lib/table/import-data'
import type { DbTransaction } from '@/lib/table/planner'
import { readCurrentRowsVersion } from '@/lib/table/row-changes'
import { lockLiveTableSchema } from '@/lib/table/rows/live-schema'
import {
  batchInsertRows,
  batchUpdateRows,
  deleteRowsByFilter,
  insertRow,
  replaceTableRows,
  updateRow,
  updateRowsByFilter,
  upsertRow,
} from '@/lib/table/rows/service'
import { lockUniqueColumns, lockUniqueValues } from '@/lib/table/rows/unique-locks'
import { getTableById } from '@/lib/table/service'
import { getOrCreateTableSnapshot } from '@/lib/table/snapshot-cache'
import type { ColumnDefinition, JsonValue, RowData, TableDefinition } from '@/lib/table/types'

const url = readTestDatabaseUrl()
if (process.env.DATABASE_URL !== url) {
  throw new Error('This suite requires only the disposable local test database')
}
const control = postgres(url, { max: 4, onnotice: () => {} })
const workspaceId = generateId()
const userId = generateId()

/**
 * `db:push` never installs the migration-only `rows_version` triggers, and a database migrated
 * only through 0240 has a statement-level UPDATE trigger under the same name. Only the deferred
 * constraint trigger satisfies the `rows_version` cases, so only it enables them.
 */
const [{ migrated }] = await control<{ migrated: boolean }[]>`SELECT EXISTS (
  SELECT 1 FROM pg_trigger t
  JOIN pg_proc p ON p.oid = t.tgfoid
  WHERE t.tgrelid = 'user_table_rows'::regclass
    AND t.tgname = 'user_table_rows_version_update_trigger'
    AND t.tgconstraint <> 0
    AND t.tgdeferrable
    AND t.tginitdeferred
    AND p.proname = 'bump_user_table_rows_version_at_commit'
) AS migrated`

/** Whether the row triggers log to `user_table_row_changes` (0402) rather than lock the definition. */
const [{ logsRowChanges }] = await control<{ logsRowChanges: boolean }[]>`SELECT EXISTS (
  SELECT 1 FROM pg_proc
  WHERE proname = 'increment_user_table_row_count_stmt' AND prosrc LIKE '%user_table_row_changes%'
) AS "logsRowChanges"`

async function createTable(columns: ColumnDefinition[]): Promise<TableDefinition> {
  const id = generateId()
  await db
    .insert(userTableDefinitions)
    .values({ id, workspaceId, name: id, schema: { columns }, createdBy: userId })
  const table = await getTableById(id)
  if (!table) throw new Error('Fixture table was not created')
  return table
}

async function seedRows(
  tableId: string,
  rows: Array<{ id: string; data: RowData; orderKey: string | null }>
) {
  await db.insert(userTableRows).values(rows.map((row) => ({ ...row, tableId, workspaceId })))
}

async function rowsVersion(tableId: string): Promise<number> {
  const version = await readCurrentRowsVersion(tableId)
  if (version === null) throw new Error('Fixture table missing')
  return version
}

const textColumns = (...ids: string[]): ColumnDefinition[] =>
  ids.map((id) => ({ id, name: id, type: 'string' }))

/** Sessions waiting on the table's schema lock, matched by the key's hash as `pg_locks` shows it. */
async function schemaLockWaiters(tableId: string): Promise<number> {
  const [{ waiting }] = await control<{ waiting: number }[]>`
    WITH lock AS (SELECT hashtextextended(${`user_table_schema:${tableId}`}, 0) AS key)
    SELECT count(*)::int AS waiting FROM pg_locks l CROSS JOIN lock
    WHERE l.locktype = 'advisory' AND NOT l.granted
      AND l.classid = ((lock.key >> 32) & 4294967295)::oid
      AND l.objid = (lock.key & 4294967295)::oid`
  return waiting
}

/** Polls until exactly `expected` sessions wait on the table's schema lock, and asserts it. */
async function untilSchemaLockWaiters(tableId: string, expected: number) {
  let waiting = 0
  for (let attempt = 0; attempt < 400 && waiting !== expected; attempt++) {
    await sleep(5)
    waiting = await schemaLockWaiters(tableId)
  }
  expect(waiting).toBe(expected)
}

type LockWaiters = { onDefinitionRow: number; onValueLock: number }

/** The session {@link raceUnderHeldDefinitionRow} holds the definition row in, while it does. */
let definitionRowHolder: number | null = null

/**
 * Polls until exactly `expected.onDefinitionRow` sessions wait on the held definition row (directly,
 * or queued behind an earlier waiter for it) and `expected.onValueLock` wait on one of the table's
 * unique locks, and returns the last count seen. Both counts are scoped to the table, so concurrent
 * suites cannot skew them: a unique-lock waiter waits on the table's unique lock itself, or on a
 * value lock while holding the table's unique lock shared.
 */
async function waitForLockWaiters(tableId: string, expected: LockWaiters) {
  const uniqueLockKey = `user_table_unique:${tableId}`
  let waiting: LockWaiters = { onDefinitionRow: 0, onValueLock: 0 }
  for (let attempt = 0; attempt < 400; attempt++) {
    await sleep(5)
    ;[waiting] = await control<LockWaiters[]>`
      WITH RECURSIVE behind_holder(pid) AS (
        SELECT pid FROM pg_stat_activity
        WHERE ${definitionRowHolder ?? 0}::int = ANY (pg_blocking_pids(pid))
        UNION
        SELECT a.pid FROM pg_stat_activity a
        JOIN behind_holder b ON b.pid = ANY (pg_blocking_pids(a.pid))
      ), lock AS (
        SELECT hashtextextended(${uniqueLockKey}, 0) AS unique_key
      ), advisory AS (
        SELECT l.pid, l.granted,
          l.classid = ((lock.unique_key >> 32) & 4294967295)::oid
            AND l.objid = (lock.unique_key & 4294967295)::oid AS is_unique
        FROM pg_locks l CROSS JOIN lock
        WHERE l.locktype = 'advisory'
          AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database())
      )
      SELECT
        (SELECT count(*) FROM pg_stat_activity a JOIN behind_holder USING (pid)
          WHERE a.wait_event IN ('tuple', 'transactionid'))::int AS "onDefinitionRow",
        count(*) FILTER (
          WHERE NOT granted AND (
            is_unique OR pid IN (SELECT pid FROM advisory WHERE granted AND is_unique)
          )
        )::int AS "onValueLock"
      FROM advisory`
    if (
      waiting.onDefinitionRow === expected.onDefinitionRow &&
      waiting.onValueLock === expected.onValueLock
    ) {
      break
    }
  }
  return waiting
}

/**
 * Holds the table's definition row `FOR UPDATE` while `writes` start, and releases it only once
 * exactly `onDefinitionRow` of them wait on it and `onValueLock` wait on a unique-value lock. An
 * insert's row write checks the row's foreign key to the definition, after its value locks and
 * unique check, so this pins every write mid-flight; releasing any earlier could let them run
 * one after another and prove nothing about the race.
 */
async function raceUnderHeldDefinitionRow(
  tableId: string,
  writes: Array<() => Promise<unknown>>,
  expected: LockWaiters
): Promise<PromiseSettledResult<unknown>[]> {
  const holder = await control.reserve()
  try {
    await holder`BEGIN`
    const [{ pid }] = await holder<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`
    definitionRowHolder = pid
    await holder`SELECT 1 FROM user_table_definitions WHERE id = ${tableId} FOR UPDATE`
    const racers = Promise.allSettled(writes.map((write) => write()))
    expect(await waitForLockWaiters(tableId, expected)).toEqual(expected)
    await holder`COMMIT`
    return await racers
  } finally {
    definitionRowHolder = null
    await holder`ROLLBACK`.catch(() => {})
    holder.release()
  }
}

describe('table row writes against real PostgreSQL', () => {
  beforeAll(async () => {
    await control`INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
      VALUES (${userId}, 'Row write fixture', ${`${userId}@example.test`}, true, now(), now())`
    await control`INSERT INTO workspace (id, name, owner_id, billed_account_user_id)
      VALUES (${workspaceId}, 'Row write fixtures', ${userId}, ${userId})`
  })

  beforeEach(() => {
    tableBillingMockFns.mockAssertRowCapacity.mockResolvedValue(10_000)
  })

  afterAll(async () => {
    await control`DELETE FROM workspace WHERE id = ${workspaceId}`
    await control`DELETE FROM "user" WHERE id = ${userId}`
    await control.end()
  })

  describe('unique columns under concurrent writes', () => {
    const uniqueColumns: ColumnDefinition[] = [
      { id: 'email', name: 'email', type: 'string', unique: true },
      { id: 'score', name: 'score', type: 'number', unique: true },
    ]

    const insertEmail = (table: TableDefinition, email: string) =>
      insertRow(
        {
          tableId: table.id,
          workspaceId,
          data: { email },
          secretProvenance: undefined,
          capabilityGovernedUserId: null,
        },
        table,
        'unique-race'
      )

    async function storedCount(tableId: string, match: Record<string, JsonValue>) {
      const [{ count }] = await control<{ count: number }[]>`SELECT count(*)::int AS count
        FROM user_table_rows WHERE table_id = ${tableId} AND data @> ${control.json(match)}`
      return count
    }

    const fulfilled = (results: PromiseSettledResult<unknown>[]) =>
      results.filter((result) => result.status === 'fulfilled').length

    it('rejects the second of two concurrent single-row inserts of the same value', async () => {
      const table = await createTable(uniqueColumns)

      const results = await raceUnderHeldDefinitionRow(
        table.id,
        [
          () => insertEmail(table, 'dup@example.test'),
          () => insertEmail(table, 'dup@example.test'),
        ],
        { onDefinitionRow: 1, onValueLock: 1 }
      )

      expect(fulfilled(results)).toBe(1)
      expect(await storedCount(table.id, { email: 'dup@example.test' })).toBe(1)
    })

    it('treats values the unique check equates as the same value', async () => {
      const table = await createTable(uniqueColumns)
      const insertScore = (score: string | number) => () =>
        insertRow(
          {
            tableId: table.id,
            workspaceId,
            data: { score },
            secretProvenance: undefined,
            capabilityGovernedUserId: null,
          },
          table,
          'unique-race'
        )

      const results = await raceUnderHeldDefinitionRow(
        table.id,
        [insertScore('8'), insertScore(8)],
        {
          onDefinitionRow: 1,
          onValueLock: 1,
        }
      )

      expect(fulfilled(results)).toBe(1)
      expect(await storedCount(table.id, { score: 8 })).toBe(1)
    })

    it('lets concurrent inserts of different values proceed together', async () => {
      const table = await createTable(uniqueColumns)

      const results = await raceUnderHeldDefinitionRow(
        table.id,
        [() => insertEmail(table, 'a@example.test'), () => insertEmail(table, 'b@example.test')],
        { onDefinitionRow: 2, onValueLock: 0 }
      )

      expect(fulfilled(results)).toBe(2)
    })

    it('rejects a single insert racing a batch insert that holds the same value', async () => {
      const table = await createTable(uniqueColumns)

      const results = await raceUnderHeldDefinitionRow(
        table.id,
        [
          () =>
            batchInsertRows(
              {
                tableId: table.id,
                workspaceId,
                rows: [{ email: 'x@example.test' }, { email: 'dup@example.test' }],
                secretProvenance: undefined,
                capabilityGovernedUserId: null,
              },
              table,
              'unique-race'
            ),
          () => insertEmail(table, 'dup@example.test'),
        ],
        { onDefinitionRow: 1, onValueLock: 1 }
      )

      expect(fulfilled(results)).toBe(1)
      expect(await storedCount(table.id, { email: 'dup@example.test' })).toBe(1)
    })

    it('rejects an edit to a value a concurrent insert is writing', async () => {
      const table = await createTable(uniqueColumns)
      await seedRows(table.id, [
        { id: `${table.id}-a`, data: { email: 'a@example.test' }, orderKey: 'a0' },
      ])

      const results = await raceUnderHeldDefinitionRow(
        table.id,
        [
          () => insertEmail(table, 'dup@example.test'),
          async () => {
            // Start the edit only once the insert has passed its check and holds its locks.
            expect(
              await waitForLockWaiters(table.id, { onDefinitionRow: 1, onValueLock: 0 })
            ).toEqual({
              onDefinitionRow: 1,
              onValueLock: 0,
            })
            return updateRow(
              {
                tableId: table.id,
                rowId: `${table.id}-a`,
                workspaceId,
                data: { email: 'dup@example.test' },
                secretProvenance: undefined,
                capabilityGovernedUserId: null,
              },
              table,
              'unique-race'
            )
          },
        ],
        { onDefinitionRow: 1, onValueLock: 1 }
      )

      expect(fulfilled(results)).toBe(1)
      expect(await storedCount(table.id, { email: 'dup@example.test' })).toBe(1)
    })

    it('lets a replace that adds the first unique column wait out a writer on an older schema', async () => {
      const table = await createTable([{ id: 'name', name: 'name', type: 'string' }])
      // The writer resolved the table while it still had a unique column, so it holds the unique
      // lock shared and will write its row next.
      const stale: TableDefinition = {
        ...table,
        schema: { columns: [...table.schema.columns, ...uniqueColumns] },
      }
      let holdsUniqueLock!: () => void
      const holding = new Promise<void>((resolve) => {
        holdsUniqueLock = resolve
      })
      let release!: () => void
      const released = new Promise<void>((resolve) => {
        release = resolve
      })
      const writer = db.transaction(async (trx) => {
        await lockUniqueValues(trx, stale, [{ email: 'stale@example.test' }])
        holdsUniqueLock()
        await released
        await trx.insert(userTableRows).values({
          id: `${table.id}-stale`,
          tableId: table.id,
          workspaceId,
          data: { email: 'stale@example.test' },
          orderKey: 'a0',
        })
      })
      await holding

      let replace: Promise<unknown> | undefined
      try {
        replace = importReplaceRows(
          table,
          [{ id: 'code', name: 'code', type: 'string', unique: true }],
          { rows: [{ name: 'fresh', code: 'c-1' }], workspaceId },
          'unique-race'
        )
        expect(await waitForLockWaiters(table.id, { onDefinitionRow: 0, onValueLock: 1 })).toEqual({
          onDefinitionRow: 0,
          onValueLock: 1,
        })
      } finally {
        release()
      }

      const results = await Promise.allSettled([writer, replace])
      expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled'])
    })

    it('holds a bounded number of locks however many unique columns a table has', async () => {
      const wide: ColumnDefinition[] = Array.from({ length: 100 }, (_, i) => ({
        id: `code_${i}`,
        name: `code_${i}`,
        type: 'string',
        unique: true,
      }))
      const table = await createTable(wide)
      const row = Object.fromEntries(wide.map((_, i) => [`code_${i}`, `value-${i}`]))
      const advisoryLocksHeld = async (lock: (trx: DbTransaction) => Promise<void>) =>
        db.transaction(async (trx) => {
          await lock(trx)
          const [{ held }] = await trx.execute<{ held: number }>(sql`SELECT count(*)::int AS held
            FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid()`)
          return held
        })

      expect(await advisoryLocksHeld((trx) => lockUniqueValues(trx, table, [row]))).toBe(1)
      expect(await advisoryLocksHeld((trx) => lockUniqueColumns(trx, table))).toBe(1)
      const narrow = { code_0: 'value-0', code_1: 'value-1' }
      expect(await advisoryLocksHeld((trx) => lockUniqueValues(trx, table, [narrow]))).toBe(3)
    })

    it('serializes a batch over the value-lock cap against a single insert of the same value', async () => {
      const table = await createTable(uniqueColumns)
      // More values than the per-transaction value-lock cap, so the batch locks the column instead.
      const rows = Array.from({ length: 80 }, (_, i) => ({ email: `bulk-${i}@example.test` }))
      rows.push({ email: 'dup@example.test' })

      const results = await raceUnderHeldDefinitionRow(
        table.id,
        [
          () =>
            batchInsertRows(
              {
                tableId: table.id,
                workspaceId,
                rows,
                secretProvenance: undefined,
                capabilityGovernedUserId: null,
              },
              table,
              'unique-race'
            ),
          () => insertEmail(table, 'dup@example.test'),
        ],
        { onDefinitionRow: 1, onValueLock: 1 }
      )

      expect(fulfilled(results)).toBe(1)
      expect(await storedCount(table.id, { email: 'dup@example.test' })).toBe(1)
    })

    it('rejects an import batch racing a single insert of the same value', async () => {
      const table = await createTable(uniqueColumns)

      const results = await raceUnderHeldDefinitionRow(
        table.id,
        [
          () => insertEmail(table, 'dup@example.test'),
          async () => {
            // Start the import only once the insert has passed its check and holds its locks.
            expect(
              await waitForLockWaiters(table.id, { onDefinitionRow: 1, onValueLock: 0 })
            ).toEqual({
              onDefinitionRow: 1,
              onValueLock: 0,
            })
            return bulkInsertImportBatch(
              {
                tableId: table.id,
                workspaceId,
                rows: [{ email: 'x@example.test' }, { email: 'dup@example.test' }],
                startPosition: 0,
              },
              table,
              'unique-race'
            )
          },
        ],
        { onDefinitionRow: 1, onValueLock: 1 }
      )

      expect(fulfilled(results)).toBe(1)
      expect(await storedCount(table.id, { email: 'dup@example.test' })).toBe(1)
    })

    it('rejects a batch update that writes one value to two rows', async () => {
      const table = await createTable(uniqueColumns)
      await seedRows(table.id, [
        { id: `${table.id}-a`, data: { email: 'a@example.test' }, orderKey: 'a0' },
        { id: `${table.id}-b`, data: { email: 'b@example.test' }, orderKey: 'a1' },
      ])

      await expect(
        batchUpdateRows(
          {
            tableId: table.id,
            workspaceId,
            updates: [
              { rowId: `${table.id}-a`, data: { email: 'dup@example.test' } },
              { rowId: `${table.id}-b`, data: { email: 'dup@example.test' } },
            ],
            capabilityGovernedUserId: null,
          },
          table,
          'unique-batch-update'
        )
      ).rejects.toThrow(/must be unique/)
      expect(await storedCount(table.id, { email: 'dup@example.test' })).toBe(0)
    })

    it('rejects a batch update that writes one JSON value to two rows in different key orders', async () => {
      const table = await createTable([{ id: 'meta', name: 'meta', type: 'json', unique: true }])
      await seedRows(table.id, [
        { id: `${table.id}-a`, data: { meta: { n: 1 } }, orderKey: 'a0' },
        { id: `${table.id}-b`, data: { meta: { n: 2 } }, orderKey: 'a1' },
      ])

      await expect(
        batchUpdateRows(
          {
            tableId: table.id,
            workspaceId,
            updates: [
              { rowId: `${table.id}-a`, data: { meta: { x: 1, y: 2 } } },
              { rowId: `${table.id}-b`, data: { meta: { y: 2, x: 1 } } },
            ],
            capabilityGovernedUserId: null,
          },
          table,
          'unique-batch-update'
        )
      ).rejects.toThrow(/must be unique/)
      expect(await storedCount(table.id, { meta: { x: 1, y: 2 } })).toBe(0)
    })

    describe('json columns compare whole values', () => {
      const jsonColumns: ColumnDefinition[] = [
        { id: 'meta', name: 'meta', type: 'json', unique: true },
      ]

      const insertMeta = (table: TableDefinition, meta: JsonValue) =>
        insertRow(
          {
            tableId: table.id,
            workspaceId,
            data: { meta },
            secretProvenance: undefined,
            capabilityGovernedUserId: null,
          },
          table,
          'json-unique'
        )

      async function metaValues(tableId: string): Promise<JsonValue[]> {
        const rows = await control<{ meta: JsonValue }[]>`SELECT data->'meta' AS meta
          FROM user_table_rows WHERE table_id = ${tableId} ORDER BY created_at, id`
        return rows.map((row) => row.meta)
      }

      it('accepts an object or array that a stored value merely contains', async () => {
        const table = await createTable(jsonColumns)
        await seedRows(table.id, [
          { id: `${table.id}-a`, data: { meta: { a: 1, b: 2 } }, orderKey: 'a0' },
          { id: `${table.id}-b`, data: { meta: [1, 2, 3] }, orderKey: 'a1' },
        ])

        await expect(insertMeta(table, { a: 1 })).resolves.toBeDefined()
        await expect(insertMeta(table, [1])).resolves.toBeDefined()
        expect(await storedCount(table.id, { meta: { a: 1 } })).toBe(2)
      })

      it('rejects the same object in a different key order', async () => {
        const table = await createTable(jsonColumns)
        await seedRows(table.id, [
          { id: `${table.id}-a`, data: { meta: { a: 1, b: 2 } }, orderKey: 'a0' },
        ])
        const batch = (rows: RowData[]) => ({
          tableId: table.id,
          workspaceId,
          rows,
          secretProvenance: undefined,
          capabilityGovernedUserId: null,
        })

        await expect(insertMeta(table, { b: 2, a: 1 })).rejects.toThrow(/must be unique/)
        await expect(
          batchInsertRows(batch([{ meta: { b: 2, a: 1 } }]), table, 'json-unique')
        ).rejects.toThrow(/must be unique/)
        await expect(
          replaceTableRows(
            batch([{ meta: { b: 2, a: 1 } }, { meta: { a: 1, b: 2 } }]),
            table,
            'json-unique'
          )
        ).rejects.toThrow(/must be unique/)
        expect(await metaValues(table.id)).toEqual([{ a: 1, b: 2 }])
      })

      it('upserts on a JSON conflict target without overwriting a row that contains it', async () => {
        const table = await createTable(jsonColumns)
        await seedRows(table.id, [
          { id: `${table.id}-a`, data: { meta: { a: 1, b: 2 } }, orderKey: 'a0' },
        ])

        const result = await upsertRow(
          {
            tableId: table.id,
            workspaceId,
            data: { meta: { a: 1 } },
            conflictTarget: 'meta',
            secretProvenance: undefined,
            capabilityGovernedUserId: null,
          },
          table,
          'json-unique'
        )

        expect(result.operation).toBe('insert')
        expect(await metaValues(table.id)).toEqual([{ a: 1, b: 2 }, { a: 1 }])
      })

      it('accepts a batch update of values contained in other rows', async () => {
        const table = await createTable(jsonColumns)
        await seedRows(table.id, [
          { id: `${table.id}-a`, data: { meta: { n: 1 } }, orderKey: 'a0' },
          { id: `${table.id}-b`, data: { meta: { n: 2 } }, orderKey: 'a1' },
          { id: `${table.id}-c`, data: { meta: { a: 1, b: 2, c: 3 } }, orderKey: 'a2' },
        ])

        await batchUpdateRows(
          {
            tableId: table.id,
            workspaceId,
            updates: [
              { rowId: `${table.id}-a`, data: { meta: { a: 1 } } },
              { rowId: `${table.id}-b`, data: { meta: { a: 1, b: 2 } } },
            ],
            capabilityGovernedUserId: null,
          },
          table,
          'json-unique'
        )

        expect(await metaValues(table.id)).toEqual([{ a: 1 }, { a: 1, b: 2 }, { a: 1, b: 2, c: 3 }])
      })

      it('locks JSON values one by one, equating objects whose keys differ only in order', async () => {
        const table = await createTable(jsonColumns)

        const different = await raceUnderHeldDefinitionRow(
          table.id,
          [() => insertMeta(table, { a: 1 }), () => insertMeta(table, { a: 1, b: 2 })],
          { onDefinitionRow: 2, onValueLock: 0 }
        )
        expect(fulfilled(different)).toBe(2)

        const reordered = await raceUnderHeldDefinitionRow(
          table.id,
          [
            () => insertMeta(table, { x: 1, y: [1, 2] }),
            () => insertMeta(table, { y: [1, 2], x: 1 }),
          ],
          { onDefinitionRow: 1, onValueLock: 1 }
        )
        expect(fulfilled(reordered)).toBe(1)
        expect(await storedCount(table.id, { meta: { x: 1 } })).toBe(1)
      })
    })
  })

  describe('writers validate against the live schema, not their snapshot', () => {
    const columns: ColumnDefinition[] = [
      { id: 'key', name: 'key', type: 'string', unique: true },
      { id: 'email', name: 'email', type: 'string' },
      { id: 'note', name: 'note', type: 'string' },
    ]

    /** A table whose `k1`/`k2` rows hold distinct emails and filled notes, and its snapshot. */
    async function seededTable() {
      const table = await createTable(columns)
      await seedRows(table.id, [
        {
          id: `${table.id}-1`,
          data: { key: 'k1', email: 'dup@example.test', note: 'n' },
          orderKey: 'a0',
        },
        {
          id: `${table.id}-2`,
          data: { key: 'k2', email: 'b@example.test', note: 'n' },
          orderKey: 'a1',
        },
      ])
      return table
    }

    type StaleWrite = (table: TableDefinition, row: RowData) => Promise<unknown>

    const rows = (table: TableDefinition, data: RowData[]) => ({
      tableId: table.id,
      workspaceId,
      rows: data,
      secretProvenance: undefined,
      capabilityGovernedUserId: null,
    })

    /**
     * One entry per row writer. Each writes `row`, a new row (`key: 'k3'`) or a patch to row `k2`,
     * holding the snapshot it was handed.
     */
    const writers: Array<[string, StaleWrite]> = [
      [
        'insertRow',
        (table, row) =>
          insertRow(
            {
              tableId: table.id,
              workspaceId,
              data: { key: 'k3', ...row },
              secretProvenance: undefined,
              capabilityGovernedUserId: null,
            },
            table,
            'stale-schema'
          ),
      ],
      [
        'batchInsertRows',
        (table, row) =>
          batchInsertRows(rows(table, [{ key: 'k3', ...row }]), table, 'stale-schema'),
      ],
      [
        'bulkInsertImportBatch',
        (table, row) =>
          bulkInsertImportBatch(
            { tableId: table.id, workspaceId, rows: [{ key: 'k3', ...row }], startPosition: 2 },
            table,
            'stale-schema'
          ),
      ],
      [
        'replaceTableRows',
        (table, row) =>
          replaceTableRows(
            rows(table, [
              { key: 'k1', email: 'dup@example.test', note: 'n' },
              { key: 'k3', ...row },
            ]),
            table,
            'stale-schema'
          ),
      ],
      [
        'upsertRow',
        (table, row) =>
          upsertRow(
            {
              tableId: table.id,
              workspaceId,
              data: { key: 'k3', ...row },
              conflictTarget: 'key',
              secretProvenance: undefined,
              capabilityGovernedUserId: null,
            },
            table,
            'stale-schema'
          ),
      ],
      [
        'updateRow',
        (table, row) =>
          updateRow(
            {
              tableId: table.id,
              rowId: `${table.id}-2`,
              workspaceId,
              data: row,
              secretProvenance: undefined,
              capabilityGovernedUserId: null,
            },
            table,
            'stale-schema'
          ),
      ],
      [
        'batchUpdateRows',
        (table, row) =>
          batchUpdateRows(
            {
              tableId: table.id,
              workspaceId,
              updates: [{ rowId: `${table.id}-2`, data: row }],
              capabilityGovernedUserId: null,
            },
            table,
            'stale-schema'
          ),
      ],
      [
        'updateRowsByFilter',
        (table, row) =>
          updateRowsByFilter(
            table,
            {
              filter: { key: 'k2' },
              data: row,
              secretProvenance: undefined,
              capabilityGovernedUserId: null,
            },
            'stale-schema'
          ),
      ],
      [
        'updateRowsByFilter with a limit',
        (table, row) =>
          updateRowsByFilter(
            table,
            {
              filter: { key: 'k2' },
              data: row,
              limit: 1,
              secretProvenance: undefined,
              capabilityGovernedUserId: null,
            },
            'stale-schema'
          ),
      ],
    ]

    async function countRows(
      tableId: string,
      where: 'email-dup' | 'email-c' | 'note-empty' | 'note-restored'
    ) {
      const [{ count }] = await control<{ count: number }[]>`SELECT count(*)::int AS count
        FROM user_table_rows WHERE table_id = ${tableId} AND ${
          where === 'email-dup'
            ? control`data->>'email' = 'dup@example.test'`
            : where === 'email-c'
              ? control`data->>'email' = 'c@example.test'`
              : where === 'note-empty'
                ? control`data->>'note' IS NULL`
                : control`data->>'note' = 'restored'`
        }`
      return count
    }

    it.each(writers)(
      '%s rejects a duplicate in a column made unique since its snapshot',
      async (_, write) => {
        const table = await seededTable()
        await updateColumnConstraints(
          { tableId: table.id, columnName: 'email', unique: true },
          'stale-schema'
        )

        await expect(write(table, { email: 'dup@example.test', note: 'n' })).rejects.toThrow(
          /must be unique|would violate uniqueness/
        )
        expect(await countRows(table.id, 'email-dup')).toBe(1)
      }
    )

    it.each(writers)(
      '%s rejects an empty cell in a column made required since its snapshot',
      async (_, write) => {
        const table = await seededTable()
        await updateColumnConstraints(
          { tableId: table.id, columnName: 'note', required: true },
          'stale-schema'
        )

        await expect(write(table, { email: 'c@example.test', note: null })).rejects.toThrow(
          /Missing required field/
        )
        expect(await countRows(table.id, 'note-empty')).toBe(0)
      }
    )

    it.each(writers)('%s drops a cell of a column deleted since its snapshot', async (_, write) => {
      const table = await seededTable()
      await deleteColumn({ tableId: table.id, columnName: 'note' }, 'stale-schema')

      await write(table, { email: 'c@example.test', note: 'restored' })
      expect(await countRows(table.id, 'note-restored')).toBe(0)
    })

    it.each([
      [
        'updateRow',
        (table: TableDefinition, rowId: string) =>
          updateRow(
            {
              tableId: table.id,
              rowId,
              workspaceId,
              data: { out: null },
              secretProvenance: undefined,
              capabilityGovernedUserId: null,
            },
            table,
            'stale-schema'
          ),
      ],
      [
        'batchUpdateRows',
        (table: TableDefinition, rowId: string) =>
          batchUpdateRows(
            {
              tableId: table.id,
              workspaceId,
              updates: [{ rowId, data: { out: null } }],
              capabilityGovernedUserId: null,
            },
            table,
            'stale-schema'
          ),
      ],
    ])('%s clears the run of a workflow output added since its snapshot', async (_, write) => {
      const table = await createTable([
        { id: 'name', name: 'name', type: 'string' },
        { id: 'out', name: 'out', type: 'string', workflowGroupId: 'group-1' },
      ])
      await control`UPDATE user_table_definitions SET schema = jsonb_set(schema, '{workflowGroups}',
        ${control.json([
          {
            id: 'group-1',
            workflowId: 'workflow-1',
            outputs: [{ blockId: 'b', path: 'p', columnName: 'out' }],
          },
        ])}) WHERE id = ${table.id}`
      const stale: TableDefinition = {
        ...table,
        schema: { columns: textColumns('name', 'out') },
      }
      const rowId = `${table.id}-a`
      await seedRows(table.id, [{ id: rowId, data: { name: 'a', out: 'done' }, orderKey: 'a0' }])
      await control`INSERT INTO table_row_executions (table_id, row_id, group_id, status, workflow_id)
        VALUES (${table.id}, ${rowId}, 'group-1', 'completed', 'workflow-1')`

      await write(stale, rowId)

      const [{ count }] = await control<{ count: number }[]>`SELECT count(*)::int AS count
        FROM table_row_executions WHERE row_id = ${rowId}`
      expect(count).toBe(0)
    })

    /** A table whose `code` column is text, and a snapshot from when it was a number. */
    async function retypedTable(): Promise<{ table: TableDefinition; stale: TableDefinition }> {
      const table = await createTable([
        { id: 'key', name: 'key', type: 'string', unique: true },
        { id: 'code', name: 'code', type: 'string' },
        { id: 'filler', name: 'filler', type: 'string' },
      ])
      await seedRows(table.id, [
        { id: `${table.id}-2`, data: { key: 'k2', filler: '' }, orderKey: 'a0' },
      ])
      const stale: TableDefinition = {
        ...table,
        schema: {
          columns: table.schema.columns.map((column) =>
            column.id === 'code' ? { ...column, type: 'number' as const } : column
          ),
        },
      }
      return { table, stale }
    }

    /** Writes `row` (a new row, or a patch to row `k2`) through each writer holding `stale`. */
    const retypeWriters: Array<
      [string, (table: TableDefinition, row: RowData) => Promise<unknown>]
    > = [
      [
        'insertRow',
        (table, row) =>
          insertRow(
            {
              tableId: table.id,
              workspaceId,
              data: { key: 'k3', ...row },
              secretProvenance: undefined,
              capabilityGovernedUserId: null,
            },
            table,
            'retype'
          ),
      ],
      [
        'upsertRow',
        (table, row) =>
          upsertRow(
            {
              tableId: table.id,
              workspaceId,
              data: { key: 'k3', ...row },
              conflictTarget: 'key',
              secretProvenance: undefined,
              capabilityGovernedUserId: null,
            },
            table,
            'retype'
          ),
      ],
      [
        'bulkInsertImportBatch',
        (table, row) =>
          bulkInsertImportBatch(
            { tableId: table.id, workspaceId, rows: [{ key: 'k3', ...row }], startPosition: 1 },
            table,
            'retype'
          ),
      ],
      [
        'updateRow',
        (table, row) =>
          updateRow(
            {
              tableId: table.id,
              rowId: `${table.id}-2`,
              workspaceId,
              data: row,
              secretProvenance: undefined,
              capabilityGovernedUserId: null,
            },
            table,
            'retype'
          ),
      ],
      [
        'batchUpdateRows',
        (table, row) =>
          batchUpdateRows(
            {
              tableId: table.id,
              workspaceId,
              updates: [{ rowId: `${table.id}-2`, data: row }],
              capabilityGovernedUserId: null,
            },
            table,
            'retype'
          ),
      ],
    ]

    it.each(retypeWriters)(
      '%s stores the value it was sent in a column retyped since its snapshot',
      async (_, write) => {
        const { table, stale } = await retypedTable()

        await write(stale, { code: '007' })

        const [{ count }] = await control<{ count: number }[]>`SELECT count(*)::int AS count
          FROM user_table_rows WHERE table_id = ${table.id} AND data->'code' = '"007"'`
        expect(count).toBe(1)
      }
    )

    it.each(retypeWriters)(
      '%s refuses a row a retype since its snapshot grows past the size limit',
      async (writer, write) => {
        const { table, stale } = await retypedTable()
        // Exactly at the limit with `code` a number; the live text column stores it with quotes.
        const inserting = writer !== 'updateRow' && writer !== 'batchUpdateRows'
        const shape = (filler: string) =>
          inserting ? { key: 'k3', code: 7, filler } : { key: 'k2', filler, code: 7 }
        const filler = 'x'.repeat(
          getMaxRowSizeBytes() - Buffer.byteLength(JSON.stringify(shape('')))
        )

        await expect(write(stale, { code: 7, filler })).rejects.toThrow(/Row size exceeds limit/)
        const [{ count }] = await control<{ count: number }[]>`SELECT count(*)::int AS count
          FROM user_table_rows WHERE table_id = ${table.id} AND data->>'code' = '7'`
        expect(count).toBe(0)
      }
    )

    it('fires the insert trigger of a batch insert with the column names of the live schema', async () => {
      const table = await seededTable()
      const stale: TableDefinition = {
        ...table,
        schema: {
          columns: table.schema.columns.map((column) =>
            column.id === 'note' ? { ...column, name: 'old_note' } : column
          ),
        },
      }
      tableTriggerMockFns.mockFireTableTrigger.mockClear()

      await batchInsertRows(
        {
          tableId: table.id,
          workspaceId,
          rows: [{ key: 'k3', note: 'n' }],
          secretProvenance: undefined,
          capabilityGovernedUserId: null,
        },
        stale,
        'stale-schema'
      )

      const [trigger] = tableTriggerMockFns.mockFireTableTrigger.mock.calls
      const schema = trigger?.[6] as { columns: ColumnDefinition[] }
      expect(schema.columns.map((column) => column.name)).toContain('note')
    })

    it('does not count a legacy unique column named after an object prototype key as patched', async () => {
      const table = await createTable([
        { name: 'constructor', type: 'string', unique: true },
        { id: 'note', name: 'note', type: 'string' },
      ])
      await seedRows(table.id, [
        { id: `${table.id}-a`, data: { constructor: 'a', note: 'n' }, orderKey: 'a0' },
        { id: `${table.id}-b`, data: { constructor: 'b', note: 'n' }, orderKey: 'a1' },
      ])

      const result = await updateRowsByFilter(
        table,
        {
          filter: { note: 'n' },
          data: { note: 'patched' },
          // The limited path: the paged one skips rows created after its JS-clock cutoff.
          limit: 10,
          secretProvenance: undefined,
          capabilityGovernedUserId: null,
        },
        'prototype-key'
      )

      expect(result.affectedCount).toBe(2)
    })

    it('does not count a required legacy column named after a prototype key as supplied', async () => {
      const table = await createTable([
        { name: 'constructor', type: 'string', required: true },
        { id: 'note', name: 'note', type: 'string' },
      ])
      await seedRows(table.id, [
        { id: `${table.id}-a`, data: { constructor: 'a', note: 'n' }, orderKey: 'a0' },
      ])

      const result = await updateRowsByFilter(
        table,
        {
          filter: { note: 'n' },
          data: { note: 'patched' },
          limit: 10,
          secretProvenance: undefined,
          capabilityGovernedUserId: null,
        },
        'prototype-key'
      )

      expect(result.affectedCount).toBe(1)
    })

    it('replaces rows that leave a unique legacy column named after a prototype key empty', async () => {
      const table = await createTable([
        { name: 'constructor', type: 'string', unique: true },
        { id: 'note', name: 'note', type: 'string' },
      ])

      await replaceTableRows(
        {
          tableId: table.id,
          workspaceId,
          rows: [{ note: 'a' }, { note: 'b' }],
          secretProvenance: undefined,
        },
        table,
        'prototype-key'
      )

      const [{ count }] = await control<{ count: number }[]>`SELECT count(*)::int AS count
        FROM user_table_rows WHERE table_id = ${table.id}`
      expect(count).toBe(2)
    })

    it('refuses an upsert missing its conflict target named after a prototype key', async () => {
      const table = await createTable([
        { name: 'constructor', type: 'string', unique: true },
        { id: 'note', name: 'note', type: 'string' },
      ])

      await expect(
        upsertRow(
          {
            tableId: table.id,
            workspaceId,
            data: { note: 'a' },
            conflictTarget: 'constructor',
            secretProvenance: undefined,
            capabilityGovernedUserId: null,
          },
          table,
          'prototype-key'
        )
      ).rejects.toThrow(/requires a value for the conflict target/)
    })

    it('refuses a bulk update writing one value to rows of a column made unique since its snapshot', async () => {
      const table = await seededTable()
      await updateColumnConstraints(
        { tableId: table.id, columnName: 'email', unique: true },
        'stale-schema'
      )

      await expect(
        updateRowsByFilter(
          table,
          {
            filter: { note: 'n' },
            data: { email: 'same@example.test' },
            secretProvenance: undefined,
            capabilityGovernedUserId: null,
          },
          'stale-schema'
        )
      ).rejects.toThrow(/would violate uniqueness/)
      expect(await countRows(table.id, 'email-dup')).toBe(1)
    })

    it('refuses an upsert on a column no longer unique since its snapshot', async () => {
      const table = await seededTable()
      await updateColumnConstraints(
        { tableId: table.id, columnName: 'key', unique: false },
        'stale-schema'
      )

      await expect(
        upsertRow(
          {
            tableId: table.id,
            workspaceId,
            data: { key: 'k2', email: 'c@example.test', note: 'n' },
            conflictTarget: 'key',
            secretProvenance: undefined,
            capabilityGovernedUserId: null,
          },
          table,
          'stale-schema'
        )
      ).rejects.toThrow(/requires at least one unique column/)
      const [row] = await control<{ email: string }[]>`SELECT data->>'email' AS email
        FROM user_table_rows WHERE id = ${`${table.id}-2`}`
      expect(row.email).toBe('b@example.test')
    })

    /**
     * Holds the table's schema lock exclusively in a transaction that marks `email` unique, starts
     * `write`, and commits only once `write` is seen waiting on the lock, then settles as `write` does.
     */
    async function writeDuringUniqueChange(
      table: TableDefinition,
      write: () => Promise<unknown>
    ): Promise<unknown> {
      const schemaLockKey = `user_table_schema:${table.id}`
      const holder = await control.reserve()
      try {
        await holder`BEGIN`
        await holder`SELECT pg_advisory_xact_lock(hashtextextended(${schemaLockKey}, 0))`
        await holder`UPDATE user_table_definitions
          SET schema = jsonb_set(schema, '{columns,1,unique}', 'true')
          WHERE id = ${table.id}`
        const pending = write()
        const settled = pending.then(
          () => 'fulfilled',
          () => 'rejected'
        )

        await untilSchemaLockWaiters(table.id, 1)
        expect(await Promise.race([settled, sleep(50).then(() => 'pending')])).toBe('pending')

        await holder`COMMIT`
        return await pending
      } finally {
        await holder`ROLLBACK`.catch(() => {})
        holder.release()
      }
    }

    /**
     * Holds the table's schema lock exclusively, starts `write`, and commits once `write` is seen
     * waiting on it and `holdMs` more has passed. Settles as `write` does.
     */
    async function writeBehindSchemaLock(
      table: TableDefinition,
      holdMs: number,
      write: () => Promise<unknown>
    ): Promise<unknown> {
      const holder = await control.reserve()
      try {
        await holder`BEGIN`
        await holder`SELECT pg_advisory_xact_lock(hashtextextended(${`user_table_schema:${table.id}`}, 0))`
        const pending = write()
        pending.catch(() => {})
        await untilSchemaLockWaiters(table.id, 1)
        await sleep(holdMs)
        await holder`COMMIT`
        return await pending
      } finally {
        await holder`ROLLBACK`.catch(() => {})
        holder.release()
      }
    }

    it.each([
      [
        'insertRow, which sets a 3 s lock timeout',
        (table: TableDefinition) =>
          insertRow(
            {
              tableId: table.id,
              workspaceId,
              data: { key: 'k3', email: 'c@example.test' },
              secretProvenance: undefined,
              capabilityGovernedUserId: null,
            },
            table,
            'long-schema-change'
          ),
      ],
      [
        'updateRow, which sets none',
        (table: TableDefinition) =>
          updateRow(
            {
              tableId: table.id,
              rowId: `${table.id}-2`,
              workspaceId,
              data: { email: 'c@example.test' },
              secretProvenance: undefined,
              capabilityGovernedUserId: null,
            },
            table,
            'long-schema-change'
          ),
      ],
    ])(
      '%s waits out a schema change held past the lock timeout',
      async (_, write) => {
        const table = await seededTable()

        await expect(writeBehindSchemaLock(table, 3_500, () => write(table))).resolves.toBeDefined()
        expect(await countRows(table.id, 'email-c')).toBe(1)
      },
      15_000
    )

    it('bounds the schema-lock wait by the statement timeout', async () => {
      const table = await seededTable()

      await expect(
        writeBehindSchemaLock(table, 1_500, () =>
          db.transaction((trx) => lockLiveTableSchema(trx, table, { statementMs: 300 }))
        )
      ).rejects.toMatchObject({ cause: { code: '55P03' } })
    })

    it('leaves the lock timeout the transaction set for the locks after the guard', async () => {
      const table = await seededTable()

      const lockTimeout = await db.transaction(async (trx) => {
        await lockLiveTableSchema(trx, table, {})
        const [{ setting }] = await trx.execute<{ setting: string }>(
          sql`SELECT current_setting('lock_timeout') AS setting`
        )
        return setting
      })
      expect(lockTimeout).toBe('3s')
    })

    it('waits for a schema change in flight and then writes against it', async () => {
      const table = await seededTable()

      await expect(
        writeDuringUniqueChange(table, () =>
          insertRow(
            {
              tableId: table.id,
              workspaceId,
              data: { key: 'k3', email: 'dup@example.test' },
              secretProvenance: undefined,
              capabilityGovernedUserId: null,
            },
            table,
            'stale-schema'
          )
        )
      ).rejects.toThrow(/must be unique/)
      expect(await countRows(table.id, 'email-dup')).toBe(1)
    })
  })

  describe.skipIf(!migrated || !logsRowChanges)('a held definition row', () => {
    it('lets every row write path commit while another session holds the definition row', async () => {
      const table = await createTable([
        { id: 'key', name: 'key', type: 'string', unique: true },
        { id: 'name', name: 'name', type: 'string' },
      ])
      const versionBefore = await rowsVersion(table.id)
      const rowIdByKey = async (key: string) => {
        const [row] = await control<{ id: string }[]>`SELECT id FROM user_table_rows
          WHERE table_id = ${table.id} AND data->>'key' = ${key}`
        return row.id
      }
      const writes: Array<[string, () => Promise<unknown>]> = [
        [
          'insert',
          () =>
            insertRow(
              {
                tableId: table.id,
                workspaceId,
                data: { key: 'a', name: 'a' },
                secretProvenance: undefined,
                capabilityGovernedUserId: null,
              },
              table,
              'held-insert'
            ),
        ],
        [
          'batch insert',
          () =>
            batchInsertRows(
              {
                tableId: table.id,
                workspaceId,
                rows: [
                  { key: 'b', name: 'b' },
                  { key: 'c', name: 'c' },
                ],
                secretProvenance: undefined,
                capabilityGovernedUserId: null,
              },
              table,
              'held-batch-insert'
            ),
        ],
        [
          'upsert',
          () =>
            upsertRow(
              {
                tableId: table.id,
                workspaceId,
                data: { key: 'd', name: 'd' },
                conflictTarget: 'key',
                secretProvenance: undefined,
                capabilityGovernedUserId: null,
              },
              table,
              'held-upsert'
            ),
        ],
        [
          'upsert of an existing key',
          () =>
            upsertRow(
              {
                tableId: table.id,
                workspaceId,
                data: { key: 'd', name: 'd2' },
                conflictTarget: 'key',
                secretProvenance: undefined,
                capabilityGovernedUserId: null,
              },
              table,
              'held-upsert-existing'
            ),
        ],
        [
          'update by id',
          async () =>
            updateRow(
              {
                tableId: table.id,
                rowId: await rowIdByKey('a'),
                workspaceId,
                data: { name: 'a2' },
                secretProvenance: undefined,
                capabilityGovernedUserId: null,
              },
              table,
              'held-update'
            ),
        ],
        [
          'update by filter',
          () =>
            updateRowsByFilter(
              table,
              {
                filter: { name: 'b' },
                data: { name: 'b2' },
                limit: 10,
                secretProvenance: undefined,
                capabilityGovernedUserId: null,
              },
              'held-update-by-filter'
            ),
        ],
        [
          'delete by filter',
          () => deleteRowsByFilter(table, { filter: { name: 'c' } }, 'held-delete-by-filter'),
        ],
        [
          'replace',
          () =>
            replaceTableRows(
              {
                tableId: table.id,
                workspaceId,
                rows: [{ key: 'x', name: 'x' }],
                secretProvenance: undefined,
              },
              table,
              'held-replace'
            ),
        ],
      ]

      const holder = await control.reserve()
      const elapsedMs: Record<string, number> = {}
      try {
        await holder`BEGIN`
        await holder`SELECT 1 FROM user_table_definitions WHERE id = ${table.id} FOR NO KEY UPDATE`
        for (const [name, write] of writes) {
          const started = Date.now()
          await write()
          elapsedMs[name] = Date.now() - started
        }
      } finally {
        await holder`ROLLBACK`.catch(() => {})
        holder.release()
      }

      for (const [name] of writes) expect(elapsedMs[name], name).toBeLessThan(2_000)
      const [{ count }] = await control<{ count: number }[]>`SELECT count(*)::int AS count
        FROM user_table_rows WHERE table_id = ${table.id}`
      expect(count).toBe(1)
      expect((await getTableById(table.id))?.rowCount).toBe(count)
      // One log entry per write, except replace, which logs its DELETE and its INSERT.
      expect(await rowsVersion(table.id)).toBe(versionBefore + writes.length + 1)
    })
  })

  describe('inserts without a table-wide lock', () => {
    const insertName = (table: TableDefinition, name: string, placement = {}) =>
      insertRow(
        {
          tableId: table.id,
          workspaceId,
          data: { name },
          secretProvenance: undefined,
          capabilityGovernedUserId: null,
          ...placement,
        },
        table,
        'lockless-insert'
      )
    const batchInsertNames = (table: TableDefinition, names: string[]) =>
      batchInsertRows(
        {
          tableId: table.id,
          workspaceId,
          rows: names.map((name) => ({ name })),
          secretProvenance: undefined,
          capabilityGovernedUserId: null,
        },
        table,
        'lockless-batch'
      )
    // Byte order, as migration 0228 sets on the column: `db:push` leaves the default collation.
    const orderedNames = async (tableId: string) =>
      (
        await control<{ name: string }[]>`
          SELECT data->>'name' AS name FROM user_table_rows
          WHERE table_id = ${tableId} ORDER BY order_key COLLATE "C", id`
      ).map((row) => row.name)

    it('lets every insert path commit while another transaction holds the retired row-order lock', async () => {
      const table = await createTable([
        { id: 'name', name: 'name', type: 'string' },
        { id: 'key', name: 'key', type: 'string', unique: true },
      ])
      await seedRows(table.id, [{ id: `${table.id}-a`, data: { name: 'a' }, orderKey: 'a0' }])
      const writes: Array<[string, () => Promise<unknown>]> = [
        ['append', () => insertName(table, 'b')],
        ['at a position', () => insertName(table, 'c', { position: 0 })],
        ['after a row', () => insertName(table, 'd', { afterRowId: `${table.id}-a` })],
        ['batch', () => batchInsertNames(table, ['e', 'f'])],
        [
          'upsert',
          () =>
            upsertRow(
              {
                tableId: table.id,
                workspaceId,
                data: { name: 'g', key: 'g' },
                conflictTarget: 'key',
                secretProvenance: undefined,
                capabilityGovernedUserId: null,
              },
              table,
              'lockless-upsert'
            ),
        ],
        [
          'import with a new column',
          () =>
            importAppendRows(
              table,
              [{ name: 'extra', type: 'string' }],
              [{ name: 'h', extra: 'x' }],
              { workspaceId, requestId: 'lockless-import', capabilityGovernedUserId: null }
            ),
        ],
      ]

      const holder = await control.reserve()
      const elapsedMs: Record<string, number> = {}
      try {
        await holder`BEGIN`
        await holder`SELECT pg_advisory_xact_lock(hashtextextended(${`user_table_rows_pos:${table.id}`}, 0))`
        for (const [name, write] of writes) {
          const started = Date.now()
          await write()
          elapsedMs[name] = Date.now() - started
        }
      } finally {
        await holder`ROLLBACK`.catch(() => {})
        holder.release()
      }

      for (const [name] of writes) expect(elapsedMs[name], name).toBeLessThan(2_000)
      expect((await orderedNames(table.id)).length).toBe(8)
    })

    it('gives appends that read the same last key distinct keys, keeping each batch together', async () => {
      const table = await createTable(textColumns('name'))
      await seedRows(table.id, [{ id: `${table.id}-a`, data: { name: 'seed' }, orderKey: 'a0' }])
      const batches = Array.from({ length: 4 }, (_, b) =>
        Array.from({ length: 5 }, (_, i) => `batch${b}-${i}`)
      )
      const singles = Array.from({ length: 4 }, (_, i) => `single${i}`)

      // Every writer reads the table's last key before its row write waits on the held definition
      // row, so all of them mint from the same `a0`.
      const results = await raceUnderHeldDefinitionRow(
        table.id,
        [
          ...batches.map((names) => () => batchInsertNames(table, names)),
          ...singles.map((name) => () => insertName(table, name)),
        ],
        { onDefinitionRow: batches.length + singles.length, onValueLock: 0 }
      )

      expect(results.filter((result) => result.status === 'rejected')).toEqual([])
      const [{ keys, distinct }] = await control<{ keys: number; distinct: number }[]>`
        SELECT count(*)::int AS keys, count(DISTINCT order_key)::int AS distinct
        FROM user_table_rows WHERE table_id = ${table.id}`
      expect(distinct).toBe(keys)
      const names = await orderedNames(table.id)
      expect(names[0]).toBe('seed')
      for (const batch of batches) {
        const at = names.indexOf(batch[0])
        expect(names.slice(at, at + batch.length)).toEqual(batch)
      }
    })

    it('inserts at a position between two rows that share a key', async () => {
      const table = await createTable(textColumns('name'))
      await seedRows(table.id, [
        { id: `${table.id}-0`, data: { name: 'a' }, orderKey: 'a0' },
        { id: `${table.id}-1`, data: { name: 'b' }, orderKey: 'a1' },
        { id: `${table.id}-2`, data: { name: 'c' }, orderKey: 'a1' },
        { id: `${table.id}-3`, data: { name: 'd' }, orderKey: 'a2' },
      ])

      await insertName(table, 'new', { position: 2 })

      const names = await orderedNames(table.id)
      expect(names.indexOf('new')).toBe(3)
      expect(names.at(-1)).toBe('d')
    })

    it('appends a row whose requested position is past the last row', async () => {
      const table = await createTable(textColumns('name'))
      await seedRows(table.id, [
        { id: `${table.id}-0`, data: { name: 'a' }, orderKey: 'a0' },
        { id: `${table.id}-1`, data: { name: 'b' }, orderKey: 'a1' },
      ])

      await insertName(table, 'new', { position: 10 })

      expect(await orderedNames(table.id)).toEqual(['a', 'b', 'new'])
    })

    it('leaves only the later row set when two replaces run concurrently', async () => {
      const table = await createTable(textColumns('name'))
      await seedRows(table.id, [{ id: `${table.id}-old`, data: { name: 'old' }, orderKey: 'a0' }])
      const replaceWith = (names: string[]) =>
        replaceTableRows(
          {
            tableId: table.id,
            workspaceId,
            rows: names.map((name) => ({ name })),
            secretProvenance: undefined,
          },
          table,
          'concurrent-replace'
        )

      const results = await Promise.allSettled([
        replaceWith(['x1', 'x2']),
        replaceWith(['y1', 'y2']),
      ])

      expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled'])
      expect([
        ['x1', 'x2'],
        ['y1', 'y2'],
      ]).toContainEqual(await orderedNames(table.id))
    })
  })

  describe.skipIf(!migrated)('rows_version', () => {
    it('advances once for a transaction that edits cells across several statements', async () => {
      const table = await createTable(textColumns('name'))
      await seedRows(table.id, [
        { id: `${table.id}-a`, data: { name: 'a' }, orderKey: 'a0' },
        { id: `${table.id}-b`, data: { name: 'b' }, orderKey: 'a1' },
      ])
      const before = await rowsVersion(table.id)

      await control.begin(async (tx) => {
        await tx`UPDATE user_table_rows SET data = '{"name":"a2"}' WHERE id = ${`${table.id}-a`}`
        await tx`UPDATE user_table_rows SET data = '{"name":"b2"}' WHERE id = ${`${table.id}-b`}`
        await tx`UPDATE user_table_rows SET data = '{"name":"a3"}' WHERE id = ${`${table.id}-a`}`
      })

      expect(await rowsVersion(table.id)).toBe(before + 1)
    })

    it('advances each table once for a transaction that edits rows in two tables', async () => {
      const first = await createTable(textColumns('name'))
      const second = await createTable(textColumns('name'))
      for (const table of [first, second]) {
        await seedRows(table.id, [
          { id: `${table.id}-a`, data: { name: 'a' }, orderKey: 'a0' },
          { id: `${table.id}-b`, data: { name: 'b' }, orderKey: 'a1' },
        ])
      }
      const [firstBefore, secondBefore] = [
        await rowsVersion(first.id),
        await rowsVersion(second.id),
      ]

      await control.begin(async (tx) => {
        await tx`UPDATE user_table_rows SET data = '{"name":"a2"}' WHERE id = ${`${first.id}-a`}`
        await tx`UPDATE user_table_rows SET data = '{"name":"a2"}' WHERE id = ${`${second.id}-a`}`
        await tx`UPDATE user_table_rows SET data = '{"name":"b2"}' WHERE id = ${`${first.id}-b`}`
        await tx`UPDATE user_table_rows SET order_key = 'a2' WHERE id = ${`${second.id}-b`}`
      })

      expect(await rowsVersion(first.id)).toBe(firstBefore + 1)
      expect(await rowsVersion(second.id)).toBe(secondBefore + 1)
    })

    it('advances once for a transaction that reorders rows across several statements', async () => {
      const table = await createTable(textColumns('name'))
      await seedRows(table.id, [
        { id: `${table.id}-a`, data: { name: 'a' }, orderKey: 'a0' },
        { id: `${table.id}-b`, data: { name: 'b' }, orderKey: 'a1' },
      ])
      const before = await rowsVersion(table.id)

      await control.begin(async (tx) => {
        await tx`UPDATE user_table_rows SET order_key = 'a2' WHERE id = ${`${table.id}-a`}`
        await tx`UPDATE user_table_rows SET order_key = 'Zz' WHERE id = ${`${table.id}-b`}`
      })

      expect(await rowsVersion(table.id)).toBe(before + 1)
    })

    it('advances once for a service cell edit that also writes executions and provenance', async () => {
      const table = await createTable(textColumns('name'))
      await seedRows(table.id, [{ id: `${table.id}-a`, data: { name: 'a' }, orderKey: 'a0' }])
      const before = await rowsVersion(table.id)

      await updateRow(
        {
          tableId: table.id,
          rowId: `${table.id}-a`,
          workspaceId,
          data: { name: 'edited' },
          secretProvenance: { complete: true, columns: {} },
          capabilityGovernedUserId: null,
          executionsPatch: {
            'group-1': {
              status: 'completed',
              executionId: generateId(),
              jobId: null,
              workflowId: 'workflow-1',
              error: null,
            },
          },
        },
        table,
        'rows-version-service-edit'
      )

      expect(await rowsVersion(table.id)).toBe(before + 1)
    })

    it('stays put for provenance-only, timestamp-only, and executions-only writes', async () => {
      const table = await createTable(textColumns('name'))
      await seedRows(table.id, [{ id: `${table.id}-a`, data: { name: 'a' }, orderKey: 'a0' }])
      const before = await rowsVersion(table.id)

      await control`UPDATE user_table_rows SET secret_provenance_version = 1 WHERE id = ${`${table.id}-a`}`
      await control`UPDATE user_table_rows SET updated_at = now() WHERE id = ${`${table.id}-a`}`
      await control`UPDATE user_table_rows SET data = data WHERE id = ${`${table.id}-a`}`
      await updateRow(
        {
          tableId: table.id,
          rowId: `${table.id}-a`,
          workspaceId,
          data: {},
          secretProvenance: undefined,
          capabilityGovernedUserId: null,
          executionsPatch: {
            'group-1': {
              status: 'running',
              executionId: generateId(),
              jobId: null,
              workflowId: 'workflow-1',
              error: null,
            },
          },
        },
        table,
        'rows-version-executions-only'
      )

      expect(await rowsVersion(table.id)).toBe(before)
    })

    it('lets a second writer commit while the first holds an uncommitted row edit', async () => {
      const table = await createTable(textColumns('name'))
      await seedRows(table.id, [
        { id: `${table.id}-a`, data: { name: 'a' }, orderKey: 'a0' },
        { id: `${table.id}-b`, data: { name: 'b' }, orderKey: 'a1' },
      ])
      const before = await rowsVersion(table.id)
      const first = await control.reserve()
      const second = await control.reserve()
      try {
        await first`BEGIN`
        await first`UPDATE user_table_rows SET data = '{"name":"a2"}' WHERE id = ${`${table.id}-a`}`

        await second`BEGIN`
        await second`SET LOCAL lock_timeout = '1s'`
        await second`UPDATE user_table_rows SET data = '{"name":"b2"}' WHERE id = ${`${table.id}-b`}`
        await second`COMMIT`
        expect(await rowsVersion(table.id)).toBe(before + 1)

        await first`COMMIT`
        expect(await rowsVersion(table.id)).toBe(before + 2)
      } finally {
        await first`ROLLBACK`.catch(() => {})
        await second`ROLLBACK`.catch(() => {})
        first.release()
        second.release()
      }
    })

    it('re-keys a snapshot when a writer commits during materialization', async () => {
      const table = await createTable(textColumns('name'))
      await seedRows(table.id, [{ id: `${table.id}-a`, data: { name: 'a' }, orderKey: 'a0' }])
      const before = await rowsVersion(table.id)

      const stored = new Map<string, string>()
      let concurrentWriteDone = false
      storageServiceMockFns.mockHeadObject.mockImplementation(async (key: string) =>
        stored.has(key) ? { size: Buffer.byteLength(stored.get(key) ?? '') } : null
      )
      storageServiceMockFns.mockDeleteFile.mockImplementation(async ({ key }: { key: string }) => {
        stored.delete(key)
      })
      storageServiceMockFns.mockCreateMultipartUpload.mockImplementation(
        async ({ key }: { key: string }) => {
          let body = ''
          return {
            write: async (chunk: string) => {
              if (!concurrentWriteDone) {
                concurrentWriteDone = true
                await control`UPDATE user_table_rows SET data = '{"name":"during"}' WHERE id = ${`${table.id}-a`}`
              }
              body += chunk
            },
            complete: async () => {
              stored.set(key, body)
              return { size: Buffer.byteLength(body) }
            },
            abort: async () => {},
          }
        }
      )

      const snapshot = await getOrCreateTableSnapshot(table, 'rows-version-snapshot')

      expect(snapshot.version).toBe(before + 1)
      expect(snapshot.key).toContain(`/v${before + 1}-`)
      expect(stored.get(snapshot.key)).toContain('during')
    })
  })
})
