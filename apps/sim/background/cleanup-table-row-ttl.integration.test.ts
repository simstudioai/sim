/**
 * @vitest-environment node
 *
 * Destructive integration tests against a migrated, disposable local expiration_qa database.
 * Set both DATABASE_URL and TABLE_TTL_TEST_DATABASE_URL to that database. All worker SQL,
 * table transactions, schema reads, and row-count triggers run for real.
 */
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { sql } from 'drizzle-orm'
import postgres from 'postgres'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.unmock('@sim/db')
vi.unmock('@sim/db/schema')
vi.unmock('drizzle-orm')

const { enabled, signalChanged, fireTrigger } = vi.hoisted(() => ({
  enabled: vi.fn(),
  signalChanged: vi.fn(),
  fireTrigger: vi.fn(),
}))
vi.mock('@/lib/table/ttl-availability', () => ({ isTableRowTtlEnabled: enabled }))
vi.mock('@/lib/table/events', () => ({ signalTableRowsChanged: signalChanged }))
vi.mock('@/lib/table/trigger', () => ({ fireTableTrigger: fireTrigger }))

import { db } from '@sim/db'
import { validatedTimestampSql } from '@/lib/table/column-types/timestamp-sql'
import { updateColumnConstraints } from '@/lib/table/columns/service'
import { getDeleteSnapshotBatchSize } from '@/lib/table/constants'
import { replaceTableRowsWithTx } from '@/lib/table/rows/service'
import { getTableById } from '@/lib/table/service'
import { fieldPredicate } from '@/lib/table/sql'
import { normalizeTtlTimestamp, TTL_TIMESTAMP_VALIDATION } from '@/lib/table/ttl-values'
import type { TableSchema } from '@/lib/table/types'
import { checkBatchUniqueConstraintsDb, coerceRowToSchema } from '@/lib/table/validation'
import { runCleanupTableRowTtl } from '@/background/cleanup-table-row-ttl'

const url = process.env.TABLE_TTL_TEST_DATABASE_URL
if (url) {
  const parsed = new URL(url)
  const otherDatabase = Object.entries(process.env).some(
    ([key, value]) => /^DATABASE_(URL|REPLICA_URL)(_|$)/.test(key) && value && value !== url
  )
  if (
    !['127.0.0.1', 'localhost'].includes(parsed.hostname) ||
    parsed.pathname !== '/expiration_qa' ||
    process.env.DATABASE_URL !== url ||
    otherDatabase
  ) {
    throw new Error('This suite requires only the disposable local expiration_qa database')
  }
}
const control = postgres(url ?? 'postgres://localhost/disabled_expiration_test', {
  max: 4,
  onnotice: () => {},
})
const workspaceId = generateId()
const userId = generateId()
const expired = '2020-01-01T00:00:00Z'
const future = '9998-01-01T00:00:00Z'
const schema = { columns: [{ id: 'expires', name: 'expires_at', type: 'ttl' }] }
const measurements: Record<string, unknown> = {}

async function createTable(columns = schema.columns): Promise<string> {
  const id = generateId()
  await control`INSERT INTO user_table_definitions (id, workspace_id, name, schema, created_by, max_rows)
    VALUES (${id}, ${workspaceId}, ${id}, ${control.json({ columns })}, ${userId}, 2000000)`
  return id
}

async function seedRows(tableId: string, count: number, value: string | null = expired) {
  await control`INSERT INTO user_table_rows (id, table_id, workspace_id, data, position, created_at)
    SELECT ${tableId} || '-' || lpad(n::text, 9, '0'), ${tableId}, ${workspaceId},
      jsonb_build_object('expires', ${value}::text), n, '2020-01-01'::timestamp
    FROM generate_series(1, ${count}) AS n`
}

async function rowCount(tableId: string): Promise<number> {
  const [result] =
    await control`SELECT count(*)::int AS count FROM user_table_rows WHERE table_id = ${tableId}`
  const [definition] =
    await control`SELECT row_count FROM user_table_definitions WHERE id = ${tableId}`
  expect(definition.row_count).toBe(result.count)
  return result.count
}

