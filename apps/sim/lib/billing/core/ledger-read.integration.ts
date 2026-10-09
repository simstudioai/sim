import type { db } from '@sim/db'
import * as schema from '@sim/db/schema'
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { getPostgresErrorCode } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { USAGE_LEDGER_STATEMENT_TIMEOUT_MS } from '@/lib/billing/constants'
import { readLedgerBounded } from '@/lib/billing/core/ledger-read'

vi.mock('@/lib/billing/constants', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/billing/constants')>()),
  USAGE_LEDGER_STATEMENT_TIMEOUT_MS: 1000,
}))

const schemaName = `ledger_read_${generateId().replaceAll('-', '')}`
const connection = postgres(readTestDatabaseUrl(), {
  max: 1,
  prepare: false,
  connection: { search_path: schemaName },
  onnotice: () => undefined,
})
const database = drizzle(connection, { schema }) as typeof db

beforeAll(async () => {
  await connection.unsafe(`CREATE SCHEMA "${schemaName}"`)
  await connection.unsafe(`CREATE TABLE ledger_probe (cost numeric NOT NULL);
    CREATE FUNCTION fail_read(code text) RETURNS numeric LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION USING ERRCODE = code, MESSAGE = 'fixture database failure'; END $$;`)
})

beforeEach(async () => {
  await connection`TRUNCATE ledger_probe`
  await connection`INSERT INTO ledger_probe VALUES (0.25), (0.75)`
})

afterAll(async () => {
  await connection.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
  await connection.end()
})

describe('bounded ledger reads with PostgreSQL', () => {
  it('rolls back a recovery conflict and reads the ledger in a fresh transaction', async () => {
    const transactions: string[] = []
    const timeouts: number[] = []
    const total = await readLedgerBounded(database, async (tx) => {
      const rows = await tx.execute<{ transaction: string; timeout: string }>(
        sql`select txid_current()::text as transaction,
          extract(epoch from current_setting('statement_timeout')::interval) * 1000 as timeout`
      )
      transactions.push(rows[0].transaction)
      timeouts.push(Number(rows[0].timeout))
      if (transactions.length === 1) await tx.execute(sql`select fail_read('40001')`)
      const sums = await tx.execute<{ total: string }>(
        sql`select sum(cost) as total from ledger_probe`
      )
      return Number(sums[0].total)
    })
    expect(total).toBe(1)
    expect(transactions).toHaveLength(2)
    expect(new Set(transactions).size).toBe(2)
    expect(timeouts.every((timeout) => timeout > 0)).toBe(true)
    expect(timeouts[1]).toBeLessThan(timeouts[0])
    expect(await connection`select sum(cost)::text as total from ledger_probe`).toEqual([
      { total: '1.00' },
    ])
  })

  it('deducts time waiting for a pooled connection from the statement budget', async () => {
    let observeRead: Promise<number> | undefined
    await connection.begin(async () => {
      observeRead = readLedgerBounded(database, async (tx) => {
        const rows = await tx.execute<{ timeout: string }>(
          sql`select extract(epoch from current_setting('statement_timeout')::interval) * 1000 as timeout`
        )
        return Number(rows[0].timeout)
      })
      await sleep(100)
    })
    if (!observeRead) throw new Error('Ledger read was not started')
    expect(await observeRead).toBeLessThanOrEqual(USAGE_LEDGER_STATEMENT_TIMEOUT_MS - 80)
  })

  it('rejects a ledger read whose connection wait exhausted the budget', async () => {
    let outcome: Promise<number> | undefined
    await connection.begin(async () => {
      outcome = readLedgerBounded(database, async (tx) => {
        const rows = await tx.execute<{ total: string }>(
          sql`select sum(cost) as total from ledger_probe`
        )
        return Number(rows[0].total)
      })
      void outcome.catch(() => undefined)
      await sleep(USAGE_LEDGER_STATEMENT_TIMEOUT_MS + 100)
    })
    if (!outcome) throw new Error('Ledger read was not started')
    await expect(outcome).rejects.toThrow('Database read deadline exceeded')
    expect(await connection`select sum(cost)::text as total from ledger_probe`).toEqual([
      { total: '1.00' },
    ])
  })

  it('cannot replay a write under the read-retry policy', async () => {
    const error = await readLedgerBounded(database, async (tx) => {
      await tx.execute(sql`insert into ledger_probe values (999)`)
      return 999
    }).catch((error: unknown) => error)
    expect(getPostgresErrorCode(error)).toBe('25006')
    expect(await connection`select sum(cost)::text as total from ledger_probe`).toEqual([
      { total: '1.00' },
    ])
  })

  it.each([
    { code: '40001', attempts: 2 },
    { code: '57014', attempts: 1 },
    { code: '42P01', attempts: 1 },
  ])(
    'bounds attempts for $code and releases the failed transaction',
    async ({ code, attempts }) => {
      let reads = 0
      const error = await readLedgerBounded(database, async (tx) => {
        reads++
        await tx.execute(sql`select fail_read(${code})`)
      }).catch((error: unknown) => error)
      expect(getPostgresErrorCode(error)).toBe(code)
      expect(reads).toBe(attempts)
      expect(await connection`select sum(cost)::text as total from ledger_probe`).toEqual([
        { total: '1.00' },
      ])
    }
  )
})
