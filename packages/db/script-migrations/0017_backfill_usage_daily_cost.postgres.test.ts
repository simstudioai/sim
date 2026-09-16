import { readFileSync } from 'node:fs'
import {
  backfillUsageDailyCost,
  buildSearchDocumentLookupIndex,
  installUsageCostProjection,
} from '@sim/db/script-migrations/0017_backfill_usage_daily_cost'
import { generateId } from '@sim/utils/id'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const databaseUrl = process.env.BILLING_USAGE_TEST_DATABASE_URL
const schemaName = `usage_projection_${generateId().replaceAll('-', '')}`
const migration = readFileSync(
  new URL('../migrations/0351_usage_cost_projection_and_search_lookup.sql', import.meta.url),
  'utf8'
)
const triggerNames = [
  'usage_cost_projected',
  'usage_daily_cost_insert',
  'usage_daily_cost_update',
  'usage_daily_cost_delete',
  'usage_daily_cost_truncate',
]

describe.runIf(Boolean(databaseUrl))('usage cost projection upgrade in PostgreSQL', () => {
  let admin: Sql
  let sql: Sql
  let writer: Sql

  beforeAll(async () => {
    const url = new URL(databaseUrl!)
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
      throw new Error('Usage projection tests require a disposable local integration database')
    }
    admin = postgres(url.toString(), { max: 1, onnotice: () => undefined })
    await admin.unsafe(`CREATE SCHEMA "${schemaName}"`)
    const options = {
      max: 1,
      connection: { search_path: schemaName },
      onnotice: () => undefined,
    }
    sql = postgres(url.toString(), options)
    writer = postgres(url.toString(), options)
    await sql.unsafe(`
      CREATE TYPE billing_entity_type AS ENUM ('user', 'organization');
      CREATE TYPE usage_log_source AS ENUM ('workflow', 'workspace-chat');
      CREATE TABLE actor (id text PRIMARY KEY);
      CREATE TABLE usage_log (
        id text PRIMARY KEY, user_id text NOT NULL REFERENCES actor(id) ON DELETE CASCADE,
        source usage_log_source NOT NULL DEFAULT 'workspace-chat', cost numeric NOT NULL,
        event_key text UNIQUE, billing_entity_type billing_entity_type DEFAULT 'organization',
        billing_entity_id text DEFAULT 'payer', billing_period_start timestamp DEFAULT '2026-09-01',
        billing_period_end timestamp DEFAULT '2026-10-01',
        created_at timestamp NOT NULL DEFAULT '2026-09-16', metadata jsonb
      );
      CREATE TABLE embedding_search (
        id text PRIMARY KEY, document_id text NOT NULL,
        knowledge_base_id text NOT NULL, enabled boolean NOT NULL
      );
      INSERT INTO actor VALUES ('actor'), ('other');
    `)
    for (let replay = 0; replay < 2; replay++) {
      await sql.begin(async (tx) => {
        for (const statement of migration.split('--> statement-breakpoint')) {
          if (statement.trim()) await tx.unsafe(statement)
        }
      })
    }
  }, 30_000)

  beforeEach(async () => {
    for (const name of [...triggerNames, 'interrupt_usage_backfill']) {
      await sql.unsafe(`DROP TRIGGER IF EXISTS ${name} ON usage_log`)
    }
    await sql`TRUNCATE usage_log, usage_daily_cost, embedding_search`
    await sql`INSERT INTO actor VALUES ('actor'), ('other') ON CONFLICT DO NOTHING`
  })

  afterAll(async () => {
    await writer?.end()
    await sql?.end()
    if (admin) {
      await admin.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
      await admin.end()
    }
  })

  async function seed(count: number): Promise<void> {
    await sql`INSERT INTO usage_log (id, user_id, cost, event_key)
      SELECT 'event-' || lpad(n::text, 5, '0'), 'actor', n::numeric / 100000,
        'key-' || n FROM generate_series(1, ${count}) n`
  }

  async function assertExact(): Promise<void> {
    const differences = await sql`
      WITH expected AS (
        SELECT billing_entity_type, billing_entity_id, billing_period_start, billing_period_end,
          user_id, source, created_at::date AS usage_date,
          (get_byte(decode(md5(id), 'hex'), 0) % 8)::smallint AS shard,
          sum(cost) AS cost, count(*) AS entry_count
        FROM usage_log WHERE billing_entity_type IS NOT NULL
        GROUP BY billing_entity_type, billing_entity_id, billing_period_start, billing_period_end,
          user_id, source, created_at::date, (get_byte(decode(md5(id), 'hex'), 0) % 8)::smallint
      ), actual AS (SELECT * FROM usage_daily_cost)
      (SELECT * FROM expected EXCEPT SELECT * FROM actual)
      UNION ALL
      (SELECT * FROM actual EXCEPT SELECT * FROM expected)
    `
    expect(differences).toEqual([])
  }

  it('installs behind old writers and accounts their committed rows exactly once', async () => {
    const [{ pid }] = await sql`SELECT pg_backend_pid() AS pid`
    await writer`BEGIN`
    await writer`INSERT INTO usage_log (id, user_id, cost) VALUES ('old-writer', 'actor', 0.1)`
    const installing = Promise.allSettled([installUsageCostProjection(sql)])
    try {
      await vi.waitFor(async () => {
        const [{ waiting }] = await admin`SELECT EXISTS (
          SELECT 1 FROM pg_locks WHERE pid = ${pid}
            AND relation = ${`${schemaName}.usage_log`}::regclass AND NOT granted
        ) AS waiting`
        expect(waiting).toBe(true)
      })
      await writer`COMMIT`
      const [result] = await installing
      if (result.status === 'rejected') throw result.reason
    } finally {
      await writer`ROLLBACK`
      await installing
    }
    expect(await backfillUsageDailyCost(sql)).toBe(1)
    await installUsageCostProjection(sql)
    expect(await backfillUsageDailyCost(sql)).toBe(0)
    await assertExact()
  })

  it('handles concurrent cumulative updates and new IDs behind the backfill cursor', async () => {
    await seed(1_001)
    await installUsageCostProjection(sql)
    const [{ pid }] = await sql`SELECT pg_backend_pid() AS pid`
    await writer`BEGIN`
    await writer`UPDATE usage_log SET cost = 7.1234567890123456789 WHERE id = 'event-00001'`
    const backfilling = Promise.allSettled([backfillUsageDailyCost(sql)])
    try {
      await vi.waitFor(async () => {
        const [{ waiting }] = await admin`SELECT EXISTS (
          SELECT 1 FROM pg_locks WHERE pid = ${pid} AND NOT granted
        ) AS waiting`
        expect(waiting).toBe(true)
      })
      await writer`INSERT INTO usage_log (id, user_id, cost) VALUES ('before-cursor', 'actor', 0.9)`
      await writer`COMMIT`
      const [result] = await backfilling
      if (result.status === 'rejected') throw result.reason
      expect(result.value).toBe(1_000)
    } finally {
      await writer`ROLLBACK`
      await backfilling
    }
    expect(await backfillUsageDailyCost(sql)).toBe(0)
    await assertExact()
  })

  it('resumes after a failed page without double-counting committed pages', async () => {
    await seed(1_001)
    await installUsageCostProjection(sql)
    await sql.unsafe(`CREATE OR REPLACE FUNCTION interrupt_usage_backfill() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.id = 'event-00750' THEN RAISE EXCEPTION 'test interruption'; END IF;
        RETURN NEW;
      END; $$;
      CREATE TRIGGER interrupt_usage_backfill BEFORE UPDATE ON usage_log
      FOR EACH ROW EXECUTE FUNCTION interrupt_usage_backfill()`)
    await expect(backfillUsageDailyCost(sql)).rejects.toThrow('test interruption')
    expect(
      (await sql`SELECT count(*)::int AS count FROM usage_log WHERE cost_projected`)[0].count
    ).toBe(500)
    await sql`DROP TRIGGER interrupt_usage_backfill ON usage_log`
    expect(await backfillUsageDailyCost(sql)).toBe(501)
    expect(await backfillUsageDailyCost(sql)).toBe(0)
    await assertExact()
  })

  it('keeps concurrent actor deletion exact while a backfill waits on its rows', async () => {
    await seed(1_001)
    await installUsageCostProjection(sql)
    await sql`UPDATE usage_log SET cost = 0.4 WHERE id = 'event-00001'`
    const [{ pid }] = await sql`SELECT pg_backend_pid() AS pid`
    await writer`BEGIN`
    await writer`DELETE FROM actor WHERE id = 'actor'`
    const backfilling = Promise.allSettled([backfillUsageDailyCost(sql)])
    try {
      await vi.waitFor(async () => {
        const [{ waiting }] = await admin`SELECT EXISTS (
          SELECT 1 FROM pg_locks WHERE pid = ${pid} AND NOT granted
        ) AS waiting`
        expect(waiting).toBe(true)
      })
      await writer`COMMIT`
      const [result] = await backfilling
      if (result.status === 'rejected') throw result.reason
      expect(result.value).toBe(0)
    } finally {
      await writer`ROLLBACK`
      await backfilling
    }
    await assertExact()
  })

  it('excludes duplicate candidates and applies cumulative updates and transaction rollback', async () => {
    await installUsageCostProjection(sql)
    await sql`INSERT INTO usage_log (id, user_id, cost, event_key)
      VALUES ('first', 'actor', 0.1, 'request')`
    await sql`INSERT INTO usage_log (id, user_id, cost, event_key)
      VALUES ('discarded', 'actor', 5, 'request') ON CONFLICT (event_key) DO NOTHING`
    await sql`INSERT INTO usage_log (id, user_id, cost, event_key)
      VALUES ('top-up', 'actor', 0.3, 'request') ON CONFLICT (event_key)
      DO UPDATE SET cost = greatest(usage_log.cost, EXCLUDED.cost)`
    await sql`UPDATE usage_log SET metadata = '{"tokens": 7}'`
    await expect(
      sql.begin(async (tx) => {
        await tx`UPDATE usage_log SET cost = 100`
        await tx`INSERT INTO usage_log (id, user_id, cost) VALUES ('rolled-back', 'actor', 300)`
        throw new Error('rollback')
      })
    ).rejects.toThrow('rollback')
    expect((await sql`SELECT sum(cost)::text AS cost FROM usage_daily_cost`)[0].cost).toBe('0.3')
    await assertExact()
  })

  it('moves dimensions, preserves UTC wall dates, and subtracts FK cascades', async () => {
    await seed(3)
    await installUsageCostProjection(sql)
    await backfillUsageDailyCost(sql)
    await sql`SET TIME ZONE 'America/Los_Angeles'`
    await sql`UPDATE usage_log SET id = 'moved', user_id = 'other',
      source = 'workflow', billing_entity_id = 'new-payer', billing_period_start = '2026-08-14',
      billing_period_end = '2026-09-14', created_at = '2026-09-16 00:15:00', cost = 0.7
      WHERE id = 'event-00001'`
    expect(
      (await sql`SELECT usage_date::text AS day FROM usage_daily_cost WHERE cost = 0.7`)[0].day
    ).toBe('2026-09-16')
    await assertExact()
    await sql`DELETE FROM actor WHERE id = 'other'`
    await assertExact()
    await sql`TRUNCATE usage_log`
    expect(await sql`SELECT * FROM usage_daily_cost`).toEqual([])
  })

  it('handles unstamped rows becoming attributed and deletes before they are projected', async () => {
    await seed(2)
    await sql`INSERT INTO usage_log
      (id, user_id, cost, billing_entity_type, billing_entity_id, billing_period_start, billing_period_end)
      VALUES ('legacy', 'actor', 0.2, NULL, NULL, NULL, NULL)`
    await installUsageCostProjection(sql)
    await sql`DELETE FROM usage_log WHERE id = 'event-00001'`
    await backfillUsageDailyCost(sql)
    await assertExact()
    await sql`UPDATE usage_log SET billing_entity_type = 'organization', billing_entity_id = 'payer',
      billing_period_start = '2026-09-01', billing_period_end = '2026-10-01' WHERE id = 'legacy'`
    await assertExact()
    await sql`UPDATE usage_log SET billing_entity_type = NULL, billing_entity_id = NULL,
      billing_period_start = NULL, billing_period_end = NULL WHERE id = 'legacy'`
    await assertExact()
  })

  it('retains zero-cost ledger membership and removes buckets only after their last row', async () => {
    await installUsageCostProjection(sql)
    await sql`INSERT INTO usage_log (id, user_id, cost)
      VALUES ('unbilled', 'actor', 0), ('billed', 'other', 0.1)`
    expect(
      await sql`SELECT cost::text, entry_count::int FROM usage_daily_cost WHERE user_id = 'actor'`
    ).toEqual([{ cost: '0', entry_count: 1 }])
    await assertExact()
    await sql`DELETE FROM usage_log WHERE id = 'unbilled'`
    expect(await sql`SELECT * FROM usage_daily_cost WHERE user_id = 'actor'`).toEqual([])
    await assertExact()
  })

  it('repairs an interrupted concurrent search-index build and preserves valid builds', async () => {
    await sql`INSERT INTO embedding_search VALUES
      ('chunk-1', 'document', 'kb', true), ('chunk-2', 'document', 'kb', true)`
    await expect(
      sql.unsafe(
        'CREATE UNIQUE INDEX CONCURRENTLY embedding_search_document_lookup_idx ON embedding_search (document_id)'
      )
    ).rejects.toMatchObject({ code: '23505' })
    expect(
      (
        await sql`SELECT indisvalid FROM pg_index
        WHERE indexrelid = 'embedding_search_document_lookup_idx'::regclass`
      )[0].indisvalid
    ).toBe(false)
    await buildSearchDocumentLookupIndex(sql)
    const [built] =
      await sql`SELECT indexrelid, indisvalid, pg_get_indexdef(indexrelid) AS definition
      FROM pg_index WHERE indexrelid = 'embedding_search_document_lookup_idx'::regclass`
    expect(built.indisvalid).toBe(true)
    expect(built.definition).toContain('(document_id, knowledge_base_id, id) WHERE enabled')
    await buildSearchDocumentLookupIndex(sql)
    expect(
      (await sql`SELECT 'embedding_search_document_lookup_idx'::regclass::oid AS id`)[0].id
    ).toBe(built.indexrelid)
  })
})
