import { PROJECTION_SOURCE_ACL_TABLES } from '@sim/db/script-migrations/0021_embedding_search_connector'
import { projectionSourceAclBackfillMigration as embeddingSearchConnectorMigration } from '@sim/db/script-migrations/0022_projection_source_acl_backfill'
import { projectionAclSkipUnfilledMigration } from '@sim/db/script-migrations/0023_projection_acl_skip_unfilled'
import { installKnowledgeProjectionMarking } from '@sim/db/script-migrations/0024_knowledge_projection_async'
import { generateId } from '@sim/utils/id'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const databaseUrl = process.env.KNOWLEDGE_ACL_TEST_DATABASE_URL

/**
 * The projections here carry only the columns the source and ACL triggers touch; the vector and
 * lexeme columns, and their indexes, are what make a projection write slow, not what decides
 * which rows the triggers write or which documents they mark.
 */
describe.runIf(Boolean(databaseUrl))('projection source and ACL triggers in PostgreSQL', () => {
  let admin: Sql
  let sql: Sql
  const schemaName = `projection_acl_${generateId().replaceAll('-', '')}`

  const projected = (projection: 'embedding_search' | 'embedding_keyword_tin') =>
    sql<{ id: string; connector_id: string | null; acl: string[] | null }[]>`
      SELECT id, connector_id, acl FROM ${sql(projection)} ORDER BY id`

  const marks = () =>
    sql<{ document_id: string; generation: string; content: boolean }[]>`
      SELECT document_id, generation, content FROM knowledge_projection_dirty ORDER BY document_id`

  /** Runs `write` in a transaction that declared the asynchronous projection mode. */
  const asynchronously = (write: (tx: postgres.TransactionSql) => Promise<unknown>) =>
    sql.begin(async (tx) => {
      await tx`SELECT set_config('sim.projection_mode', 'async', true)`
      await write(tx)
    })

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
    await sql`CREATE TABLE knowledge_projection_dirty (
      document_id text PRIMARY KEY REFERENCES document (id) ON DELETE CASCADE,
      generation bigint NOT NULL DEFAULT 1, content boolean NOT NULL DEFAULT false,
      marked_at timestamptz NOT NULL DEFAULT now()
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
    await sql`TRUNCATE embedding_search, embedding_keyword_tin, knowledge_projection_dirty, document`
    await sql`ALTER TABLE embedding_search DISABLE TRIGGER embedding_search_source_acl_set`
    await sql`ALTER TABLE embedding_keyword_tin DISABLE TRIGGER embedding_keyword_tin_source_acl_set`
  })

  it('runs every migration up to 0023, and every write between them, before 0024 exists', async () => {
    /** A database that has run `0023` and not yet `0024`: no mark function exists. */
    await sql`DROP FUNCTION IF EXISTS mark_knowledge_projection(text[], boolean)`
    await embeddingSearchConnectorMigration.up(sql)
    await projectionAclSkipUnfilledMigration.up(sql)
    const [before] = await sql<{ installed: boolean }[]>`
      SELECT to_regprocedure('mark_knowledge_projection(text[], boolean)') IS NOT NULL AS installed`
    expect(before?.installed).toBe(false)
    await sql`INSERT INTO document (id, connector_id, acl) VALUES ('doc', 'src', ARRAY['u:alice'])`
    await sql`INSERT INTO embedding_search (id, document_id, connector_id, acl)
      VALUES ('filled', 'doc', 'src', ARRAY['u:alice'])`

    await sql`UPDATE document SET acl = ARRAY['u:bob'] WHERE id = 'doc'`
    expect(await projected('embedding_search')).toEqual([
      { id: 'filled', connector_id: 'src', acl: ['u:bob'] },
    ])
    expect(await marks()).toEqual([])

    await installKnowledgeProjectionMarking(sql)
    await sql`UPDATE document SET acl = ARRAY['u:carol'] WHERE id = 'doc'`
    expect((await projected('embedding_search'))[0]?.acl).toEqual(['u:carol'])
    expect(await marks()).toEqual([{ document_id: 'doc', generation: '1', content: false }])
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

  describe('a document change', () => {
    beforeEach(async () => {
      /** Tests here install older bodies; each starts from the one `0024` installs. */
      await installKnowledgeProjectionMarking(sql)
      await sql`INSERT INTO document (id, connector_id, acl) VALUES ('doc', 'src', ARRAY['u:alice'])`
      for (const projection of PROJECTION_SOURCE_ACL_TABLES) {
        await sql`INSERT INTO ${sql(projection)} (id, document_id, connector_id, acl) VALUES
          ('filled', 'doc', 'src', ARRAY['u:alice']), ('unfilled', 'doc', NULL, NULL),
          ('unfilled-sourced', 'doc', 'src', NULL)`
      }
    })

    it('replaces the body a database already has when its own migration runs', async () => {
      /** The body `0022` installed before `0023`. */
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

    it('writes a changed ACL onto filled chunks only and marks the document', async () => {
      await sql`UPDATE document SET acl = ARRAY['u:bob'] WHERE id = 'doc'`
      for (const projection of PROJECTION_SOURCE_ACL_TABLES) {
        expect(await projected(projection)).toEqual([
          { id: 'filled', connector_id: 'src', acl: ['u:bob'] },
          { id: 'unfilled', connector_id: null, acl: null },
          { id: 'unfilled-sourced', connector_id: 'src', acl: null },
        ])
      }
      expect(await marks()).toEqual([{ document_id: 'doc', generation: '1', content: false }])
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
      expect(await marks()).toEqual([{ document_id: 'doc', generation: '1', content: false }])
    })

    it('leaves every row to the projector in the asynchronous mode, and only marks the document', async () => {
      await asynchronously((tx) => tx`UPDATE document SET acl = ARRAY['u:bob'] WHERE id = 'doc'`)
      await asynchronously((tx) => tx`UPDATE document SET connector_id = 'moved' WHERE id = 'doc'`)
      for (const projection of PROJECTION_SOURCE_ACL_TABLES) {
        expect(await projected(projection)).toEqual([
          { id: 'filled', connector_id: 'src', acl: ['u:alice'] },
          { id: 'unfilled', connector_id: null, acl: null },
          { id: 'unfilled-sourced', connector_id: 'src', acl: null },
        ])
      }
      expect(await marks()).toEqual([{ document_id: 'doc', generation: '2', content: false }])
    })

    it('marks nothing when an assignment leaves the source and ACL as they were', async () => {
      await sql`UPDATE document SET acl = ARRAY['u:alice'], connector_id = 'src' WHERE id = 'doc'`
      expect(await marks()).toEqual([])
    })

    it('keeps the synchronous fan-out for a transaction that set another mode', async () => {
      await sql.begin(async (tx) => {
        await tx`SELECT set_config('sim.projection_mode', 'sync', true)`
        await tx`UPDATE document SET acl = ARRAY['u:bob'] WHERE id = 'doc'`
      })
      expect((await projected('embedding_search'))[0]?.acl).toEqual(['u:bob'])
    })
  })
})
