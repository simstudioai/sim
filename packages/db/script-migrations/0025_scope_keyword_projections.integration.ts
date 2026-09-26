import { backfillSearchKeywords } from '@sim/db/script-migrations/0016_backfill_search_vectors'
import { installProjection } from '@sim/db/script-migrations/0019_tin_keyword_projection'
import { installProjectionSourceAcl } from '@sim/db/script-migrations/0021_embedding_search_connector'
import { installKnowledgeProjectionAsync } from '@sim/db/script-migrations/0024_knowledge_projection_async'
import { scopeKeywordProjections } from '@sim/db/script-migrations/0025_scope_keyword_projections'
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { generateId } from '@sim/utils/id'
import postgres, { type Sql, type TransactionSql } from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const databaseUrl = readTestDatabaseUrl()

/** Resolves once backend `pid` waits on a lock, so each race runs in a fixed order. */
async function waitUntilBlocked(observer: Sql, pid: number): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const [row] = await observer`SELECT wait_event_type FROM pg_stat_activity WHERE pid = ${pid}`
    if (row?.wait_event_type === 'Lock') return
    await observer`SELECT pg_sleep(0.01)`
  }
  throw new Error(`Backend ${pid} never waited on a lock`)
}

/** Scans this transaction has run on `tables`, sequential and index alike. */
async function scansOf(tx: TransactionSql, tables: readonly string[]): Promise<number> {
  const [row] = await tx<Array<{ scans: number }>>`
    SELECT coalesce(sum(seq_scan + coalesce(idx_scan, 0)), 0)::int AS scans
    FROM pg_stat_xact_user_tables WHERE relid = ANY(${tables as string[]}::regclass[])`
  return row.scans
}

/**
 * The tables carry only the columns the triggers read and write. The Tin extension is not
 * available here, but its triggers are plain SQL, so each projection is installed as the
 * migrations before `0025` leave it and then scoped.
 */
