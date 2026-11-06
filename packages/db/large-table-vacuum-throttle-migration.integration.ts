import { readFile } from 'node:fs/promises'
import { applyMigration } from '@sim/db/scripts/migration-fixture'
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const databaseUrl = readTestDatabaseUrl()
const TABLES = ['embedding', 'embedding_search', 'workflow_execution_logs'] as const
const THROTTLE = ['autovacuum_vacuum_cost_delay=10', 'autovacuum_vacuum_cost_limit=200']

/**
 * Applies 0431 to stand-in tables, each with a TOAST relation, and checks the settings land on
 * both relations without the statement ever holding a lock that reads or writes wait on.
 */
describe('large table vacuum throttle migration in PostgreSQL', () => {
  let admin: Sql
  let migrator: Sql
  let writer: Sql
  let migration: string
  let statements: string[]
  const schema = `vacuum_throttle_${generateId().replaceAll('-', '')}`
  const rel = (table: string) => `"${schema}"."${table}"`

  /** The writer gives up quickly, so a write queued behind the migration fails instead of hanging. */
  const connect = (lockTimeoutMs?: number) =>
    postgres(databaseUrl, {
      max: 1,
      connection: {
        search_path: schema,
        ...(lockTimeoutMs ? { lock_timeout: lockTimeoutMs } : {}),
      },
      onnotice: () => undefined,
    })

  beforeAll(async () => {
    admin = postgres(databaseUrl, { max: 1, onnotice: () => undefined })
    await admin.unsafe(
      [
        `CREATE SCHEMA "${schema}"`,
        ...TABLES.map((table) => `CREATE TABLE ${rel(table)} (id text PRIMARY KEY, body text)`),
      ].join(';')
    )
    migrator = connect()
    writer = connect(300)
    migration = await readFile(
      new URL('./migrations/0431_large_table_vacuum_throttle.sql', import.meta.url),
      'utf8'
    )
    statements = migration
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter(Boolean)
  })

  afterAll(async () => {
    await migrator?.end()
    await writer?.end()
    if (admin) {
      await admin.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      await admin.end()
    }
  })

  it('takes only SHARE UPDATE EXCLUSIVE and rewrites nothing, so reads and writes proceed', async () => {
    const relfilenode = async () =>
      (
        await admin<{ node: string }[]>`
          SELECT relfilenode::text AS node FROM pg_class WHERE oid = ${rel('embedding')}::regclass`
      )[0]?.node
    const before = await relfilenode()

    await migrator.begin(async (tx) => {
      await tx.unsafe(statements[0])
      const locks = await tx<{ mode: string }[]>`
        SELECT mode FROM pg_locks
        WHERE pid = pg_backend_pid() AND locktype = 'relation'
          AND relation = ${rel('embedding')}::regclass`
      expect(locks.map((lock) => lock.mode)).toEqual(['ShareUpdateExclusiveLock'])

      // Another session reads and writes the table while the migration transaction holds it.
      await writer`INSERT INTO embedding (id, body) VALUES ('during', 'x')`
      expect(await writer`SELECT id FROM embedding`).toHaveLength(1)
    })

    expect(await relfilenode()).toBe(before)
  })

  it('does not queue writers behind it while it waits for a conflicting holder', async () => {
    const holder = connect()
    let releaseHolder = () => {}
    const released = new Promise<void>((resolve) => {
      releaseHolder = resolve
    })
    try {
      let holderLocked = () => {}
      const locked = new Promise<void>((resolve) => {
        holderLocked = resolve
      })
      const holding = holder.begin(async (tx) => {
        await tx.unsafe('LOCK TABLE embedding_search IN SHARE UPDATE EXCLUSIVE MODE')
        holderLocked()
        await released
      })
      await locked

      // postgres.js sends a query only once it is awaited or executed.
      const waiting = migrator.unsafe(statements[1]).execute()
      let queued: { mode: string }[] = []
      for (let attempt = 0; attempt < 100 && queued.length === 0; attempt++) {
        queued = await admin<{ mode: string }[]>`
          SELECT mode FROM pg_locks
          WHERE NOT granted AND locktype = 'relation'
            AND relation = ${rel('embedding_search')}::regclass`
        if (queued.length === 0) await sleep(10)
      }
      expect(queued.map((lock) => lock.mode)).toEqual(['ShareUpdateExclusiveLock'])

      await writer`INSERT INTO embedding_search (id, body) VALUES ('queued', 'x')`

      releaseHolder()
      await holding
      await waiting
    } finally {
      releaseHolder()
      await holder.end()
    }
  })

  it('sets the throttle on every table and its TOAST relation', async () => {
    // The whole file, so this holds on its own; reapplying the same settings is a no-op.
    await applyMigration(migrator, migration)
    const rows = await admin<{ heap: string[] | null; toast: string[] | null }[]>`
      SELECT c.reloptions AS heap, t.reloptions AS toast
      FROM pg_class c JOIN pg_class t ON t.oid = c.reltoastrelid
      WHERE c.oid = ANY(${TABLES.map(rel)}::regclass[])`
    expect(rows).toHaveLength(TABLES.length)
    for (const row of rows) {
      expect(row.heap).toEqual(expect.arrayContaining(THROTTLE))
      expect(row.toast).toEqual(expect.arrayContaining(THROTTLE))
    }
  })
})
