import { backfillProjectionSourceAcl } from '@sim/db/script-migrations/0021_embedding_search_connector'
import { projectionSourceAclBackfillMigration as embeddingSearchConnectorMigration } from '@sim/db/script-migrations/0022_projection_source_acl_backfill'
import { generateId } from '@sim/utils/id'
import postgres, { type Sql } from 'postgres'
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
})
