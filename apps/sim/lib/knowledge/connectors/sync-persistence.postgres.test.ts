/**
 * @vitest-environment node
 */
import { installProjectionSourceAcl } from '@sim/db/script-migrations/0021_embedding_search_connector'
import { generateId } from '@sim/utils/id'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.unmock('drizzle-orm')
vi.unmock('@sim/db/schema')
vi.mock('@/lib/knowledge/documents/service', () => ({ hardDeleteDocuments: vi.fn() }))
vi.mock('@/lib/uploads', () => ({ StorageService: {} }))
vi.mock('@/lib/uploads/core/storage-service', () => ({ deleteFile: vi.fn() }))
vi.mock('@/lib/uploads/server/metadata', () => ({ deleteFileMetadata: vi.fn() }))
vi.mock('@/connectors/registry.server', () => ({ CONNECTOR_REGISTRY: {} }))

const { drizzle } = await import('drizzle-orm/postgres-js')
const schema = await import('@sim/db/schema')
const { persistDocumentAcls } = await import('@/lib/knowledge/connectors/sync-persistence')

const databaseUrl = process.env.KNOWLEDGE_ACL_TEST_DATABASE_URL

const ALICE = 'u:alice@corp.com'
const BOB = 'u:bob@corp.com'

/**
 * The document and projections carry only the columns the ACL write and the projection trigger
 * touch. A projection row whose `acl` is NULL is one the backfill has not filled yet: the trigger
 * rewrites it on any ACL assignment, because NULL is distinct from every ACL.
 */
describe.runIf(Boolean(databaseUrl))('persistDocumentAcls in PostgreSQL', () => {
  let admin: Sql
  let sql: Sql
  const schemaName = `acl_write_${generateId().replaceAll('-', '')}`

  const projected = () =>
    sql<{ id: string; acl: string[] | null }[]>`
      SELECT id, acl FROM embedding_search
      UNION ALL SELECT id, acl FROM embedding_keyword_tin ORDER BY id`

  const persist = (acls: Map<string, string[]>) =>
    persistDocumentAcls('admin', acls, drizzle(sql, { schema }))

  beforeAll(async () => {
    const url = new URL(databaseUrl!)
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      !url.pathname.startsWith('/sim_acl_test')
    ) {
      throw new Error('ACL write tests require a disposable local integration database')
    }
    admin = postgres(url.toString(), { max: 1, onnotice: () => undefined })
    await admin.unsafe(`CREATE SCHEMA "${schemaName}"`)
    sql = postgres(url.toString(), {
      max: 1,
      onnotice: () => undefined,
      connection: { search_path: schemaName },
    })
    await sql`CREATE TABLE document (
      id text PRIMARY KEY, external_id text, connector_id text,
      acl text[] NOT NULL DEFAULT '{ws}', acl_requirements jsonb NOT NULL DEFAULT '[]',
      acl_verified_at timestamp
    )`
    for (const projection of ['embedding_search', 'embedding_keyword_tin']) {
      await sql`CREATE TABLE ${sql(projection)} (
        id text PRIMARY KEY, document_id text NOT NULL, enabled boolean NOT NULL DEFAULT true,
        connector_id text, acl text[]
      )`
    }
    await installProjectionSourceAcl(sql)
    await sql`ALTER TABLE embedding_search DISABLE TRIGGER embedding_search_source_acl_set`
    await sql`ALTER TABLE embedding_keyword_tin DISABLE TRIGGER embedding_keyword_tin_source_acl_set`
  }, 60_000)

  afterAll(async () => {
    await sql?.end()
    await admin?.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
    await admin?.end()
  })

  beforeEach(async () => {
    await sql`TRUNCATE embedding_search, embedding_keyword_tin, document`
    await sql`INSERT INTO document (id, external_id, connector_id, acl, acl_verified_at) VALUES
      ('doc-same', 'file-same', 'admin', ARRAY[${ALICE}], now() - interval '1 day'),
      ('doc-moved', 'file-moved', 'admin', ARRAY[${ALICE}], now() - interval '1 day')`
    for (const projection of ['embedding_search', 'embedding_keyword_tin']) {
      const prefix = projection === 'embedding_search' ? 'vec' : 'kw'
      await sql`INSERT INTO ${sql(projection)} (id, document_id, connector_id, acl) VALUES
        (${`${prefix}-same-unfilled`}, 'doc-same', NULL, NULL),
        (${`${prefix}-same-filled`}, 'doc-same', 'admin', ARRAY[${ALICE}]),
        (${`${prefix}-moved-unfilled`}, 'doc-moved', NULL, NULL),
        (${`${prefix}-moved-filled`}, 'doc-moved', 'admin', ARRAY[${ALICE}])`
    }
  })

  it('refreshes the evidence of an unchanged ACL without rewriting any chunk projection row', async () => {
    await expect(persist(new Map([['file-same', [ALICE]]]))).resolves.toEqual({
      updated: 1,
      rejected: 0,
    })

    const [stored] = await sql<{ acl: string[]; fresh: boolean }[]>`
      SELECT acl, acl_verified_at > now() AT TIME ZONE 'UTC' - interval '1 minute' AS fresh
      FROM document WHERE id = 'doc-same'`
    expect(stored).toEqual({ acl: [ALICE], fresh: true })
    expect((await projected()).filter((row) => row.id.includes('-same-'))).toEqual([
      { id: 'kw-same-filled', acl: [ALICE] },
      { id: 'kw-same-unfilled', acl: null },
      { id: 'vec-same-filled', acl: [ALICE] },
      { id: 'vec-same-unfilled', acl: null },
    ])
  })

  it('propagates a changed ACL to every chunk projection row, filled or not', async () => {
    await expect(persist(new Map([['file-moved', [BOB]]]))).resolves.toEqual({
      updated: 1,
      rejected: 0,
    })

    const [stored] = await sql<{ acl: string[] }[]>`SELECT acl FROM document WHERE id = 'doc-moved'`
    expect(stored.acl).toEqual([BOB])
    expect((await projected()).filter((row) => row.id.includes('-moved-'))).toEqual([
      { id: 'kw-moved-filled', acl: [BOB] },
      { id: 'kw-moved-unfilled', acl: [BOB] },
      { id: 'vec-moved-filled', acl: [BOB] },
      { id: 'vec-moved-unfilled', acl: [BOB] },
    ])
  })

  it('treats a changed restriction under the same primary ACL as a change', async () => {
    await persistDocumentAcls(
      'admin',
      new Map([['file-same', { acl: [ALICE], requirements: [['g:confluence:tenant:space']] }]]),
      drizzle(sql, { schema })
    )

    const [stored] = await sql<{ requirements: string[][] }[]>`
      SELECT acl_requirements AS requirements FROM document WHERE id = 'doc-same'`
    expect(stored.requirements).toEqual([[ALICE], ['g:confluence:tenant:space']])
  })

  it('writes each document once when one page mixes unchanged and changed ACLs', async () => {
    await expect(
      persist(
        new Map([
          ['file-same', [ALICE]],
          ['file-moved', [ALICE, BOB]],
        ])
      )
    ).resolves.toEqual({ updated: 2, rejected: 0 })

    const rows = await sql<
      { id: string; acl: string[] }[]
    >`SELECT id, acl FROM document ORDER BY id`
    expect(rows).toEqual([
      { id: 'doc-moved', acl: [ALICE, BOB] },
      { id: 'doc-same', acl: [ALICE] },
    ])
    expect(
      (await projected()).filter((row) => row.id.endsWith('-unfilled')).map((row) => row.acl)
    ).toEqual([[ALICE, BOB], null, [ALICE, BOB], null])
  })
})
