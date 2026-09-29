/**
 * Row-write integration tests against the provisioned, disposable TEST_DATABASE_URL database (the
 * integration setup points DATABASE_URL at it too). The unique-value locks and the row-order lock
 * run for real everywhere; the `rows_version` cases also need the migrated deferred trigger and
 * skip without it.
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

import {
  deleteColumn,
  updateColumnConstraints,
  updateColumnOptions,
} from '@/lib/table/columns/service'
import { getMaxRowSizeBytes, TABLE_LIMITS } from '@/lib/table/constants'
import { bulkInsertImportBatch, importReplaceRows } from '@/lib/table/import-data'
import { markTableJobRunningInWorkspace } from '@/lib/table/jobs/service'
import type { DbTransaction } from '@/lib/table/planner'
import { lockLiveTableSchema } from '@/lib/table/rows/live-schema'
import { acquireRowOrderLock } from '@/lib/table/rows/ordering'
import {
  batchInsertRows,
  batchUpdateRows,
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
import { runTableUpdate, UpdatePatchRejectedError } from '@/lib/table/update-runner'

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
  const [row] = await control`SELECT rows_version FROM user_table_definitions WHERE id = ${tableId}`
  return Number(row.rows_version)
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

    type LockWaiters = { onOrderLock: number; onValueLock: number }

    /**
     * Polls until exactly `expected.onOrderLock` sessions wait on the table's row-order lock and
     * `expected.onValueLock` wait on one of its unique locks, and returns the last count seen. Both
     * counts are scoped to the table, so concurrent suites cannot skew them: a unique-lock waiter
     * waits on the table's unique lock itself, or on a value lock while holding the table's unique
     * lock shared.
     */
    async function waitForLockWaiters(tableId: string, expected: LockWaiters) {
      const orderLockKey = `user_table_rows_pos:${tableId}`
      const uniqueLockKey = `user_table_unique:${tableId}`
      let waiting: LockWaiters = { onOrderLock: 0, onValueLock: 0 }
      for (let attempt = 0; attempt < 400; attempt++) {
        await sleep(5)
        ;[waiting] = await control<LockWaiters[]>`
          WITH lock AS (
            SELECT hashtextextended(${orderLockKey}, 0) AS order_key,
              hashtextextended(${uniqueLockKey}, 0) AS unique_key
          ), advisory AS (
            SELECT l.pid, l.granted,
              l.classid = ((lock.order_key >> 32) & 4294967295)::oid
                AND l.objid = (lock.order_key & 4294967295)::oid AS is_order,
              l.classid = ((lock.unique_key >> 32) & 4294967295)::oid
                AND l.objid = (lock.unique_key & 4294967295)::oid AS is_unique
            FROM pg_locks l CROSS JOIN lock
            WHERE l.locktype = 'advisory'
              AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database())
          )
          SELECT
            count(*) FILTER (WHERE NOT granted AND is_order)::int AS "onOrderLock",
            count(*) FILTER (
              WHERE NOT granted AND NOT is_order AND (
                is_unique OR pid IN (SELECT pid FROM advisory WHERE granted AND is_unique)
              )
            )::int AS "onValueLock"
          FROM advisory`
        if (
          waiting.onOrderLock === expected.onOrderLock &&
          waiting.onValueLock === expected.onValueLock
        ) {
          break
        }
      }
      return waiting
    }

    /**
     * Holds the table's row-order lock while `writes` start, and releases it only once exactly
     * `onOrderLock` of them wait on it and `onValueLock` wait on a unique-value lock. Inserts take
     * their value locks and run their unique check before the row-order lock, so this pins every
     * write mid-flight; releasing any earlier could let them run one after another and prove
     * nothing about the race.
     */
    async function raceUnderHeldOrderLock(
      tableId: string,
      writes: Array<() => Promise<unknown>>,
      expected: LockWaiters
    ): Promise<PromiseSettledResult<unknown>[]> {
      const holder = await control.reserve()
      try {
        await holder`BEGIN`
        await holder`SELECT pg_advisory_xact_lock(hashtextextended(${`user_table_rows_pos:${tableId}`}, 0))`
        const racers = Promise.allSettled(writes.map((write) => write()))
        expect(await waitForLockWaiters(tableId, expected)).toEqual(expected)
        await holder`COMMIT`
        return await racers
      } finally {
        await holder`ROLLBACK`.catch(() => {})
        holder.release()
      }
    }

    async function storedCount(tableId: string, match: Record<string, JsonValue>) {
      const [{ count }] = await control<{ count: number }[]>`SELECT count(*)::int AS count
        FROM user_table_rows WHERE table_id = ${tableId} AND data @> ${control.json(match)}`
      return count
    }

    const fulfilled = (results: PromiseSettledResult<unknown>[]) =>
      results.filter((result) => result.status === 'fulfilled').length

    it('rejects the second of two concurrent single-row inserts of the same value', async () => {
      const table = await createTable(uniqueColumns)

      const results = await raceUnderHeldOrderLock(
        table.id,
        [
          () => insertEmail(table, 'dup@example.test'),
          () => insertEmail(table, 'dup@example.test'),
        ],
        { onOrderLock: 1, onValueLock: 1 }
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

      const results = await raceUnderHeldOrderLock(table.id, [insertScore('8'), insertScore(8)], {
        onOrderLock: 1,
        onValueLock: 1,
      })

      expect(fulfilled(results)).toBe(1)
      expect(await storedCount(table.id, { score: 8 })).toBe(1)
    })

    it('lets concurrent inserts of different values proceed together', async () => {
      const table = await createTable(uniqueColumns)

      const results = await raceUnderHeldOrderLock(
        table.id,
        [() => insertEmail(table, 'a@example.test'), () => insertEmail(table, 'b@example.test')],
        { onOrderLock: 2, onValueLock: 0 }
      )

      expect(fulfilled(results)).toBe(2)
    })

    it('rejects a single insert racing a batch insert that holds the same value', async () => {
      const table = await createTable(uniqueColumns)

      const results = await raceUnderHeldOrderLock(
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
        { onOrderLock: 1, onValueLock: 1 }
      )

      expect(fulfilled(results)).toBe(1)
      expect(await storedCount(table.id, { email: 'dup@example.test' })).toBe(1)
    })

    it('rejects an edit to a value a concurrent insert is writing', async () => {
      const table = await createTable(uniqueColumns)
      await seedRows(table.id, [
        { id: `${table.id}-a`, data: { email: 'a@example.test' }, orderKey: 'a0' },
      ])

      const results = await raceUnderHeldOrderLock(
        table.id,
        [
          () => insertEmail(table, 'dup@example.test'),
          async () => {
            // Start the edit only once the insert has passed its check and holds its locks.
            expect(await waitForLockWaiters(table.id, { onOrderLock: 1, onValueLock: 0 })).toEqual({
              onOrderLock: 1,
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
        { onOrderLock: 1, onValueLock: 1 }
      )

      expect(fulfilled(results)).toBe(1)
      expect(await storedCount(table.id, { email: 'dup@example.test' })).toBe(1)
    })

    it('lets a replace that adds the first unique column wait out a writer on an older schema', async () => {
      const table = await createTable([{ id: 'name', name: 'name', type: 'string' }])
      // The writer resolved the table while it still had a unique column, so it holds the unique
      // lock shared and will want the row-order lock next.
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
        await acquireRowOrderLock(trx, table.id)
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
        expect(await waitForLockWaiters(table.id, { onOrderLock: 0, onValueLock: 1 })).toEqual({
          onOrderLock: 0,
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

      const results = await raceUnderHeldOrderLock(
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
        { onOrderLock: 1, onValueLock: 1 }
      )

      expect(fulfilled(results)).toBe(1)
      expect(await storedCount(table.id, { email: 'dup@example.test' })).toBe(1)
    })

    it('rejects an import batch racing a single insert of the same value', async () => {
      const table = await createTable(uniqueColumns)

      const results = await raceUnderHeldOrderLock(
        table.id,
        [
          () => insertEmail(table, 'dup@example.test'),
          async () => {
            // Start the import only once the insert has passed its check and holds its locks.
            expect(await waitForLockWaiters(table.id, { onOrderLock: 1, onValueLock: 0 })).toEqual({
              onOrderLock: 1,
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
        { onOrderLock: 1, onValueLock: 1 }
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

        const different = await raceUnderHeldOrderLock(
          table.id,
          [() => insertMeta(table, { a: 1 }), () => insertMeta(table, { a: 1, b: 2 })],
          { onOrderLock: 2, onValueLock: 0 }
        )
        expect(fulfilled(different)).toBe(2)

        const reordered = await raceUnderHeldOrderLock(
          table.id,
          [
            () => insertMeta(table, { x: 1, y: [1, 2] }),
            () => insertMeta(table, { y: [1, 2], x: 1 }),
          ],
          { onOrderLock: 1, onValueLock: 1 }
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

  describe('background updates validate their patch against the live schema', () => {
    const columns: ColumnDefinition[] = [
      { id: 'email', name: 'email', type: 'string' },
      { id: 'kind', name: 'kind', type: 'string' },
      {
        id: 'status',
        name: 'status',
        type: 'select',
        options: [{ id: 'opt_open', name: 'Open' }],
      },
      { id: 'note', name: 'note', type: 'string' },
      { id: 'due', name: 'due', type: 'date' },
    ]
    /** Two update batches' worth of rows. */
    const ROWS = TABLE_LIMITS.UPDATE_BATCH_SIZE + 50

    async function seededJob(data: RowData) {
      const table = await createTable(columns)
      await control`INSERT INTO user_table_rows (id, table_id, workspace_id, data, position, order_key)
        SELECT ${table.id} || '-' || lpad(g::text, 4, '0'), ${table.id}, ${workspaceId},
          jsonb_build_object('email', 'e' || g || '@example.test', 'kind', 'seed'), g, 'a' || lpad(g::text, 4, '0')
        FROM generate_series(1, ${ROWS}) g`
      const jobId = generateId()
      const filter = { kind: 'seed' }
      expect(
        await markTableJobRunningInWorkspace(table.id, workspaceId, jobId, 'update', {
          filter,
          data,
        })
      ).toBe(true)
      const run = () =>
        runTableUpdate({
          jobId,
          tableId: table.id,
          workspaceId,
          filter,
          data: { ...data },
          cutoff: new Date(),
        })
      /** Re-runs the job as a retry after a crash would: the job is still running. */
      const retry = async () => {
        await control`UPDATE table_jobs SET status = 'running', completed_at = NULL
          WHERE id = ${jobId}`
        return run()
      }
      return { table, run, retry }
    }

    /**
     * Commits `change` between the job's first and second batch. A held schema lock stops the
     * first batch; `change` then queues behind it, and a waiting lock is granted in queue order, so
     * the first batch commits, then `change`, then the second batch.
     */
    async function changeBetweenBatches(
      tableId: string,
      run: () => Promise<void>,
      change: () => Promise<unknown>
    ): Promise<PromiseSettledResult<unknown>[]> {
      const holder = await control.reserve()
      try {
        await holder`BEGIN`
        await holder`SELECT pg_advisory_xact_lock(hashtextextended(${`user_table_schema:${tableId}`}, 0))`
        const job = run()
        await untilSchemaLockWaiters(tableId, 1)
        const changed = change()
        await untilSchemaLockWaiters(tableId, 2)
        await holder`COMMIT`
        return await Promise.allSettled([job, changed])
      } finally {
        await holder`ROLLBACK`.catch(() => {})
        holder.release()
      }
    }

    /** Commits `schema = <change>` for the table under its exclusive schema lock. */
    async function changeSchemaUnderLock(tableId: string, change: string): Promise<void> {
      const changer = await control.reserve()
      try {
        await changer`BEGIN`
        await changer`SELECT pg_advisory_xact_lock(hashtextextended(${`user_table_schema:${tableId}`}, 0))`
        await changer.unsafe(`UPDATE user_table_definitions SET schema = ${change} WHERE id = $1`, [
          tableId,
        ])
        await changer`COMMIT`
      } finally {
        changer.release()
      }
    }

    async function countEmail(tableId: string, email: string): Promise<number> {
      const [{ count }] = await control<{ count: number }[]>`SELECT count(*)::int AS count
        FROM user_table_rows WHERE table_id = ${tableId} AND data->>'email' = ${email}`
      return count
    }

    it('refuses a patch to a column made unique before the job started, retry included', async () => {
      const { table, run } = await seededJob({ email: 'same@example.test' })
      await updateColumnConstraints(
        { tableId: table.id, columnName: 'email', unique: true },
        'bulk-update'
      )

      await expect(run()).rejects.toBeInstanceOf(UpdatePatchRejectedError)
      await expect(run()).rejects.toBeInstanceOf(UpdatePatchRejectedError)
      expect(await countEmail(table.id, 'same@example.test')).toBe(0)
    })

    it('refuses the next batch once a column it clears is made required mid-job', async () => {
      const { table, run } = await seededJob({ note: null })
      await control`UPDATE user_table_rows SET data = data || '{"note":"filled"}' WHERE table_id = ${table.id}`

      const [job, change] = await changeBetweenBatches(table.id, run, async () => {
        const changer = await control.reserve()
        try {
          await changer`BEGIN`
          await changer`SELECT pg_advisory_xact_lock(hashtextextended(${`user_table_schema:${table.id}`}, 0))`
          await changer`UPDATE user_table_definitions
            SET schema = jsonb_set(schema, '{columns,3,required}', 'true') WHERE id = ${table.id}`
          await changer`COMMIT`
        } finally {
          changer.release()
        }
      })

      expect(change.status).toBe('fulfilled')
      expect(job.status === 'rejected' && job.reason).toBeInstanceOf(UpdatePatchRejectedError)
      const [{ count }] = await control<{ count: number }[]>`SELECT count(*)::int AS count
        FROM user_table_rows WHERE table_id = ${table.id} AND data->'note' = 'null'::jsonb`
      expect(count).toBe(TABLE_LIMITS.UPDATE_BATCH_SIZE)
    })

    it('refuses the next batch once a patched column is made unique mid-job, retry included', async () => {
      const { table, run } = await seededJob({ email: 'same@example.test' })

      const [job, change] = await changeBetweenBatches(table.id, run, () =>
        changeSchemaUnderLock(table.id, `jsonb_set(schema, '{columns,0,unique}', 'true')`)
      )

      expect(change.status).toBe('fulfilled')
      expect(job.status === 'rejected' && job.reason).toBeInstanceOf(UpdatePatchRejectedError)
      await expect(run()).rejects.toBeInstanceOf(UpdatePatchRejectedError)
      expect(await countEmail(table.id, 'same@example.test')).toBe(TABLE_LIMITS.UPDATE_BATCH_SIZE)
    })

    it('finishes when a column it writes gains a select option mid-job', async () => {
      const { table, run } = await seededJob({ status: 'Open' })

      const [job, change] = await changeBetweenBatches(table.id, run, () =>
        updateColumnOptions(
          {
            tableId: table.id,
            columnName: 'status',
            options: [
              { id: 'opt_open', name: 'Open' },
              { id: 'opt_closed', name: 'Closed' },
            ],
          },
          'bulk-update'
        )
      )

      expect(change.status).toBe('fulfilled')
      expect(job.status).toBe('fulfilled')
      const [{ count }] = await control<{ count: number }[]>`SELECT count(*)::int AS count
        FROM user_table_rows WHERE table_id = ${table.id} AND data->>'status' = 'opt_open'`
      expect(count).toBe(ROWS)
    })

    it('re-derives the patch for later batches once a patched column is retyped mid-job', async () => {
      const { table, run, retry } = await seededJob({ note: '7' })
      const notes = async () =>
        control<{ kind: string; count: number }[]>`SELECT jsonb_typeof(data->'note') AS kind,
          count(*)::int AS count FROM user_table_rows WHERE table_id = ${table.id}
          GROUP BY 1 ORDER BY 1`

      const [job, change] = await changeBetweenBatches(table.id, run, () =>
        changeSchemaUnderLock(table.id, `jsonb_set(schema, '{columns,3,type}', '"number"')`)
      )

      expect([job.status, change.status]).toEqual(['fulfilled', 'fulfilled'])
      expect(await notes()).toEqual([
        { kind: 'number', count: ROWS - TABLE_LIMITS.UPDATE_BATCH_SIZE },
        { kind: 'string', count: TABLE_LIMITS.UPDATE_BATCH_SIZE },
      ])
      const [{ seven }] = await control<{ seven: number }[]>`SELECT count(*)::int AS seven
        FROM user_table_rows WHERE table_id = ${table.id} AND data->'note' IN ('"7"', '7')`
      expect(seven).toBe(ROWS)

      await expect(retry()).resolves.toBeUndefined()
      expect(await notes()).toEqual([{ kind: 'number', count: ROWS }])
    })

    it('drops a column deleted mid-job from later batches', async () => {
      const { table, run } = await seededJob({ note: 'x', email: 'y@example.test' })

      const [job, change] = await changeBetweenBatches(table.id, run, () =>
        changeSchemaUnderLock(table.id, `schema #- '{columns,3}'`)
      )

      expect([job.status, change.status]).toEqual(['fulfilled', 'fulfilled'])
      expect(await countEmail(table.id, 'y@example.test')).toBe(ROWS)
      const [{ count }] = await control<{ count: number }[]>`SELECT count(*)::int AS count
        FROM user_table_rows WHERE table_id = ${table.id} AND data->>'note' = 'x'`
      expect(count).toBe(TABLE_LIMITS.UPDATE_BATCH_SIZE)
    })

    it('refuses a batch whose re-derived patch grows a row past the size limit', async () => {
      const { table, run } = await seededJob({ note: 7 })
      await changeSchemaUnderLock(table.id, `jsonb_set(schema, '{columns,3,type}', '"number"')`)
      const bigRowId = `${table.id}-${String(TABLE_LIMITS.UPDATE_BATCH_SIZE + 1).padStart(4, '0')}`
      // Stored jsonb orders keys by length, so a merged row reads kind, email, filler, then note.
      const email = `e${TABLE_LIMITS.UPDATE_BATCH_SIZE + 1}@example.test`
      const base = Buffer.byteLength(JSON.stringify({ kind: 'seed', email, filler: '', note: 7 }))
      await control`UPDATE user_table_rows
        SET data = data || jsonb_build_object('filler', repeat('x', ${getMaxRowSizeBytes() - base}))
        WHERE id = ${bigRowId}`

      const [job, change] = await changeBetweenBatches(table.id, run, () =>
        changeSchemaUnderLock(table.id, `jsonb_set(schema, '{columns,3,type}', '"string"')`)
      )

      expect(change.status).toBe('fulfilled')
      expect(job.status === 'rejected' && job.reason).toBeInstanceOf(UpdatePatchRejectedError)
      const [{ count }] = await control<{ count: number }[]>`SELECT count(*)::int AS count
        FROM user_table_rows WHERE table_id = ${table.id} AND data ? 'note'`
      expect(count).toBe(TABLE_LIMITS.UPDATE_BATCH_SIZE)
    })

    it('writes a date patch given as an epoch number', async () => {
      const { table, run } = await seededJob({ due: 1704067200000 })

      await run()

      const [{ count }] = await control<{ count: number }[]>`SELECT count(*)::int AS count
        FROM user_table_rows WHERE table_id = ${table.id}
          AND (data->>'due')::timestamptz = '2024-01-01T00:00:00Z'`
      expect(count).toBe(ROWS)
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