async function installDeleteFault(tableId: string, body: string) {
  await control.unsafe(`CREATE OR REPLACE FUNCTION expiration_qa_delete_fault() RETURNS trigger
    LANGUAGE plpgsql AS $function$ BEGIN
      IF OLD.table_id = TG_ARGV[0] THEN ${body} END IF;
      RETURN OLD;
    END $function$`)
  await control.unsafe(`CREATE TRIGGER expiration_qa_delete_fault BEFORE DELETE ON user_table_rows
    FOR EACH ROW EXECUTE FUNCTION expiration_qa_delete_fault('${tableId}')`)
}

async function removeDeleteFault() {
  await control`DROP TRIGGER IF EXISTS expiration_qa_delete_fault ON user_table_rows`
  await control`DROP FUNCTION IF EXISTS expiration_qa_delete_fault()`
}

async function waitForSleepingDelete(): Promise<number> {
  for (let attempt = 0; attempt < 400; attempt++) {
    const rows = await control`SELECT pid FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event = 'PgSleep'
        AND query LIKE '%WITH locked_rows%'`
    if (rows[0]) return Number(rows[0].pid)
    await sleep(5)
  }
  throw new Error('Cleanup never reached the injected in-transaction pause')
}

describe.skipIf(!url)('Expiration with real PostgreSQL transactions', () => {
  beforeAll(async () => {
    await control`INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
      VALUES (${userId}, 'Expiration integration fixture', ${`${userId}@example.test`}, true, now(), now())`
    await control`INSERT INTO workspace (id, name, owner_id, billed_account_user_id)
      VALUES (${workspaceId}, 'Expiration integration fixtures', ${userId}, ${userId})`
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    enabled.mockResolvedValue(true)
    fireTrigger.mockResolvedValue(undefined)
    await control`DELETE FROM user_table_definitions WHERE workspace_id = ${workspaceId}`
  })

  afterEach(async () => {
    await removeDeleteFault()
    vi.restoreAllMocks()
  })

  afterAll(async () => {
    await control`DELETE FROM workspace WHERE id = ${workspaceId}`
    await control`DELETE FROM "user" WHERE id = ${userId}`
    writeFileSync(
      join(tmpdir(), 'expiration-qa-measurements.json'),
      JSON.stringify(measurements, null, 2)
    )
    await control.end()
  })

  it('does nothing with no TTL, empty tables, missing/null/invalid cells, or only future deadlines', async () => {
    const plain = await createTable([{ id: 'expires', name: 'expires_at', type: 'date' }])
    await seedRows(plain, 1)
    await createTable()
    const table = await createTable()
    await seedRows(table, 1, future)
    for (const [index, value] of [
      null,
      '',
      'not-a-date',
      '2026-02-30T00:00:00Z',
      0,
      {},
      [],
    ].entries()) {
      await control`INSERT INTO user_table_rows (id, table_id, workspace_id, data)
        VALUES (${generateId()}, ${table}, ${workspaceId}, ${control.json(index === 0 ? {} : { expires: value })})`
    }
    const result = await runCleanupTableRowTtl()
    expect(result.deleted).toBe(0)
    expect(await rowCount(plain)).toBe(1)
    expect(await rowCount(table)).toBe(8)
    expect(fireTrigger).not.toHaveBeenCalled()
  })

  it('deletes exactly through the cutoff and preserves a future microsecond across offsets', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-07T12:00:00.500Z'))
    const table = await createTable()
    const values = [
      '2026-09-07T12:00:00.499999Z',
      '2026-09-07T12:00:00.500000Z',
      '2026-09-07T05:00:00.500000-07:00',
      '2026-09-07T17:45:00.500000+05:45',
      '2026-09-07T12:00:00.500001Z',
      '2026-09-07T05:00:00.500001-07:00',
    ]
    for (const value of values) {
      await control`INSERT INTO user_table_rows (id, table_id, workspace_id, data)
        VALUES (${generateId()}, ${table}, ${workspaceId}, ${control.json({ expires: value })})`
    }
    expect((await runCleanupTableRowTtl()).deleted).toBe(4)
    expect(await rowCount(table)).toBe(2)
    expect(fireTrigger.mock.calls[0][4]).toHaveLength(4)
  })

  it('respects feature disablement, delete locks, and archival, then catches up when restored', async () => {
    const table = await createTable()
    await seedRows(table, 1)
    enabled.mockResolvedValue(false)
    expect((await runCleanupTableRowTtl()).deleted).toBe(0)
    enabled.mockResolvedValue(true)
    await control`UPDATE user_table_definitions SET delete_locked = true WHERE id = ${table}`
    expect((await runCleanupTableRowTtl()).deleted).toBe(0)
    await control`UPDATE user_table_definitions SET delete_locked = false, archived_at = now() WHERE id = ${table}`
    expect((await runCleanupTableRowTtl()).deleted).toBe(0)
    expect(await rowCount(table)).toBe(1)
    await control`UPDATE user_table_definitions SET archived_at = null WHERE id = ${table}`
    expect((await runCleanupTableRowTtl()).deleted).toBe(1)
  })

  it('hits the real 100-batch limit and deletes the exact remaining row on the next pass', async () => {
    const table = await createTable()
    const capacity = 100 * getDeleteSnapshotBatchSize()
    await seedRows(table, capacity + 1)
    expect(await runCleanupTableRowTtl()).toEqual({
      batches: 100,
      deleted: capacity,
      limitReached: true,
    })
    expect(await rowCount(table)).toBe(1)
    expect((await runCleanupTableRowTtl()).deleted).toBe(1)
    expect(await rowCount(table)).toBe(0)
    measurements.singleRunCapacity = capacity
  }, 30000)

  it('services more than 100 tables across passes without losing the unselected table', async () => {
    const tables: string[] = []
    for (let index = 0; index < 101; index++) {
      const table = await createTable()
      tables.push(table)
      await seedRows(table, 1)
    }
    const first = await runCleanupTableRowTtl()
    expect(first).toEqual({ batches: 100, deleted: 100, limitReached: true })
    const remaining =
      await control`SELECT count(*)::int AS count FROM user_table_rows WHERE workspace_id = ${workspaceId}`
    expect(remaining[0].count).toBe(1)
    expect((await runCleanupTableRowTtl()).deleted).toBe(1)
    expect(await rowCount(tables[0])).toBe(0)
    measurements.tableLimit = { tables: 101, firstPassDeleted: first.deleted, secondPassDeleted: 1 }
  }, 30000)

  it('revisits a skipped locked row on the next pass', async () => {
    const table = await createTable()
    await seedRows(table, 2)
    const locked = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const holding = control.begin(async (trx) => {
      await trx`SELECT id FROM user_table_rows WHERE table_id = ${table} ORDER BY id LIMIT 1 FOR UPDATE`
      locked.resolve()
      await release.promise
    })
    await locked.promise
    try {
      expect((await runCleanupTableRowTtl()).deleted).toBe(1)
    } finally {
      release.resolve()
      await holding
    }
    expect((await runCleanupTableRowTtl()).deleted).toBe(1)
    expect(await rowCount(table)).toBe(0)
  })

  it('drains 1001 expiring tables across bounded passes', async () => {
    for (let index = 0; index < 1001; index++) {
      await seedRows(await createTable(), 1)
    }
    let deleted = 0
    let passes = 0
    while (deleted < 1001) {
      const result = await runCleanupTableRowTtl()
      expect(result.batches).toBeLessThanOrEqual(100)
      expect(result.deleted).toBeGreaterThan(0)
      deleted += result.deleted
      expect(++passes).toBeLessThanOrEqual(11)
    }
    expect(deleted).toBe(1001)
    measurements.manyTables = { tables: 1001, passes }
  }, 30000)

  it('gives small tables a turn before revisiting a large backlog', async () => {
    const large = await createTable()
    const batch = getDeleteSnapshotBatchSize()
    await seedRows(large, batch * 100)
    const small: string[] = []
    for (let index = 0; index < 20; index++) {
      const table = await createTable()
      small.push(table)
      await seedRows(table, 1)
    }
    await runCleanupTableRowTtl()
    for (const table of small) expect(await rowCount(table)).toBe(0)
    const order = fireTrigger.mock.calls.map((call) => call[0])
    const firstLarge = order.indexOf(large)
    const secondLarge = order.indexOf(large, firstLarge + 1)
    for (const table of small) expect(order.indexOf(table)).toBeLessThan(secondLarge)
    expect(await rowCount(large)).toBeGreaterThan(0)
  }, 30000)

  it.each(['delete lock', 'archive', 'remove column'])(
    'rechecks a mid-run %s before the next batch',
    async (change) => {
      const table = await createTable()
      const batch = getDeleteSnapshotBatchSize()
      await seedRows(table, batch + 1)
      fireTrigger.mockImplementationOnce(async () => {
        if (change === 'delete lock')
          await control`UPDATE user_table_definitions SET delete_locked = true WHERE id = ${table}`
        if (change === 'archive')
          await control`UPDATE user_table_definitions SET archived_at = now() WHERE id = ${table}`
        if (change === 'remove column')
          await control`UPDATE user_table_definitions SET schema = '{"columns":[]}'::jsonb WHERE id = ${table}`
      })
      expect((await runCleanupTableRowTtl()).deleted).toBe(batch)
      expect(await rowCount(table)).toBe(1)
      await control`UPDATE user_table_definitions SET delete_locked = false, archived_at = null, schema = ${control.json(schema)} WHERE id = ${table}`
      expect((await runCleanupTableRowTtl()).deleted).toBe(1)
    }
  )

  it('uses one cutoff per run and finds newly expired rows behind its cursor next time', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-07T12:00:00Z'))
    const table = await createTable()
    await seedRows(table, getDeleteSnapshotBatchSize())
    const lateId = generateId()
    await control`INSERT INTO user_table_rows (id, table_id, workspace_id, data, created_at)
      VALUES (${lateId}, ${table}, ${workspaceId}, ${control.json({ expires: '2026-09-07T12:00:01Z' })}, '2021-01-01')`
    fireTrigger.mockImplementationOnce(async () => {
      now.mockReturnValue(Date.parse('2026-09-07T12:00:02Z'))
      await control`INSERT INTO user_table_rows (id, table_id, workspace_id, data, created_at)
        VALUES (${generateId()}, ${table}, ${workspaceId}, ${control.json({ expires: expired })}, '2010-01-01')`
    })
    expect((await runCleanupTableRowTtl()).deleted).toBe(getDeleteSnapshotBatchSize())
    expect(await rowCount(table)).toBe(2)
    expect((await runCleanupTableRowTtl()).deleted).toBe(2)
  })

  it('handles two concurrent cleanup runs without duplicate deletes or snapshots', async () => {
    const table = await createTable()
    const count = getDeleteSnapshotBatchSize() * 4 + 1
    await seedRows(table, count)
    const results = await Promise.all([runCleanupTableRowTtl(), runCleanupTableRowTtl()])
    expect(results.reduce((sum, result) => sum + result.deleted, 0)).toBe(count)
    expect(await rowCount(table)).toBe(0)
    const ids = fireTrigger.mock.calls.flatMap((call) =>
      call[4].map((row: { id: string }) => row.id)
    )
    expect(ids).toHaveLength(count)
    expect(new Set(ids).size).toBe(count)
  })

  it.each([future, null])(
    'preserves a locked row whose expiration changes to %s',
    async (value) => {
      const table = await createTable()
      await seedRows(table, 1)
      const locked = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      const holding = control.begin(async (trx) => {
        await trx`SELECT id FROM user_table_rows WHERE table_id = ${table} FOR UPDATE`
        locked.resolve()
        await release.promise
        await trx`UPDATE user_table_rows SET data = ${trx.json({ expires: value })} WHERE table_id = ${table}`
      })
      await locked.promise
      try {
        expect((await runCleanupTableRowTtl()).deleted).toBe(0)
      } finally {
        release.resolve()
        await holding
      }
      expect((await runCleanupTableRowTtl()).deleted).toBe(0)
      expect(await rowCount(table)).toBe(1)
    }
  )

  it('rolls back a failed batch, keeps prior commits, and drains the remainder after repair', async () => {
    const table = await createTable()
    const batch = getDeleteSnapshotBatchSize()
    await seedRows(table, batch * 2)
    await installDeleteFault(
      table,
      `IF OLD.position > ${batch} THEN RAISE EXCEPTION 'injected expiration failure'; END IF;`
    )
    await expect(runCleanupTableRowTtl()).resolves.toEqual({
      batches: 2,
      deleted: batch,
      limitReached: false,
    })
    expect(await rowCount(table)).toBe(batch)
    expect(signalChanged).toHaveBeenCalledWith(table)
    await removeDeleteFault()
    expect((await runCleanupTableRowTtl()).deleted).toBe(batch)
    expect(await rowCount(table)).toBe(0)
  })

  it('skips a persistently broken first table, drains healthy tables, and retries after repair', async () => {
    const cutoff = '2026-09-07T12:00:00.000Z'
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(cutoff))
    await createTable()
    await createTable()
    const tables = await control<{ id: string }[]>`SELECT id FROM user_table_definitions
      WHERE workspace_id = ${workspaceId} ORDER BY md5(id || ${cutoff}), id`
    const [broken, healthy] = tables.map(({ id }) => id)
    const healthyRows = getDeleteSnapshotBatchSize() + 1
    await seedRows(broken, 3)
    await seedRows(healthy, healthyRows)
    await installDeleteFault(broken, "RAISE EXCEPTION 'injected table failure';")

    await expect(runCleanupTableRowTtl()).resolves.toEqual({
      batches: 4,
      deleted: healthyRows,
      limitReached: false,
    })
    expect(await rowCount(broken)).toBe(3)
    expect(await rowCount(healthy)).toBe(0)
    expect(signalChanged).toHaveBeenCalledWith(healthy)
    expect(signalChanged).not.toHaveBeenCalledWith(broken)
    expect(fireTrigger).toHaveBeenCalledTimes(2)

    await expect(runCleanupTableRowTtl()).resolves.toEqual({
      batches: 1,
      deleted: 0,
      limitReached: false,
    })
    expect(await rowCount(broken)).toBe(3)
    await removeDeleteFault()
    expect((await runCleanupTableRowTtl()).deleted).toBe(3)
    expect(await rowCount(broken)).toBe(0)
  })

  it('recovers from a real backend connection loss during DELETE without partial deletion', async () => {
    const table = await createTable()
    await seedRows(table, 3)
    await installDeleteFault(table, 'PERFORM pg_sleep(10);')
    const deleting = runCleanupTableRowTtl().then(
      (result) => ({ result }),
      (error: unknown) => ({ error })
    )
    const pid = await waitForSleepingDelete()
    await control`SELECT pg_terminate_backend(${pid})`
    expect(await deleting).toEqual({ result: { batches: 1, deleted: 0, limitReached: false } })
    expect(await rowCount(table)).toBe(3)
    await removeDeleteFault()
    expect((await runCleanupTableRowTtl()).deleted).toBe(3)
    expect(await rowCount(table)).toBe(0)
  }, 15000)

  it('stops between batches on cancellation and restarts without retaining a stale cursor', async () => {
    const table = await createTable()
    const batch = getDeleteSnapshotBatchSize()
    await seedRows(table, batch + 1)
    const abort = new AbortController()
    fireTrigger.mockImplementationOnce(async () => abort.abort())
    expect((await runCleanupTableRowTtl(abort.signal)).deleted).toBe(batch)
    expect(await rowCount(table)).toBe(1)
    expect((await runCleanupTableRowTtl()).deleted).toBe(1)
  })

  it('bounds snapshots by bytes and still progresses past an oversized stored row', async () => {
    const table = await createTable()
    await seedRows(table, 3)
    await control`UPDATE user_table_rows SET data = data || jsonb_build_object('wide', repeat('x', 33 * 1024 * 1024)) WHERE table_id = ${table} AND position = 1`
    await control`UPDATE user_table_rows SET data = data || jsonb_build_object('wide', repeat('y', 17 * 1024 * 1024)) WHERE table_id = ${table} AND position > 1`
    expect((await runCleanupTableRowTtl()).deleted).toBe(3)
    expect(fireTrigger.mock.calls.map((call) => call[4].length)).toEqual([1, 1, 1])
    expect(await rowCount(table)).toBe(0)
  }, 30000)

  it('matches equivalent instants for equality and membership without casting malformed stored values', async () => {
    const table = await createTable()
    const values = [
      '2090-09-07T07:30:00.000001-07:00',
      '2090-09-07T20:15:00.000001+05:45',
      '2090-09-07T14:30:00.000001Z',
      '2090-09-07T14:30:00.000001-00:00',
      '2090-09-07T14:30:00.000002-00:00',
      null,
      '',
      '2090-02-30T00:00:00Z',
      'not-a-date',
    ]
    for (const value of values) {
      await control`INSERT INTO user_table_rows (id, table_id, workspace_id, data)
        VALUES (${generateId()}, ${table}, ${workspaceId}, ${control.json({ expires: value })})`
    }
    const column = { id: 'expires', name: 'expires_at', type: 'ttl' as const }
    for (const op of ['eq', 'ne', 'in', 'nin'] as const) {
      const instant = '2090-09-07T14:30:00.000001+00:00'
      const value = op === 'in' || op === 'nin' ? [instant] : instant
      const predicate = fieldPredicate('user_table_rows', 'expires', op, value, column)
      const rows = await db.execute(sql`SELECT count(*)::int AS count FROM user_table_rows
        WHERE table_id = ${table} AND ${predicate}`)
      expect(rows[0].count).toBe(op === 'eq' || op === 'in' ? 4 : 5)
    }
    const nullPredicate = fieldPredicate('user_table_rows', 'expires', 'eq', null, column)
    const rows = await db.execute(
      sql`SELECT count(*)::int AS count FROM user_table_rows WHERE table_id = ${table} AND ${nullPredicate}`
    )
    expect(rows[0].count).toBe(1)
  })

  it('preserves offsets in storage while enforcing uniqueness by the exact instant', async () => {
    const table = await createTable()
    const uniqueSchema: TableSchema = {
      columns: [{ id: 'expires', name: 'expires_at', type: 'ttl', unique: true }],
    }
    const first = { expires: '2090-09-07T07:30:00.000001-07:00' }
    const equivalent = { expires: '2090-09-07T14:30:00.000001Z' }
    const nextMicrosecond = { expires: '2090-09-07T20:15:00.000002+05:45' }
    for (const row of [first, equivalent, nextMicrosecond]) {
      expect(coerceRowToSchema(row, uniqueSchema, 'reject').valid).toBe(true)
    }
    expect(first.expires).toBe('2090-09-07T07:30:00.000001-07:00')
    expect(equivalent.expires).toBe('2090-09-07T14:30:00.000001-00:00')
    expect(nextMicrosecond.expires).toBe('2090-09-07T20:15:00.000002+05:45')
    const withinBatch = await checkBatchUniqueConstraintsDb(
      table,
      [first, equivalent, nextMicrosecond],
      uniqueSchema
    )
    expect(withinBatch.errors.map(({ row }) => row)).toEqual([1])
    await seedRows(table, 1, first.expires)
    const againstStored = await checkBatchUniqueConstraintsDb(
      table,
      [equivalent, nextMicrosecond],
      uniqueSchema
    )
    expect(againstStored.errors.map(({ row }) => row)).toEqual([0])
    const definition = await getTableById(table)
    expect(definition).not.toBeNull()
    await expect(
      db.transaction((tx) =>
        replaceTableRowsWithTx(
          tx,
          {
            tableId: table,
            workspaceId,
            rows: [first, equivalent],
            secretProvenance: undefined,
          },
          { ...definition!, schema: uniqueSchema },
          'offset-qa'
        )
      )
    ).rejects.toThrow('must be unique')
    expect(await rowCount(table)).toBe(1)
    await control`INSERT INTO user_table_rows (id, table_id, workspace_id, data, position)
      VALUES (${generateId()}, ${table}, ${workspaceId}, ${control.json(equivalent)}, 2)`
    await expect(
      updateColumnConstraints({ tableId: table, columnName: 'expires', unique: true }, 'offset-qa')
    ).rejects.toThrow('duplicate')
    await control`UPDATE user_table_rows SET data = ${control.json(nextMicrosecond)} WHERE table_id = ${table} AND position = 2`
    const constrained = await updateColumnConstraints(
      { tableId: table, columnName: 'expires', unique: true },
      'offset-qa'
    )
    expect(constrained.schema.columns[0].unique).toBe(true)
    const stored =
      await control`SELECT data->>'expires' AS value FROM user_table_rows WHERE table_id = ${table} ORDER BY position`
    expect(stored.map(({ value }) => value)).toEqual([first.expires, nextMicrosecond.expires])
  })

  it('agrees with PostgreSQL for deterministic offset, leap-year, and precision samples', async () => {
    const samples: string[] = []
    for (const year of ['0001', '0099', '1900', '2000', '2024', '2026', '9998']) {
      for (const day of ['01-01', '02-28', '03-01', '12-31']) {
        for (const offset of [
          'Z',
          '-00:00',
          '+00:00',
          '-07:00',
          '-08:00',
          '+05:45',
          '+15:59',
          '-15:59',
        ]) {
          for (const fraction of ['', '.000001', '.123400', '.999999']) {
            const value = `${year}-${day}T12:34:56${fraction}${offset}`
            if (normalizeTtlTimestamp(value) !== null) samples.push(value)
          }
        }
      }
    }
    const normalized = samples.map((value) => normalizeTtlTimestamp(value)!)
    const [result] = await control`SELECT count(*)::int AS mismatch FROM
      unnest(${samples}::text[], ${normalized}::text[]) AS instants(input, normalized)
      WHERE input::timestamptz != normalized::timestamptz`
    expect(result.mismatch).toBe(0)
    const guarded = await db.execute(sql`WITH samples AS MATERIALIZED (
      SELECT jsonb_array_elements_text(${JSON.stringify(samples)}::jsonb) AS value
    ) SELECT count(*)::int AS mismatch FROM samples
      WHERE ${validatedTimestampSql(sql`samples.value`, TTL_TIMESTAMP_VALIDATION)}
        IS DISTINCT FROM samples.value::timestamptz`)
    expect(guarded[0].mismatch).toBe(0)
    measurements.postgresTimestampSamples = samples.length
  })

  it.skipIf(!process.env.TABLE_TTL_QA_STRESS_ROWS)(
    'drains a million-row backlog over bounded passes',
    async () => {
      const count = Number(process.env.TABLE_TTL_QA_STRESS_ROWS)
      expect(count).toBeGreaterThanOrEqual(100000)
      expect(count).toBeLessThanOrEqual(1000000)
      const table = await createTable()
      await seedRows(table, count)
      await control`INSERT INTO user_table_rows (id, table_id, workspace_id, data)
      VALUES (${generateId()}, ${table}, ${workspaceId}, ${control.json({ expires: future })}),
        (${generateId()}, ${table}, ${workspaceId}, ${control.json({ expires: null })})`
      const started = performance.now()
      let deleted = 0
      let passes = 0
      let maxRss = process.memoryUsage().rss
      while (deleted < count) {
        const result = await runCleanupTableRowTtl()
        expect(result.batches).toBeLessThanOrEqual(100)
        expect(result.deleted).toBeGreaterThan(0)
        deleted += result.deleted
        passes++
        maxRss = Math.max(maxRss, process.memoryUsage().rss)
        expect(passes).toBeLessThanOrEqual(
          Math.ceil(count / (100 * getDeleteSnapshotBatchSize())) + 1
        )
        fireTrigger.mockClear()
      }
      expect(deleted).toBe(count)
      expect(await rowCount(table)).toBe(2)
      measurements.stress = {
        rows: count,
        passes,
        deleted,
        survivors: 2,
        elapsedMs: Math.round(performance.now() - started),
        maxRss,
      }
    },
    300000
  )
})
