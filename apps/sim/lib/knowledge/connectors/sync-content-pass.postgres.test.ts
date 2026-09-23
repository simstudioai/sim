/**
 * @vitest-environment node
 */
import { installProjectionSourceAcl } from '@sim/db/script-migrations/0021_embedding_search_connector'
import { generateId } from '@sim/utils/id'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const holder = vi.hoisted(() => ({ db: undefined as unknown }))
const hardDelete = vi.hoisted(() => vi.fn(async (ids: string[]) => ids.length))

vi.unmock('drizzle-orm')
vi.unmock('@sim/db/schema')
vi.mock('@sim/db', () => ({
  get db() {
    return holder.db
  },
}))
vi.mock('@/lib/knowledge/documents/service', () => ({
  hardDeleteDocuments: hardDelete,
  processDocumentsWithQueue: vi.fn(),
}))
vi.mock('@/lib/core/config/trigger-availability', () => ({ isTriggerAvailable: () => true }))
vi.mock('@/lib/uploads', () => ({ StorageService: {} }))
vi.mock('@/lib/uploads/core/storage-service', () => ({ deleteFile: vi.fn() }))
vi.mock('@/lib/uploads/server/metadata', () => ({ deleteFileMetadata: vi.fn() }))
vi.mock('@/connectors/registry.server', () => ({ CONNECTOR_REGISTRY: {} }))

const { drizzle } = await import('drizzle-orm/postgres-js')
const { eq, inArray } = await import('drizzle-orm')
const schema = await import('@sim/db/schema')
const { beginListingCheckpoint } = await import('@/lib/knowledge/connectors/listing-checkpoint')
const { runConnectorContentPass } = await import('@/lib/knowledge/connectors/sync-content-pass')
const { revokeDocumentAcls } = await import('@/lib/knowledge/connectors/sync-persistence')
const { leaseTransaction } = await import('@/lib/knowledge/connectors/sync-lock')
const { confluenceConnector } = await import('@/connectors/confluence/confluence')

const databaseUrl = process.env.KNOWLEDGE_ACL_TEST_DATABASE_URL

const ALICE = 'u:alice@corp.com'
const CONNECTOR = 'admin'
const STARTED_AT = new Date('2026-09-08T11:00:00Z')
const LISTED_AT = '2026-09-08 12:00:00'
const ABSENT_SINCE = '2026-09-01 12:00:00'

/**
 * Absence reconciliation of an admin-mode connector against the real projection trigger. The
 * document carries only the columns reconciliation reads and writes; a projection row whose
 * `acl` is NULL is one the backfill has not filled yet.
 */
