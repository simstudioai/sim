import { installProjectionSourceAcl } from '@sim/db/script-migrations/0021_embedding_search_connector'
import { generateId } from '@sim/utils/id'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/knowledge/documents/service', () => ({ hardDeleteDocuments: vi.fn() }))
vi.mock('@/lib/uploads', () => ({ StorageService: {} }))
vi.mock('@/lib/uploads/core/storage-service', () => ({ deleteFile: vi.fn() }))
vi.mock('@/lib/uploads/server/metadata', () => ({ deleteFileMetadata: vi.fn() }))
vi.mock('@/connectors/registry.server', () => ({ CONNECTOR_REGISTRY: {} }))

const { drizzle } = await import('drizzle-orm/postgres-js')
const schema = await import('@sim/db/schema')
const { persistDocumentAcls } = await import('@/lib/knowledge/connectors/sync-persistence')
const { leaseTransaction } = await import('@/lib/knowledge/connectors/sync-lock')

const databaseUrl = process.env.TEST_DATABASE_URL

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

  const fannedOut = async () =>
    (
      await sql<{ document_id: string }[]>`SELECT document_id FROM fan_out ORDER BY document_id`
    ).map((row) => row.document_id)

  const projected = () =>
    sql<{ id: string; acl: string[] | null }[]>`
      SELECT id, acl FROM embedding_search
      UNION ALL SELECT id, acl FROM embedding_keyword_tin ORDER BY id`

  /** Bounded page transactions on this schema's connection; these fixtures hold no lease. */
  const pages = () => leaseTransaction('admin', undefined, drizzle(sql, { schema }))

  const persist = (acls: Map<string, string[]>) => persistDocumentAcls('admin', acls, pages())

  beforeAll(async () => {
    const url = new URL(databaseUrl!)
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      !/(^|_)test(_|$)/.test(url.pathname.slice(1))
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
      id text PRIMARY KEY, external_id text, connector_id text, chunk_count integer NOT NULL DEFAULT 1,
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
    /**
     * Counts the documents whose write fired the projection fan-out: the trigger fires on any
     * assignment of `acl`, changed or not, so this is the cost an unchanged write must not pay.
     */
    await sql`CREATE TABLE fan_out (document_id text NOT NULL)`
    await sql.unsafe(`CREATE FUNCTION count_fan_out() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN INSERT INTO fan_out VALUES (NEW.id); RETURN NEW; END; $$`)
    await sql`CREATE TRIGGER count_fan_out AFTER UPDATE OF connector_id, acl ON document
      FOR EACH ROW EXECUTE FUNCTION count_fan_out()`
    await sql`ALTER TABLE embedding_search DISABLE TRIGGER embedding_search_source_acl_set`
    await sql`ALTER TABLE embedding_keyword_tin DISABLE TRIGGER embedding_keyword_tin_source_acl_set`
  }, 60_000)

  afterAll(async () => {
    await sql?.end()
    await admin?.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
    await admin?.end()
  })

  beforeEach(async () => {
    await sql`TRUNCATE embedding_search, embedding_keyword_tin, document, fan_out`
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

  it('refreshes the evidence of an unchanged ACL without firing the projection fan-out', async () => {
    await expect(persist(new Map([['file-same', [ALICE]]]))).resolves.toEqual({
      updated: 1,
      rejected: 0,
    })

    const [stored] = await sql<{ acl: string[]; fresh: boolean }[]>`
      SELECT acl, acl_verified_at > now() AT TIME ZONE 'UTC' - interval '1 minute' AS fresh
      FROM document WHERE id = 'doc-same'`
    expect(stored).toEqual({ acl: [ALICE], fresh: true })
    expect(await fannedOut()).toEqual([])
    expect((await projected()).filter((row) => row.id.includes('-same-'))).toEqual([
      { id: 'kw-same-filled', acl: [ALICE] },
      { id: 'kw-same-unfilled', acl: null },
      { id: 'vec-same-filled', acl: [ALICE] },
      { id: 'vec-same-unfilled', acl: null },
    ])
  })

  /** A chunk the backfill has not filled keeps a NULL ACL; the backfill copies the current one. */
  it('propagates a changed ACL to every filled chunk projection row', async () => {
    await expect(persist(new Map([['file-moved', [BOB]]]))).resolves.toEqual({
      updated: 1,
      rejected: 0,
    })

    const [stored] = await sql<{ acl: string[] }[]>`SELECT acl FROM document WHERE id = 'doc-moved'`
    expect(stored.acl).toEqual([BOB])
    expect((await projected()).filter((row) => row.id.includes('-moved-'))).toEqual([
      { id: 'kw-moved-filled', acl: [BOB] },
      { id: 'kw-moved-unfilled', acl: null },
      { id: 'vec-moved-filled', acl: [BOB] },
      { id: 'vec-moved-unfilled', acl: null },
    ])
  })

  it('treats a changed restriction under the same primary ACL as a change', async () => {
    await persistDocumentAcls(
      'admin',
      new Map([['file-same', { acl: [ALICE], requirements: [['g:confluence:tenant:space']] }]]),
      pages()
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
    expect(await fannedOut()).toEqual(['doc-moved'])
    expect(
      (await projected()).filter((row) => row.id.endsWith('-filled')).map((row) => row.acl)
    ).toEqual([[ALICE, BOB], [ALICE], [ALICE, BOB], [ALICE]])
  })
  it('writes a changed ACL group larger than one change batch completely', async () => {
    const ids = Array.from(
      { length: 60 },
      (_unused, index) => `bulk-${String(index).padStart(2, '0')}`
    )
    await sql`INSERT INTO document ${sql(
      ids.map((id) => ({ id: `doc-${id}`, external_id: id, connector_id: 'admin', acl: [ALICE] }))
    )}`
    await sql`INSERT INTO embedding_search ${sql(
      ids.map((id) => ({
        id: `vec-${id}`,
        document_id: `doc-${id}`,
        connector_id: 'admin',
        acl: [ALICE],
      }))
    )}`

    await expect(persist(new Map(ids.map((id) => [id, [BOB]])))).resolves.toEqual({
      updated: ids.length,
      rejected: 0,
    })

    const documents = await sql<{ acl: string[] }[]>`
      SELECT acl FROM document WHERE id LIKE 'doc-bulk-%'`
    expect(documents).toHaveLength(ids.length)
    expect(documents.every((row) => row.acl.join() === BOB)).toBe(true)
    const chunks = await sql<{ acl: string[] }[]>`
      SELECT acl FROM embedding_search WHERE id LIKE 'vec-bulk-%'`
    expect(chunks).toHaveLength(ids.length)
    expect(chunks.every((row) => row.acl.join() === BOB)).toBe(true)
  })

  it.each([
    { name: 'verified within this generation', verifiedOffsetMs: 1_000, preserved: true },
    { name: 'verified before this generation', verifiedOffsetMs: -1_000, preserved: false },
    { name: 'never verified', verifiedOffsetMs: null, preserved: false },
  ])(
    'applies the unresolved-evidence guard to an ACL the source could not answer: $name',
    async ({ verifiedOffsetMs, preserved }) => {
      const [clock] = await sql<{ now: string }[]>`
        SELECT (now() AT TIME ZONE 'UTC')::text AS now`
      const generationStartedAt = new Date(`${clock.now}Z`)
      generationStartedAt.setTime(generationStartedAt.getTime() - 60_000)
      const verifiedAt =
        verifiedOffsetMs === null
          ? null
          : new Date(generationStartedAt.getTime() + verifiedOffsetMs).toISOString()
      await sql`UPDATE document SET acl_verified_at = ${verifiedAt}::timestamptz AT TIME ZONE 'UTC'
        WHERE id = 'doc-same'`

      const result = await persistDocumentAcls('admin', new Map([['file-same', []]]), pages(), {
        unresolvedExternalIds: new Set(['file-same']),
        generationStartedAt,
      })

      expect(result).toEqual({ updated: preserved ? 0 : 1, rejected: 0 })
      const [stored] = await sql<{ acl: string[]; verified: boolean }[]>`
        SELECT acl, acl_verified_at IS NOT NULL AS verified FROM document WHERE id = 'doc-same'`
      expect(stored).toEqual(
        preserved ? { acl: [ALICE], verified: true } : { acl: [], verified: false }
      )
      const filled = (await projected())
        .filter((row) => row.id.endsWith('-same-filled'))
        .map((row) => row.acl)
      expect(filled).toEqual(preserved ? [[ALICE], [ALICE]] : [[], []])
    }
  )
})
