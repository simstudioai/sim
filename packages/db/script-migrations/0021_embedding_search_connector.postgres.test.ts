import {
  backfillProjectionSourceAcl,
  PROJECTION_SOURCE_ACL_TABLES,
  replaceProjectionSourceAclSync,
} from '@sim/db/script-migrations/0021_embedding_search_connector'
import { projectionSourceAclBackfillMigration as embeddingSearchConnectorMigration } from '@sim/db/script-migrations/0022_projection_source_acl_backfill'
import { projectionAclSkipUnfilledMigration } from '@sim/db/script-migrations/0023_projection_acl_skip_unfilled'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import postgres, { type Sql, type TransactionSql } from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const databaseUrl = process.env.KNOWLEDGE_ACL_TEST_DATABASE_URL

/**
 * The projections here carry only the columns the source and ACL triggers and backfill touch; the
 * vector and lexeme columns, and their indexes, are what make the backfill slow, not what decides
 * which rows it writes.
 */
describe.runIf(Boolean(databaseUrl))('projection source and ACL backfill in PostgreSQL', () => {
  let admin: Sql
  let sql: Sql
  const schemaName = `projection_acl_${generateId().replaceAll('-', '')}`

  const projected = (projection: 'embedding_search' | 'embedding_keyword_tin') =>
    sql<{ id: string; connector_id: string | null; acl: string[] | null }[]>`
      SELECT id, connector_id, acl FROM ${sql(projection)} ORDER BY id`

  beforeAll(async () => {
    const url = new URL(databaseUrl!)
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      !url.pathname.startsWith('/sim_acl_test')
    ) {
      throw new Error('Projection tests require a disposable local integration database')
    }
    admin = postgres(url.toString(), { max: 1, onnotice: () => undefined })
    await admin.unsafe(`CREATE SCHEMA "${schemaName}"`)
    sql = postgres(url.toString(), {
      max: 1,
      onnotice: () => undefined,
      connection: { search_path: schemaName },
    })
    await sql`CREATE TABLE document (
      id text PRIMARY KEY, connector_id text, acl text[] NOT NULL DEFAULT '{ws}'
    )`
    for (const projection of ['embedding_search', 'embedding_keyword_tin']) {
      await sql`CREATE TABLE ${sql(projection)} (
        id text PRIMARY KEY, document_id text NOT NULL, enabled boolean NOT NULL DEFAULT true,
        connector_id text, acl text[]
      )`
    }
    await embeddingSearchConnectorMigration.up(sql)
  }, 60_000)

  afterAll(async () => {
    await sql?.end()
    await admin?.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
    await admin?.end()
  })

  beforeEach(async () => {
    await sql`TRUNCATE embedding_search, embedding_keyword_tin, document`
    await sql`ALTER TABLE embedding_search DISABLE TRIGGER embedding_search_source_acl_set`
    await sql`ALTER TABLE embedding_keyword_tin DISABLE TRIGGER embedding_keyword_tin_source_acl_set`
  })

  it('installs its triggers and indexes again without failing, so a cut-short deploy completes', async () => {
    await expect(embeddingSearchConnectorMigration.up(sql)).resolves.toBeUndefined()
    const indexes = await sql<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE schemaname = ${schemaName} ORDER BY indexname`
    expect(indexes.map((row) => row.indexname)).toEqual(
      expect.arrayContaining([
        'embedding_keyword_tin_acl_gin_idx',
        'embedding_keyword_tin_acl_unfilled_idx',
        'embedding_search_acl_gin_idx',
        'embedding_search_acl_unfilled_idx',
        'embedding_search_source_idx',
      ])
    )
  })

  it('fills only the rows still unset, in pages, and leaves a chunk that changed documents to its trigger', async () => {
    await sql`INSERT INTO document (id, connector_id, acl) VALUES
      ('doc-a', 'src-a', ARRAY['u:alice']), ('doc-b', NULL, ARRAY['ws']), ('doc-c', 'src-c', ARRAY['u:carol'])`
    await sql`INSERT INTO embedding_search (id, document_id, connector_id, acl) VALUES
      ('c1', 'doc-a', NULL, NULL), ('c2', 'doc-b', NULL, NULL),
      ('c3', 'doc-c', 'src-old', ARRAY['u:stale']), ('c4', 'doc-a', NULL, NULL), ('c5', 'missing', NULL, NULL)`
    const progress = await backfillProjectionSourceAcl(sql, 'embedding_search', {
      pageSize: 2,
      pauseMs: 0,
    })
    expect(progress).toEqual({
      projection: 'embedding_search',
      scanned: 3,
      written: 3,
      afterId: 'c4',
      done: true,
    })
    expect(await projected('embedding_search')).toEqual([
      { id: 'c1', connector_id: 'src-a', acl: ['u:alice'] },
      { id: 'c2', connector_id: null, acl: ['ws'] },
      { id: 'c3', connector_id: 'src-old', acl: ['u:stale'] },
      { id: 'c4', connector_id: 'src-a', acl: ['u:alice'] },
      { id: 'c5', connector_id: null, acl: null },
    ])
    expect(await projected('embedding_keyword_tin')).toEqual([])
  })

  it('stops at its budget with the cursor to resume from, and resumes after it', async () => {
    await sql`INSERT INTO document (id, connector_id, acl) VALUES ('doc', 'src', ARRAY['u:alice'])`
    await sql`INSERT INTO embedding_keyword_tin (id, document_id) VALUES
      ('k1', 'doc'), ('k2', 'doc'), ('k3', 'doc')`
    const paused = await backfillProjectionSourceAcl(sql, 'embedding_keyword_tin', {
      pageSize: 1,
      pauseMs: 0,
      budgetMs: 0,
    })
    expect(paused).toMatchObject({ scanned: 1, written: 1, afterId: 'k1', done: false })
    const resumed = await backfillProjectionSourceAcl(sql, 'embedding_keyword_tin', {
      afterId: paused.afterId,
      pageSize: 1,
      pauseMs: 0,
    })
    expect(resumed).toMatchObject({ scanned: 2, written: 2, afterId: 'k3', done: true })
    expect((await projected('embedding_keyword_tin')).map((row) => row.acl)).toEqual([
      ['u:alice'],
      ['u:alice'],
      ['u:alice'],
    ])
    const again = await backfillProjectionSourceAcl(sql, 'embedding_keyword_tin', { pauseMs: 0 })
    expect(again).toMatchObject({ scanned: 0, written: 0, afterId: '', done: true })
  })
  describe('a document change on chunks the backfill has not filled', () => {
    /** A promise the test resolves by hand, to hold a transaction open at a chosen point. */
    const gate = () => {
      let resolve = () => {}
      const promise = new Promise<void>((done) => {
        resolve = done
      })
      return { promise, resolve }
    }

    /** Waits until `pid` is blocked on a lock, so the interleaving under test really happened. */
    const blockedOnLock = async (pid: number) => {
      for (let attempt = 0; attempt < 100; attempt++) {
        const [row] = await admin<{ waiting: boolean }[]>`
          SELECT wait_event_type = 'Lock' AS waiting FROM pg_stat_activity WHERE pid = ${pid}`
        if (row?.waiting) return true
        await sleep(20)
      }
      return false
    }

    /** The backfill's page statement, run in a transaction the test holds open. */
    const backfillPage = (tx: TransactionSql) =>
      tx.unsafe(`WITH page AS (
        SELECT s.id, s.document_id, d.connector_id, d.acl
        FROM embedding_search s JOIN document d ON d.id = s.document_id
        WHERE s.acl IS NULL ORDER BY s.id LIMIT 100
        FOR SHARE OF d
      )
      UPDATE embedding_search s SET connector_id = page.connector_id, acl = page.acl
      FROM page WHERE s.id = page.id AND s.document_id = page.document_id AND s.acl IS NULL`)

    let other: Sql
    beforeAll(() => {
      other = postgres(databaseUrl!, {
        max: 1,
        onnotice: () => undefined,
        connection: { search_path: schemaName },
      })
    })
    afterAll(async () => {
      await other?.end()
    })

    beforeEach(async () => {
      /** A test below installs an older body; each starts from the current one. */
      await replaceProjectionSourceAclSync(sql)
      await sql`INSERT INTO document (id, connector_id, acl) VALUES ('doc', 'src', ARRAY['u:alice'])`
      for (const projection of PROJECTION_SOURCE_ACL_TABLES) {
        await sql`INSERT INTO ${sql(projection)} (id, document_id, connector_id, acl) VALUES
          ('filled', 'doc', 'src', ARRAY['u:alice']), ('unfilled', 'doc', NULL, NULL),
          ('unfilled-sourced', 'doc', 'src', NULL)`
      }
    })

    it('replaces the body a database already has when its own migration runs', async () => {
      /** The body `0022` installed before this change. */
      await sql.unsafe(`CREATE OR REPLACE FUNCTION sync_projection_source_acl()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          UPDATE embedding_search SET connector_id = NEW.connector_id, acl = NEW.acl
          WHERE document_id = NEW.id AND enabled
            AND (connector_id IS DISTINCT FROM NEW.connector_id OR acl IS DISTINCT FROM NEW.acl);
          UPDATE embedding_keyword_tin SET connector_id = NEW.connector_id, acl = NEW.acl
          WHERE document_id = NEW.id AND enabled
            AND (connector_id IS DISTINCT FROM NEW.connector_id OR acl IS DISTINCT FROM NEW.acl);
          RETURN NEW;
        END;
        $$`)
      await sql`UPDATE document SET acl = ARRAY['u:carol'] WHERE id = 'doc'`
      expect((await projected('embedding_search')).map((row) => row.acl)).toEqual([
        ['u:carol'],
        ['u:carol'],
        ['u:carol'],
      ])
      await sql`UPDATE embedding_search SET acl = NULL WHERE id LIKE 'unfilled%'`

      await projectionAclSkipUnfilledMigration.up(sql)
      await sql`UPDATE document SET acl = ARRAY['u:bob'] WHERE id = 'doc'`
      expect((await projected('embedding_search')).map((row) => row.acl)).toEqual([
        ['u:bob'],
        null,
        null,
      ])
    })

    it('writes a changed ACL onto filled chunks only, leaving unfilled ones to their document', async () => {
      await sql`UPDATE document SET acl = ARRAY['u:bob'] WHERE id = 'doc'`
      for (const projection of PROJECTION_SOURCE_ACL_TABLES) {
        expect(await projected(projection)).toEqual([
          { id: 'filled', connector_id: 'src', acl: ['u:bob'] },
          { id: 'unfilled', connector_id: null, acl: null },
          { id: 'unfilled-sourced', connector_id: 'src', acl: null },
        ])
      }
    })

    it('still carries a changed source onto unfilled chunks, whose source filters read the row', async () => {
      await sql`UPDATE document SET connector_id = 'moved' WHERE id = 'doc'`
      for (const projection of PROJECTION_SOURCE_ACL_TABLES) {
        expect(await projected(projection)).toEqual([
          { id: 'filled', connector_id: 'moved', acl: ['u:alice'] },
          { id: 'unfilled', connector_id: 'moved', acl: null },
          { id: 'unfilled-sourced', connector_id: 'moved', acl: null },
        ])
      }
    })

    it('fills the current ACL when the change commits before the backfill reads the document', async () => {
      await sql`UPDATE document SET acl = ARRAY['u:bob'] WHERE id = 'doc'`
      await backfillProjectionSourceAcl(sql, 'embedding_search', { pauseMs: 0 })
      expect((await projected('embedding_search')).map((row) => row.acl)).toEqual([
        ['u:bob'],
        ['u:bob'],
        ['u:bob'],
      ])
    })

    it('fans the change out after a backfill page that read the old ACL commits', async () => {
      const [pageRead, release] = [gate(), gate()]
      const page = sql.begin(async (tx) => {
        await backfillPage(tx)
        pageRead.resolve()
        await release.promise
      })
      await pageRead.promise
      const [{ pid }] = await other<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`
      /** Blocks on the page's share lock on the document until the page commits. */
      const change = other`UPDATE document SET acl = ARRAY['u:bob'] WHERE id = 'doc'`.execute()
      expect(await blockedOnLock(pid)).toBe(true)
      release.resolve()
      await page
      await change
      expect((await projected('embedding_search')).map((row) => row.acl)).toEqual([
        ['u:bob'],
        ['u:bob'],
        ['u:bob'],
      ])
    })

    it('fills the new ACL when the backfill waits on a change that has not committed yet', async () => {
      const [changed, commit] = [gate(), gate()]
      const change = other.begin(async (tx) => {
        await tx`UPDATE document SET acl = ARRAY['u:bob'] WHERE id = 'doc'`
        changed.resolve()
        await commit.promise
      })
      await changed.promise
      const [{ pid }] = await sql<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`
      const fill = backfillProjectionSourceAcl(sql, 'embedding_search', { pauseMs: 0 })
      expect(await blockedOnLock(pid)).toBe(true)
      commit.resolve()
      await change
      await fill
      expect((await projected('embedding_search')).map((row) => row.acl)).toEqual([
        ['u:bob'],
        ['u:bob'],
        ['u:bob'],
      ])
    })
  })
})