describe.runIf(Boolean(databaseUrl))('completed listing reconciliation in PostgreSQL', () => {
  let admin: Sql
  let sql: Sql
  const schemaName = `acl_revoke_${generateId().replaceAll('-', '')}`

  const fannedOut = async () =>
    (
      await sql<{ document_id: string }[]>`SELECT document_id FROM fan_out ORDER BY document_id`
    ).map((row) => row.document_id)

  const insertDocuments = (
    rows: { id: string; acl: string[]; seenAt: string; verified?: boolean }[]
  ) =>
    sql`INSERT INTO document ${sql(
      rows.map((row) => ({
        id: row.id,
        external_id: row.id,
        connector_id: CONNECTOR,
        acl: row.acl,
        acl_verified_at: row.verified ? '2026-09-01 12:00:00' : null,
        source_seen_at: row.seenAt,
      }))
    )}`

  /** Listed documents keep both deletion guards open: the listing is neither empty nor collapsed. */
  const insertListed = (count: number) =>
    insertDocuments(
      Array.from({ length: count }, (_unused, index) => ({
        id: `listed-${String(index).padStart(3, '0')}`,
        acl: [ALICE],
        seenAt: LISTED_AT,
      }))
    )

  async function reconcile(fullSync = false) {
    const result = {
      docsAdded: 0,
      docsUpdated: 0,
      docsDeleted: 0,
      docsUnchanged: 0,
      docsSkipped: 0,
      docsFailed: 0,
    }
    const pass = await runConnectorContentPass({
      connectorId: CONNECTOR,
      connector: {
        knowledgeBaseId: 'kb',
        connectorType: 'confluence',
        listingCheckpoint: {
          ...beginListingCheckpoint({
            fingerprint: 'a'.repeat(64),
            generationId: 'completed-listing',
            startedAt: STARTED_AT,
            fullSync,
          }),
          complete: true,
        },
      },
      connectorConfig: confluenceConnector,
      sourceConfig: {},
      syncContext: {},
      kbOwner: { workspaceId: 'workspace', userId: 'owner' },
      billingAttribution: {
        actorUserId: 'owner',
        workspaceId: 'workspace',
        organizationId: null,
        billedAccountUserId: 'owner',
        billingEntity: { type: 'user', id: 'owner' },
        billingPeriod: { start: '2026-09-01T00:00:00Z', end: '2026-10-01T00:00:00Z' },
        payerSubscription: null,
      },
      result,
      lease: {
        stillHeld: () => eq(schema.knowledgeConnector.id, CONNECTOR),
        beatIfDue: async () => undefined,
        beatLive: async () => undefined,
      },
      leaseKind: 'content',
      runId: 'run',
      fingerprint: 'a'.repeat(64),
      documentAccess: 'admin',
      getAccessToken: async () => 'token',
      hydration: { getDocument: vi.fn() },
      forceRehydrate: false,
      fullSync,
      deadlineAt: Date.now() + 60_000,
    })
    expect(pass.complete).toBe(true)
    return { result, notice: pass.holdNotice }
  }

  beforeAll(async () => {
    const url = new URL(databaseUrl!)
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      !url.pathname.startsWith('/sim_acl_test')
    ) {
      throw new Error('Reconciliation tests require a disposable local integration database')
    }
    admin = postgres(url.toString(), { max: 1, onnotice: () => undefined })
    await admin.unsafe(`CREATE SCHEMA "${schemaName}"`)
    sql = postgres(url.toString(), {
      max: 1,
      onnotice: () => undefined,
      connection: { search_path: schemaName },
    })
    holder.db = drizzle(sql, { schema })
    await sql`CREATE TABLE knowledge_connector (id text PRIMARY KEY)`
    await sql`CREATE TABLE document (
      id text PRIMARY KEY, external_id text, connector_id text, chunk_count integer NOT NULL DEFAULT 1,
      user_excluded boolean NOT NULL DEFAULT false, archived_at timestamp, deleted_at timestamp,
      source_seen_at timestamp,
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
     * assignment of `acl`, changed or not, so this is the cost a no-op revocation must not pay.
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
    hardDelete.mockClear()
    await sql`TRUNCATE embedding_search, embedding_keyword_tin, document, fan_out, knowledge_connector`
    await sql`INSERT INTO knowledge_connector (id) VALUES (${CONNECTOR})`
  })

  it('revokes an absent document that still grants someone without rewriting one that grants nobody', async () => {
    await insertListed(8)
    await insertDocuments([
      { id: 'absent-empty', acl: [], seenAt: ABSENT_SINCE },
      { id: 'absent-granted', acl: [ALICE], seenAt: ABSENT_SINCE, verified: true },
    ])
    for (const projection of ['embedding_search', 'embedding_keyword_tin']) {
      const prefix = projection === 'embedding_search' ? 'vec' : 'kw'
      await sql`INSERT INTO ${sql(projection)} (id, document_id, connector_id, acl) VALUES
        (${`${prefix}-empty-filled`}, 'absent-empty', ${CONNECTOR}, '{}'),
        (${`${prefix}-granted-unfilled`}, 'absent-granted', NULL, NULL),
        (${`${prefix}-granted-filled`}, 'absent-granted', ${CONNECTOR}, ARRAY[${ALICE}])`
    }

    const { result, notice } = await reconcile()

    expect(await fannedOut()).toEqual(['absent-granted'])
    const absent = await sql<
      { id: string; acl: string[]; verified: boolean; deleted: boolean }[]
    >`SELECT id, acl, acl_verified_at IS NOT NULL AS verified, deleted_at IS NOT NULL AS deleted
      FROM document WHERE id LIKE 'absent-%' ORDER BY id`
    expect(absent).toEqual([
      { id: 'absent-empty', acl: [], verified: false, deleted: true },
      { id: 'absent-granted', acl: [], verified: false, deleted: true },
    ])
    expect(
      await sql`SELECT id, acl FROM embedding_search
        UNION ALL SELECT id, acl FROM embedding_keyword_tin ORDER BY id`
    ).toEqual([
      { id: 'kw-empty-filled', acl: [] },
      { id: 'kw-granted-filled', acl: [] },
      { id: 'kw-granted-unfilled', acl: null },
      { id: 'vec-empty-filled', acl: [] },
      { id: 'vec-granted-filled', acl: [] },
      { id: 'vec-granted-unfilled', acl: null },
    ])
    const listed = await sql<{ acl: string[] }[]>`
      SELECT acl FROM document WHERE id LIKE 'listed-%'`
    expect(listed.every((row) => row.acl.join() === ALICE)).toBe(true)
    expect(result.docsDeleted).toBe(2)
    expect(notice).toBeNull()
  })

  it('revokes a backlog larger than one change batch completely and reports every removal', async () => {
    const ids = Array.from(
      { length: 60 },
      (_unused, index) => `absent-${String(index).padStart(3, '0')}`
    )
    await insertListed(60)
    await insertDocuments(ids.map((id) => ({ id, acl: [ALICE], seenAt: ABSENT_SINCE })))
    await sql`INSERT INTO embedding_search ${sql(
      ids.map((id) => ({ id: `vec-${id}`, document_id: id, connector_id: CONNECTOR, acl: [ALICE] }))
    )}`

    const { result } = await reconcile(true)

    expect(await fannedOut()).toEqual(ids)
    const documents = await sql<{ acl: string[] }[]>`
      SELECT acl FROM document WHERE id LIKE 'absent-%'`
    expect(documents).toHaveLength(ids.length)
    expect(documents.every((row) => row.acl.length === 0)).toBe(true)
    const chunks = await sql<{ acl: string[] }[]>`SELECT acl FROM embedding_search`
    expect(chunks).toHaveLength(ids.length)
    expect(chunks.every((row) => row.acl.length === 0)).toBe(true)
    expect(hardDelete.mock.calls.flatMap(([batch]) => batch).sort()).toEqual(ids)
    expect(result.docsDeleted).toBe(ids.length)
  })

  /**
   * The permission-only page revokes a changed document whatever its ACL; one that already
   * grants nobody still has leftover evidence cleared, without an `acl` assignment.
   */
  it('clears leftover evidence on a revoked document that already grants nobody without fan-out', async () => {
    await insertDocuments([
      { id: 'stale-evidence', acl: [], seenAt: LISTED_AT, verified: true },
      { id: 'granted', acl: [ALICE], seenAt: LISTED_AT, verified: true },
    ])
    await sql`UPDATE document SET acl_requirements = '[[], ["g:confluence:tenant:space"]]'
      WHERE id = 'stale-evidence'`

    await revokeDocumentAcls(
      leaseTransaction(CONNECTOR, undefined, holder.db as never),
      ['stale-evidence', 'granted'],
      (batch) => inArray(schema.document.id, batch)
    )

    expect(await fannedOut()).toEqual(['granted'])
    expect(
      await sql`SELECT id, acl, acl_requirements AS requirements, acl_verified_at AS verified
        FROM document ORDER BY id`
    ).toEqual([
      { id: 'granted', acl: [], requirements: [], verified: null },
      { id: 'stale-evidence', acl: [], requirements: [], verified: null },
    ])
  })
})