describe('keyword projections scoped to search indexes in PostgreSQL', () => {
  let admin: Sql
  let sql: Sql
  let other: Sql
  const schemaName = `keyword_scope_${generateId().replaceAll('-', '')}`

  const keywordIds = () =>
    sql<{ id: string }[]>`SELECT id FROM embedding_keyword_search ORDER BY id`.then((rows) =>
      rows.map((row) => row.id)
    )
  const tinIds = () =>
    sql<{ id: string }[]>`SELECT id FROM embedding_keyword_tin ORDER BY id`.then((rows) =>
      rows.map((row) => row.id)
    )

  beforeAll(async () => {
    admin = postgres(databaseUrl, { max: 1, onnotice: () => undefined })
    await admin.unsafe(`CREATE SCHEMA "${schemaName}"`)
    const connect = () =>
      postgres(databaseUrl, {
        max: 1,
        onnotice: () => undefined,
        connection: { search_path: schemaName },
      })
    sql = connect()
    other = connect()
    await sql`CREATE TABLE knowledge_base (
      id text PRIMARY KEY, is_search_index boolean NOT NULL DEFAULT false
    )`
    await sql`CREATE TABLE document (
      id text PRIMARY KEY, connector_id text, acl text[] NOT NULL DEFAULT '{ws}'
    )`
    await sql`CREATE TABLE knowledge_projection_dirty (
      document_id text PRIMARY KEY REFERENCES document (id) ON DELETE CASCADE,
      generation bigint NOT NULL DEFAULT 1, content boolean NOT NULL DEFAULT false,
      marked_at timestamptz NOT NULL DEFAULT now()
    )`
    await sql`CREATE TABLE embedding (
      id text PRIMARY KEY, knowledge_base_id text NOT NULL REFERENCES knowledge_base (id),
      document_id text NOT NULL REFERENCES document (id), enabled boolean NOT NULL DEFAULT true,
      content text, content_tsv tsvector NOT NULL, embedding text, embedding_384 text,
      embedding_768 text, embedding_1024 text, embedding_3072 text
    )`
    await sql`CREATE INDEX ON embedding (knowledge_base_id)`
    await sql`CREATE TABLE embedding_search (
      id text PRIMARY KEY REFERENCES embedding (id) ON DELETE CASCADE, document_id text NOT NULL,
      enabled boolean NOT NULL DEFAULT true, connector_id text, acl text[]
    )`
    await sql`CREATE TABLE embedding_keyword_search (
      id text PRIMARY KEY REFERENCES embedding (id) ON DELETE CASCADE,
      knowledge_base_id text NOT NULL, document_id text NOT NULL, enabled boolean NOT NULL,
      content_tsv tsvector NOT NULL
    )`
    await sql`CREATE INDEX ON embedding_keyword_search (knowledge_base_id)`
    await sql`CREATE TABLE embedding_keyword_tin (
      id text PRIMARY KEY REFERENCES embedding (id) ON DELETE CASCADE,
      knowledge_base_id text NOT NULL, document_id text NOT NULL, enabled boolean NOT NULL,
      content text NOT NULL, connector_id text, acl text[]
    )`
    await sql.unsafe(`CREATE FUNCTION sync_embedding_search() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RETURN NULL; END; $$`)
    await backfillSearchKeywords(sql)
    await installProjection(sql)
    await installProjectionSourceAcl(sql)
    await installKnowledgeProjectionAsync(sql)
    await scopeKeywordProjections(sql)
  }, 60_000)

  afterAll(async () => {
    await sql?.end()
    await other?.end()
    await admin?.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
    await admin?.end()
  })

  beforeEach(async () => {
    await sql`TRUNCATE embedding_keyword_search, embedding_keyword_tin, embedding_search,
      knowledge_projection_dirty, embedding, document, knowledge_base`
    await sql`INSERT INTO knowledge_base (id, is_search_index) VALUES ('legacy', false), ('index', true)`
    await sql`INSERT INTO document (id) VALUES ('doc')`
  })

  it('projects keyword rows only for chunks of search indexes', async () => {
    await sql`INSERT INTO embedding (id, knowledge_base_id, document_id, content_tsv) VALUES
      ('in-index', 'index', 'doc', to_tsvector('english', 'Release notes')),
      ('in-legacy', 'legacy', 'doc', to_tsvector('english', 'Release notes'))`
    expect(await keywordIds()).toEqual(['in-index'])
    expect(await tinIds()).toEqual(['in-index'])
  })

  it('never reads the Tin projection for a chunk inserted outside a search index', async () => {
    const scans = await sql.begin(async (tx) => {
      const before = await scansOf(tx, ['embedding_keyword_tin'])
      await tx`INSERT INTO embedding (id, knowledge_base_id, document_id, content_tsv)
        VALUES ('in-legacy', 'legacy', 'doc', to_tsvector('english', 'Release notes'))`
      return (await scansOf(tx, ['embedding_keyword_tin'])) - before
    })
    expect(scans).toBe(0)
  })

  it('removes the keyword rows of a chunk that moves out of a search index', async () => {
    await sql`INSERT INTO embedding (id, knowledge_base_id, document_id, content_tsv)
      VALUES ('moving', 'index', 'doc', to_tsvector('english', 'Moving chunk'))`
    await sql`UPDATE embedding SET knowledge_base_id = 'legacy' WHERE id = 'moving'`
    expect(await keywordIds()).toEqual([])
    expect(await tinIds()).toEqual([])
  })

  it('keeps the scoped and guarded Tin trigger when Tin is adopted after this migration', async () => {
    await installProjection(sql)
    const [trigger] = await sql<{ definition: string }[]>`
      SELECT pg_get_triggerdef(oid) AS definition FROM pg_trigger
      WHERE tgname = 'embedding_keyword_tin_sync' AND tgrelid = 'embedding'::regclass`
    expect(trigger?.definition).toContain('sim.projection_mode')
    const scans = await sql.begin(async (tx) => {
      const before = await scansOf(tx, ['embedding_keyword_tin'])
      await tx`INSERT INTO embedding (id, knowledge_base_id, document_id, content_tsv)
        VALUES ('in-legacy', 'legacy', 'doc', to_tsvector('english', 'Release notes'))`
      return (await scansOf(tx, ['embedding_keyword_tin'])) - before
    })
    expect(scans).toBe(0)
  })

  it('projects a base adopted as a search index, and removes it when it is not', async () => {
    await sql`INSERT INTO embedding (id, knowledge_base_id, document_id, enabled, content_tsv) VALUES
      ('legacy-1', 'legacy', 'doc', true, to_tsvector('english', 'Quarterly planning')),
      ('legacy-2', 'legacy', 'doc', false, to_tsvector('english', 'Draft agenda'))`
    await sql`UPDATE knowledge_base SET is_search_index = true WHERE id = 'legacy'`
    expect(await sql`SELECT id, enabled FROM embedding_keyword_search ORDER BY id`).toMatchObject([
      { id: 'legacy-1', enabled: true },
      { id: 'legacy-2', enabled: false },
    ])
    await sql`UPDATE knowledge_base SET is_search_index = false WHERE id = 'legacy'`
    expect(await keywordIds()).toEqual([])
  })

  it('leaves a current keyword row unwritten when its base is adopted', async () => {
    await sql`INSERT INTO embedding (id, knowledge_base_id, document_id, content_tsv)
      VALUES ('kept', 'legacy', 'doc', to_tsvector('english', 'Kept chunk'))`
    /** A row written before the projection was scoped, already current. */
    await sql`INSERT INTO embedding_keyword_search (id, knowledge_base_id, document_id, enabled, content_tsv)
      SELECT id, knowledge_base_id, document_id, enabled, content_tsv FROM embedding WHERE id = 'kept'`
    const updated = await sql.begin(async (tx) => {
      const read = async () => {
        const [row] = await tx<Array<{ updated: number }>>`
          SELECT n_tup_upd::int AS updated FROM pg_stat_xact_user_tables
          WHERE relid = 'embedding_keyword_search'::regclass`
        return row.updated
      }
      const before = await read()
      await tx`UPDATE knowledge_base SET is_search_index = true WHERE id = 'legacy'`
      return (await read()) - before
    })
    expect(updated).toBe(0)
    expect(await keywordIds()).toEqual(['kept'])
  })

  it('projects a chunk whose insert commits while its base is being adopted', async () => {
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
    const [{ pid }] = await other`SELECT pg_backend_pid() AS pid`
    const adoption =
      other`UPDATE knowledge_base SET is_search_index = true WHERE id = 'legacy'`.execute()
    await waitUntilBlocked(admin, pid)
    release()
    await writer
    await adoption
    expect(await keywordIds()).toEqual(['racing'])
  })

  it('projects a chunk inserted while the adoption of its base is uncommitted', async () => {
    let adopted!: () => void
    const adoptedSignal = new Promise<void>((resolve) => {
      adopted = resolve
    })
    let release!: () => void
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    const adoption = other.begin(async (tx) => {
      await tx`UPDATE knowledge_base SET is_search_index = true WHERE id = 'legacy'`
      adopted()
      await released
    })
    await adoptedSignal
    const [{ pid }] = await sql`SELECT pg_backend_pid() AS pid`
    const insert = sql`INSERT INTO embedding (id, knowledge_base_id, document_id, content_tsv)
      VALUES ('waiting', 'legacy', 'doc', to_tsvector('english', 'Waiting chunk'))`.execute()
    await waitUntilBlocked(admin, pid)
    release()
    await adoption
    await insert
    expect(await keywordIds()).toEqual(['waiting'])
  })

  /**
   * Adopts `legacy` while a second connection holds a delete of one of its chunks open, and resolves
   * once both have committed.
   */
  async function adoptWhileDeleting(): Promise<void> {
    await sql`INSERT INTO embedding (id, knowledge_base_id, document_id, content_tsv) VALUES
      ('kept', 'legacy', 'doc', to_tsvector('english', 'Kept chunk')),
      ('deleted', 'legacy', 'doc', to_tsvector('english', 'Deleted chunk'))`
    let deleted!: () => void
    const deletedSignal = new Promise<void>((resolve) => {
      deleted = resolve
    })
    let release!: () => void
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    const deleter = sql.begin(async (tx) => {
      await tx`DELETE FROM embedding WHERE id = 'deleted'`
      deleted()
      await released
    })
    await deletedSignal
    const [{ pid }] = await other`SELECT pg_backend_pid() AS pid`
    const adoption =
      other`UPDATE knowledge_base SET is_search_index = true WHERE id = 'legacy'`.execute()
    await waitUntilBlocked(admin, pid)
    release()
    await deleter
    await adoption
  }

  it('adopts a base while one of its chunks is being deleted', async () => {
    await adoptWhileDeleting()
    expect(await keywordIds()).toEqual(['kept'])
    expect(await tinIds()).toEqual(['kept'])
  })

  it('adopts a base into Tin while a chunk is being deleted, with no keyword trigger ahead of it', async () => {
    await sql`ALTER TABLE knowledge_base DISABLE TRIGGER knowledge_base_keyword_search_sync`
    try {
      await adoptWhileDeleting()
    } finally {
      await sql`ALTER TABLE knowledge_base ENABLE TRIGGER knowledge_base_keyword_search_sync`
    }
    expect(await tinIds()).toEqual(['kept'])
  })

  it('runs no fan-out for an inserted document, and still fans out a changed ACL', async () => {
    const projections = ['embedding_search', 'embedding_keyword_tin'] as const
    const scans = await sql.begin(async (tx) => {
      const before = await scansOf(tx, projections)
      await tx`INSERT INTO document (id, connector_id, acl) VALUES ('new', 'src', ARRAY['u:alice'])`
      return (await scansOf(tx, projections)) - before
    })
    expect(scans).toBe(0)

    await sql`INSERT INTO embedding (id, knowledge_base_id, document_id, content_tsv)
      VALUES ('chunk', 'index', 'new', to_tsvector('english', 'Shared chunk'))`
    await sql`INSERT INTO embedding_search (id, document_id) VALUES ('chunk', 'new')`
    await sql`UPDATE document SET acl = ARRAY['u:bob'] WHERE id = 'new'`
    for (const projection of projections) {
      expect(await sql`SELECT acl FROM ${sql(projection)} WHERE id = 'chunk'`).toEqual([
        { acl: ['u:bob'] },
      ])
    }
  })
})
