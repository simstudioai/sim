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
import { tableTriggerMock } from '@sim/testing/mocks/table-trigger.mock'
import { tableWorkflowColumnsMock } from '@sim/testing/mocks/table-workflow-columns.mock'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/table/billing', () => tableBillingMock)
vi.mock('@/lib/table/trigger', () => tableTriggerMock)
vi.mock('@/lib/table/workflow-columns', () => tableWorkflowColumnsMock)
vi.mock('@/lib/uploads/core/storage-service', () => storageServiceMock)

import { bulkInsertImportBatch } from '@/lib/table/import-data'
import { batchInsertRows, batchUpdateRows, insertRow, updateRow } from '@/lib/table/rows/service'
import { getTableById } from '@/lib/table/service'
import { getOrCreateTableSnapshot } from '@/lib/table/snapshot-cache'
import type { ColumnDefinition, TableDefinition } from '@/lib/table/types'

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
  rows: Array<{ id: string; data: Record<string, string>; orderKey: string | null }>
) {
  await db.insert(userTableRows).values(rows.map((row) => ({ ...row, tableId, workspaceId })))
}

async function rowsVersion(tableId: string): Promise<number> {
  const [row] = await control`SELECT rows_version FROM user_table_definitions WHERE id = ${tableId}`
  return Number(row.rows_version)
}

const textColumns = (...ids: string[]): ColumnDefinition[] =>
  ids.map((id) => ({ id, name: id, type: 'string' }))

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
     * `expected.onValueLock` wait on a unique-value lock, and returns the last count seen.
     */
    async function waitForLockWaiters(tableId: string, expected: LockWaiters) {
      const orderLockKey = `user_table_rows_pos:${tableId}`
      let waiting: LockWaiters = { onOrderLock: 0, onValueLock: 0 }
      for (let attempt = 0; attempt < 400; attempt++) {
        await sleep(5)
        ;[waiting] = await control<LockWaiters[]>`
          WITH lock AS (SELECT hashtextextended(${orderLockKey}, 0) AS key)
          SELECT
            count(*) FILTER (
              WHERE l.classid = ((lock.key >> 32) & 4294967295)::oid
                AND l.objid = (lock.key & 4294967295)::oid
            )::int AS "onOrderLock",
            count(*) FILTER (WHERE a.query LIKE '%user_table_unique_value%')::int AS "onValueLock"
          FROM pg_locks l
          JOIN pg_stat_activity a ON a.pid = l.pid
          CROSS JOIN lock
          WHERE l.locktype = 'advisory' AND NOT l.granted
            AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database())`
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

    async function storedCount(tableId: string, match: Record<string, string | number>) {
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
          () =>
            updateRow(
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
            ),
        ],
        { onOrderLock: 1, onValueLock: 1 }
      )

      expect(fulfilled(results)).toBe(1)
      expect(await storedCount(table.id, { email: 'dup@example.test' })).toBe(1)
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
            await waitForLockWaiters(table.id, { onOrderLock: 1, onValueLock: 0 })
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
