import { readFileSync } from 'node:fs'
import {
  retireKeywordWriters,
  retireKeywordWritersMigration,
} from '@sim/db/script-migrations/0030_retire_keyword_writers'
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { generateId } from '@sim/utils/id'
import postgres, { type Sql } from 'postgres'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const databaseUrl = readTestDatabaseUrl()
const contract = readFileSync(
  new URL('../migrations/0401_retire_keyword_projection.sql', import.meta.url),
  'utf8'
).split('--> statement-breakpoint')

describe('retired keyword projection upgrade in PostgreSQL', () => {
  let admin: Sql
  let sql: Sql
  let writer: Sql
  let schemaName: string

  beforeEach(async () => {
    schemaName = `keyword_retirement_${generateId().replaceAll('-', '')}`
    admin = postgres(databaseUrl, { max: 1, onnotice: () => undefined })
    await admin.unsafe(`CREATE SCHEMA "${schemaName}"`)
    const options = {
      max: 1,
      onnotice: () => undefined,
      connection: { search_path: schemaName },
    }
    sql = postgres(databaseUrl, options)
    writer = postgres(databaseUrl, options)
    await sql`CREATE TABLE knowledge_base (id text PRIMARY KEY, is_search_index boolean NOT NULL DEFAULT true)`
    await sql`CREATE TABLE document (id text PRIMARY KEY, connector_id text, acl text[])`
    await sql`CREATE TABLE embedding (
      id text PRIMARY KEY, knowledge_base_id text NOT NULL REFERENCES knowledge_base(id),
      document_id text NOT NULL REFERENCES document(id), enabled boolean NOT NULL DEFAULT true,
      content text NOT NULL, content_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
    )`
    await sql`CREATE TABLE embedding_search (
      id text PRIMARY KEY REFERENCES embedding(id) ON DELETE CASCADE,
      document_id text NOT NULL, enabled boolean NOT NULL DEFAULT true,
      connector_id text, acl text[], vector_payload text NOT NULL
    )`
    await sql`CREATE TABLE embedding_keyword_search (
      id text PRIMARY KEY REFERENCES embedding(id) ON DELETE CASCADE,
      knowledge_base_id text NOT NULL, document_id text NOT NULL,
      enabled boolean NOT NULL, content_tsv tsvector NOT NULL
    )`
    await sql`CREATE INDEX embedding_keyword_search_content_idx ON embedding_keyword_search USING gin(content_tsv)`
    await sql`CREATE TABLE embedding_keyword_tin (
      id text PRIMARY KEY REFERENCES embedding(id) ON DELETE CASCADE,
      knowledge_base_id text NOT NULL, document_id text NOT NULL, enabled boolean NOT NULL,
      content text NOT NULL, connector_id text, acl text[]
    )`
    await sql`CREATE TABLE knowledge_projection_dirty (
      document_id text PRIMARY KEY, generation bigint NOT NULL DEFAULT 1,
      content boolean NOT NULL DEFAULT false, marked_at timestamptz NOT NULL DEFAULT now()
    )`
    for (const [table, column] of [
      ['embedding_keyword_search', 'content_tsv'],
      ['embedding_keyword_tin', 'content'],
    ]) {
      await sql.unsafe(`CREATE FUNCTION sync_${table}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          INSERT INTO ${table} (id, knowledge_base_id, document_id, enabled, ${column})
          VALUES (NEW.id, NEW.knowledge_base_id, NEW.document_id, NEW.enabled, NEW.${column})
          ON CONFLICT (id) DO UPDATE SET ${column} = EXCLUDED.${column};
          RETURN NEW;
        END $$`)
      await sql.unsafe(`CREATE TRIGGER ${table}_sync AFTER INSERT OR UPDATE ON embedding
        FOR EACH ROW EXECUTE FUNCTION sync_${table}()`)
    }
    await sql.unsafe(`CREATE FUNCTION sync_projection_source_acl() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        UPDATE embedding_search SET connector_id = NEW.connector_id, acl = NEW.acl WHERE document_id = NEW.id;
        UPDATE embedding_keyword_tin SET connector_id = NEW.connector_id, acl = NEW.acl WHERE document_id = NEW.id;
        RETURN NEW;
      END $$`)
    await sql`CREATE TRIGGER projection_source_acl_sync AFTER UPDATE ON document
      FOR EACH ROW EXECUTE FUNCTION sync_projection_source_acl()`
    await sql`INSERT INTO knowledge_base VALUES ('kb', true)`
    await sql`INSERT INTO document VALUES ('doc', 'source', ARRAY['reader'])`
    await sql`INSERT INTO embedding (id, knowledge_base_id, document_id, content)
      VALUES ('chunk', 'kb', 'doc', 'original searchable content')`
    await sql`INSERT INTO embedding_search VALUES ('chunk', 'doc', true, 'source', ARRAY['reader'], 'preserved-vector')`
    await sql`UPDATE embedding_keyword_tin SET connector_id = 'source', acl = ARRAY['reader']`
  })

  afterEach(async () => {
    await writer?.unsafe('ROLLBACK')
    await writer?.end()
    await sql?.end()
    if (admin) {
      await admin.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
      await admin.end()
    }
  })

  async function applyContract() {
    const statements = contract.map((statement) =>
      statement.replaceAll('"public".', `"${schemaName}".`)
    )
    try {
      for (const statement of statements) await sql.unsafe(statement)
    } catch (error) {
      await sql`ROLLBACK`
      throw error
    }
  }

  it('preserves canonical data and draining detach writes while removing obsolete maintenance', async () => {
    await applyContract()
    await retireKeywordWriters(sql)
    await applyContract()
    await retireKeywordWriters(sql)
    expect(
      (await sql`SELECT to_regclass('embedding_keyword_search') AS table_name`)[0].table_name
    ).toBeNull()
    expect(await sql`SELECT vector_payload FROM embedding_search`).toEqual([
      { vector_payload: 'preserved-vector' },
    ])
    await sql`UPDATE embedding SET content = 'updated searchable content' WHERE id = 'chunk'`
    await sql`INSERT INTO embedding (id, knowledge_base_id, document_id, content)
      VALUES ('new-chunk', 'kb', 'doc', 'new searchable content')`
    await sql`UPDATE knowledge_base SET is_search_index = false WHERE id = 'kb'`
    await sql`UPDATE document SET connector_id = 'new-source', acl = ARRAY['new-reader'] WHERE id = 'doc'`
    expect(await sql`SELECT id, content, connector_id, acl FROM embedding_keyword_tin`).toEqual([
      {
        id: 'chunk',
        content: 'original searchable content',
        connector_id: 'source',
        acl: ['reader'],
      },
    ])
    expect(await sql`SELECT connector_id, acl FROM embedding_search`).toEqual([
      { connector_id: 'new-source', acl: ['new-reader'] },
    ])
    expect(await sql`SELECT document_id, content FROM knowledge_projection_dirty`).toEqual([
      { document_id: 'doc', content: false },
    ])
    await sql`UPDATE embedding_keyword_tin SET connector_id = NULL
      WHERE id IN (SELECT id FROM embedding_keyword_tin WHERE document_id = 'doc' AND enabled LIMIT 250)`
    expect((await sql`SELECT connector_id FROM embedding_keyword_tin`)[0].connector_id).toBeNull()
    await sql`DELETE FROM embedding WHERE id = 'chunk'`
    expect(await sql`SELECT id FROM embedding_search`).toEqual([])
    expect(await sql`SELECT id FROM embedding_keyword_tin`).toEqual([])
    expect(
      await sql`SELECT id FROM embedding WHERE content_tsv @@ plainto_tsquery('english', 'searchable')`
    ).toEqual([{ id: 'new-chunk' }])
  })

  it('refuses dependent objects and rolls back the trigger removal', async () => {
    await sql`CREATE VIEW retained_dependency AS SELECT id FROM embedding_keyword_search`
    await expect(applyContract()).rejects.toMatchObject({ code: '2BP01' })
    await sql`INSERT INTO embedding (id, knowledge_base_id, document_id, content)
      VALUES ('after-refusal', 'kb', 'doc', 'preserved writer')`
    expect(await sql`SELECT id FROM retained_dependency ORDER BY id`).toEqual([
      { id: 'after-refusal' },
      { id: 'chunk' },
    ])
  })

  it('retries deployment after a busy writer drains', async () => {
    await writer`BEGIN`
    await writer`LOCK TABLE embedding IN ROW EXCLUSIVE MODE`
    const release = writer`SELECT pg_sleep(0.25)`.then(() => writer`ROLLBACK`)
    try {
      await expect(retireKeywordWritersMigration.up(sql)).resolves.toBeUndefined()
    } finally {
      await release
    }
    await sql`UPDATE embedding SET content = 'after draining' WHERE id = 'chunk'`
    expect(await sql`SELECT content FROM embedding_keyword_tin`).toEqual([
      { content: 'original searchable content' },
    ])
  })

  it('refuses a busy source table without partially retiring its writers', async () => {
    await writer`BEGIN`
    await writer`LOCK TABLE embedding IN ROW EXCLUSIVE MODE`
    await expect(applyContract()).rejects.toMatchObject({ code: '55P03' })
    await expect(retireKeywordWriters(sql)).rejects.toMatchObject({ code: '55P03' })
    await writer`ROLLBACK`
    await sql`UPDATE embedding SET content = 'writer survived' WHERE id = 'chunk'`
    expect(await sql`SELECT content FROM embedding_keyword_tin`).toEqual([
      { content: 'writer survived' },
    ])
    await applyContract()
    await retireKeywordWriters(sql)
  })
})
