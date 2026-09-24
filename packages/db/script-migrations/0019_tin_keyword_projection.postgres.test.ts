import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  backfillProjection,
  installProjection,
} from '@sim/db/script-migrations/0019_tin_keyword_projection'
import { generateId } from '@sim/utils/id'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const databaseUrl = process.env.KNOWLEDGE_ACL_TEST_DATABASE_URL
const MIGRATIONS = path.join(__dirname, '../migrations')

/** Resolves once backend `pid` waits on a lock, so each race runs in a fixed order. */
async function waitUntilBlocked(observer: Sql, pid: number): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const [row] = await observer`SELECT wait_event_type FROM pg_stat_activity WHERE pid = ${pid}`
    if (row?.wait_event_type === 'Lock') return
    await observer`SELECT pg_sleep(0.01)`
  }
  throw new Error(`Backend ${pid} never waited on a lock`)
}

/**
 * The Tin extension is not available here, but the projection's functions and triggers are plain
 * SQL, so membership and its races are exercised without the index.
 */
describe.runIf(Boolean(databaseUrl))('Tin keyword projection in PostgreSQL', () => {
  let admin: Sql
  let sql: Sql
  let promoter: Sql
  const schemaName = `tin_projection_${generateId().replaceAll('-', '')}`

  const projected = () =>
    sql<{ id: string; enabled: boolean; content: string }[]>`
      SELECT id, enabled, content FROM embedding_keyword_tin ORDER BY id`

  beforeAll(async () => {
    const url = new URL(databaseUrl!)
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      (!url.pathname.startsWith('/sim_acl_test') && url.pathname !== '/sim_auth_scim')
    ) {
      throw new Error('Projection tests require a disposable local integration database')
    }
    admin = postgres(url.toString(), { max: 1, onnotice: () => undefined })
    await admin.unsafe(`CREATE SCHEMA "${schemaName}"`)
    const connect = () =>
      postgres(url.toString(), {
        max: 1,
        onnotice: () => undefined,
        connection: { search_path: schemaName },
      })
    sql = connect()
    promoter = connect()
    await sql`CREATE TABLE knowledge_base (
      id text PRIMARY KEY, is_search_index boolean NOT NULL DEFAULT false, updated_at timestamp
    )`
    await sql`CREATE TABLE embedding (
      id text PRIMARY KEY, knowledge_base_id text NOT NULL REFERENCES knowledge_base(id),
      document_id text NOT NULL, enabled boolean NOT NULL DEFAULT true, content text,
      content_tsv tsvector NOT NULL
    )`
    await sql`CREATE INDEX ON embedding (knowledge_base_id)`
    /** The shipped table, with its foreign key pointed at this schema's `embedding`. */
    const [createTable] = readFileSync(
      path.join(MIGRATIONS, '0367_tin_keyword_projection.sql'),
      'utf8'
    ).split('--> statement-breakpoint')
    await sql.unsafe(createTable)
    await sql.unsafe(
      'ALTER TABLE embedding_keyword_tin ADD FOREIGN KEY (id) REFERENCES embedding(id) ON DELETE CASCADE'
    )
    await installProjection(sql)
  }, 60_000)

  afterAll(async () => {
    await sql?.end()
    await promoter?.end()
    await admin?.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
    await admin?.end()
  })

  beforeEach(async () => {
    await sql`TRUNCATE embedding_keyword_tin, embedding, knowledge_base`
    await sql`INSERT INTO knowledge_base (id, is_search_index) VALUES ('legacy', false), ('index', true)`
  })

  it('runs standalone when CI leaves the optional migration URL empty', () => {
    const result = spawnSync('bun', [path.join(__dirname, '0019_tin_keyword_projection.ts')], {
      env: { ...process.env, MIGRATION_DATABASE_URL: '', DATABASE_URL: databaseUrl },
      encoding: 'utf8',
      timeout: 30_000,
    })
    expect(result.error).toBeUndefined()
    expect(result.status, result.stdout + result.stderr).toBe(0)
  })

  it('projects only chunks of search indexes, as their lexemes in position order', async () => {
    await sql`INSERT INTO embedding (id, knowledge_base_id, document_id, content_tsv) VALUES
      ('in-index', 'index', 'doc', to_tsvector('english', 'Release notes for release')),
      ('in-legacy', 'legacy', 'doc', to_tsvector('english', 'Release notes'))`
    const rows = await projected()
    expect(rows.map((row) => row.id)).toEqual(['in-index'])
    expect(rows[0].content).toMatch(/^zkb[0-9a-f]{32} releas note releas$/)
  })

  it('projects a legacy base when it is adopted as a search index, and removes it when it is not', async () => {
    await sql`INSERT INTO embedding (id, knowledge_base_id, document_id, enabled, content_tsv) VALUES
      ('legacy-1', 'legacy', 'doc', true, to_tsvector('english', 'Quarterly planning')),
      ('legacy-2', 'legacy', 'doc', false, to_tsvector('english', 'Draft agenda'))`
    expect(await projected()).toEqual([])

    await sql`UPDATE knowledge_base SET is_search_index = true WHERE id = 'legacy'`
    expect(await projected()).toMatchObject([
      { id: 'legacy-1', enabled: true },
      { id: 'legacy-2', enabled: false },
    ])

    await sql`UPDATE knowledge_base SET updated_at = now() WHERE id = 'legacy'`
    expect(await projected()).toHaveLength(2)

    await sql`UPDATE knowledge_base SET is_search_index = false WHERE id = 'legacy'`
    expect(await projected()).toEqual([])
  })

  it('projects a chunk inserted while the base is being adopted', async () => {
    let inserted!: () => void
    const insertedSignal = new Promise<void>((resolve) => {
      inserted = resolve
    })
    let release!: () => void
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    const writer = sql.begin(async (tx) => {
      await tx`INSERT INTO embedding (id, knowledge_base_id, document_id, content_tsv)
        VALUES ('racing', 'legacy', 'doc', to_tsvector('english', 'Racing chunk'))`
      inserted()
      await released
    })
    await insertedSignal
    const [{ pid }] = await promoter`SELECT pg_backend_pid() AS pid`
    const promotion =
      promoter`UPDATE knowledge_base SET is_search_index = true WHERE id = 'legacy'`.execute()
    await waitUntilBlocked(admin, pid)
    release()
    await writer
    await promotion
    expect((await projected()).map((row) => row.id)).toEqual(['racing'])
  })

  it('keeps a chunk update that races the adoption of its base', async () => {
    await sql`INSERT INTO embedding (id, knowledge_base_id, document_id, content_tsv)
      VALUES ('toggled', 'legacy', 'doc', to_tsvector('english', 'Toggled chunk'))`
    let promoted!: () => void
    const promotedSignal = new Promise<void>((resolve) => {
      promoted = resolve
    })
    let release!: () => void
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    const promotion = promoter.begin(async (tx) => {
      await tx`UPDATE knowledge_base SET is_search_index = true WHERE id = 'legacy'`
      promoted()
      await released
    })
    await promotedSignal
    const [{ pid }] = await sql`SELECT pg_backend_pid() AS pid`
    const update = sql`UPDATE embedding SET enabled = false WHERE id = 'toggled'`.execute()
    await waitUntilBlocked(admin, pid)
    release()
    await promotion
    await update
    expect(await projected()).toMatchObject([{ id: 'toggled', enabled: false }])
  })
  it('removes a base through the chunk index instead of scanning the projection', async () => {
    await sql`INSERT INTO embedding (id, knowledge_base_id, document_id, content_tsv)
      SELECT 'index-' || n, 'index', 'doc', to_tsvector('english', 'Chunk ' || n)
      FROM generate_series(1, 20) n`
    /** Pending per-backend counts include earlier statements, so compare before and after. */
    const scans = await sql.begin(async (tx) => {
      const read = async () => {
        const [row] = await tx<Array<{ scans: number }>>`
          SELECT seq_scan::int AS scans FROM pg_stat_xact_user_tables
          WHERE relid = 'embedding_keyword_tin'::regclass`
        return row.scans
      }
      await tx`SET LOCAL enable_seqscan = off`
      const before = await read()
      await tx`UPDATE knowledge_base SET is_search_index = false WHERE id = 'index'`
      return (await read()) - before
    })
    expect(scans).toBe(0)
    expect(await projected()).toEqual([])
  })

  it('does not backfill a chunk whose base stops being a search index mid-page', async () => {
    await sql`INSERT INTO embedding (id, knowledge_base_id, document_id, content_tsv)
      VALUES ('unprojected', 'index', 'doc', to_tsvector('english', 'Predates the trigger'))`
    await sql`DELETE FROM embedding_keyword_tin`
    let demoted!: () => void
    const demotedSignal = new Promise<void>((resolve) => {
      demoted = resolve
    })
    let release!: () => void
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    const demotion = promoter.begin(async (tx) => {
      await tx`UPDATE knowledge_base SET is_search_index = false WHERE id = 'index'`
      demoted()
      await released
    })
    await demotedSignal
    const [{ pid }] = await sql`SELECT pg_backend_pid() AS pid`
    const backfill = backfillProjection(sql)
    await waitUntilBlocked(admin, pid)
    release()
    await demotion
    expect(await backfill).toBe(0)
    expect(await projected()).toEqual([])
  })
})
