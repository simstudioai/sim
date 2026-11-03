import { installProjectionSourceAcl } from '@sim/db/script-migrations/0021_embedding_search_connector'
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { generateId } from '@sim/utils/id'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const holder = vi.hoisted(() => ({ db: undefined as unknown }))
const hardDelete = vi.hoisted(() => vi.fn(async (ids: string[]) => ids.length))

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
const { RECONCILIATION_RETAINED_MATCHES, RECONCILIATION_WINDOW_SIZE } = await import(
  '@/lib/knowledge/connectors/reconciliation-window'
)
const { runConnectorContentPass } = await import('@/lib/knowledge/connectors/sync-content-pass')
const { revokeDocumentAcls } = await import('@/lib/knowledge/connectors/sync-persistence')
const { leaseTransaction } = await import('@/lib/knowledge/connectors/sync-lock')
const { confluenceConnector } = await import('@/connectors/confluence/confluence')

const databaseUrl = readTestDatabaseUrl()

const ALICE = 'u:alice@corp.com'
const CONNECTOR = 'admin'
const STARTED_AT = new Date('2026-09-08T11:00:00Z')
const LISTED_AT = '2026-09-08 12:00:00'
const ABSENT_SINCE = '2026-09-01 12:00:00'
/** Tombstoned by an earlier sync, before this listing started. */
const TOMBSTONED_AT = '2026-09-02 12:00:00'

/**
 * Absence reconciliation of an admin-mode connector against the real projection trigger. The
 * document carries only the columns reconciliation reads and writes; a projection row whose
 * `acl` is NULL is one the backfill has not filled yet.
 */
describe('completed listing reconciliation in PostgreSQL', () => {
  let admin: Sql
  let sql: Sql
  const schemaName = `acl_revoke_${generateId().replaceAll('-', '')}`

  const fannedOut = async () =>
    (
      await sql<{ document_id: string }[]>`SELECT document_id FROM fan_out ORDER BY document_id`
    ).map((row) => row.document_id)

  interface DocumentRow {
    id: string
    acl: string[]
    seenAt: string
    verified?: boolean
    deletedAt?: string
  }

  /**
   * Inserted in bounded statements, so a connector of several windows stays under the bind limit,
   * then analyzed, so each step of a window's walk probes the primary key rather than scanning.
   */
  const insertDocuments = async (rows: DocumentRow[]) => {
    for (let offset = 0; offset < rows.length; offset += 5_000)
      await sql`INSERT INTO document ${sql(
        rows.slice(offset, offset + 5_000).map((row) => ({
          id: row.id,
          external_id: row.id,
          connector_id: CONNECTOR,
          acl: row.acl,
          acl_verified_at: row.verified ? '2026-09-01 12:00:00' : null,
          source_seen_at: row.seenAt,
          deleted_at: row.deletedAt ?? null,
        }))
      )}`
    await sql`ANALYZE document`
  }

  /** Listed documents keep both deletion guards open: the listing is neither empty nor collapsed. */
  const insertListed = (count: number) =>
    insertDocuments(
      Array.from({ length: count }, (_unused, index) => ({
        id: `listed-${String(index).padStart(3, '0')}`,
        acl: [ALICE],
        seenAt: LISTED_AT,
      }))
    )

  async function reconcile(
    fullSync = false,
    options: { beatIfDue?: () => Promise<void>; incomplete?: boolean } = {}
  ) {
    const result = {
      docsAdded: 0,
      docsUpdated: 0,
      docsDeleted: 0,
      docsUnchanged: 0,
      docsSkipped: 0,
      docsFailed: 0,
      processingDispatch: { requested: 0, accepted: 0, failed: 0 },
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
      /** Images on, so the pass exercises reconciliation alone rather than image opt-out. */
      sourceConfig: { imageAttachments: 'semantic' },
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
        beatIfDue: options.beatIfDue ?? (async () => undefined),
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
    expect(pass.complete).toBe(!options.incomplete)
    return { result, notice: pass.holdNotice }
  }

  beforeAll(async () => {
    admin = postgres(databaseUrl, { max: 1, onnotice: () => undefined })
    await admin.unsafe(`CREATE SCHEMA "${schemaName}"`)
    sql = postgres(databaseUrl, {
      max: 1,
      onnotice: () => undefined,
      connection: { search_path: schemaName },
    })
    holder.db = drizzle(sql, { schema })
    await sql`CREATE TABLE knowledge_connector (id text PRIMARY KEY)`
    await sql`CREATE TABLE document (
      id text PRIMARY KEY, external_id text, connector_id text, chunk_count integer NOT NULL DEFAULT 1,
      user_excluded boolean NOT NULL DEFAULT false, archived_at timestamp, deleted_at timestamp,
      source_seen_at timestamp, content_hash text,
      acl text[] NOT NULL DEFAULT '{ws}', acl_requirements jsonb NOT NULL DEFAULT '[]',
      acl_verified_at timestamp
    )`
    for (const projection of ['embedding_search']) {
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
  }, 60_000)

  afterAll(async () => {
    await sql?.end()
    await admin?.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
    await admin?.end()
  })

  beforeEach(async () => {
    hardDelete.mockClear()
    await sql`TRUNCATE embedding_search, document, fan_out, knowledge_connector`
    await sql`INSERT INTO knowledge_connector (id) VALUES (${CONNECTOR})`
  })

  it('revokes an absent document that still grants someone without rewriting one that grants nobody', async () => {
    await insertListed(8)
    await insertDocuments([
      { id: 'absent-empty', acl: [], seenAt: ABSENT_SINCE },
      { id: 'absent-granted', acl: [ALICE], seenAt: ABSENT_SINCE, verified: true },
    ])
    for (const projection of ['embedding_search']) {
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
    expect(await sql`SELECT id, acl FROM embedding_search ORDER BY id`).toEqual([
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

  describe('removal decisions over the tally', () => {
    const pad = (index: number) => String(index).padStart(6, '0')
    const listed = (count: number, prefix = 'listed'): DocumentRow[] =>
      Array.from({ length: count }, (_unused, index) => ({
        id: `${prefix}-${pad(index)}`,
        acl: [ALICE],
        seenAt: LISTED_AT,
      }))
    const absent = (count: number, prefix: string, deletedAt?: string): DocumentRow[] =>
      Array.from({ length: count }, (_unused, index) => ({
        id: `${prefix}-${pad(index)}`,
        acl: [ALICE],
        seenAt: ABSENT_SINCE,
        deletedAt,
      }))
    const ids = (rows: DocumentRow[]) => rows.map((row) => row.id)
    const tombstonedIds = async () =>
      (
        await sql<{ id: string }[]>`SELECT id FROM document WHERE deleted_at IS NOT NULL
          AND deleted_at > ${STARTED_AT.toISOString()}::timestamptz ORDER BY id`
      ).map((row) => row.id)
    const revokedIds = async () =>
      (
        await sql<{ id: string }[]>`SELECT id FROM document WHERE cardinality(acl) = 0 ORDER BY id`
      ).map((row) => row.id)
    const purgedIds = () => hardDelete.mock.calls.flatMap(([batch]) => batch).sort()
    /** The window statements a pass issues, outside transactions, by kind. */
    const windowStatements = () => {
      const statements = vi.spyOn(sql, 'unsafe')
      const windows = () =>
        statements.mock.calls
          .map(([query]) => query)
          .filter((query) => /^\s*with "document" as materialized/i.test(query))
      return {
        tallies: () => windows().filter((query) => query.includes('json_build_array')).length,
        walks: () => windows().filter((query) => !query.includes('json_build_array')).length,
        restore: () => statements.mockRestore(),
      }
    }

    /** 100 owned documents allow 25 removals per generation. */
    it.each([
      { soft: 25, hard: 0, notice: null },
      {
        soft: 26,
        hard: 0,
        notice:
          /^Withheld 26 document removal\(s\) — more than the 25 allowed per generation in one sync of 100 documents\. Documents removed at the source are still indexed\. /,
      },
      { soft: 0, hard: 25, notice: null },
      {
        soft: 0,
        hard: 26,
        notice:
          /^Withheld 26 document removal\(s\) — more than the 25 allowed per generation in one sync of 100 documents\. Documents already pending removal were not purged/,
      },
      {
        soft: 26,
        hard: 26,
        notice:
          /^Withheld 52 document removal\(s\) — more than the 25 allowed per generation in one sync of 100 documents\. Documents removed at the source are still indexed, and documents already pending removal were not purged\. /,
      },
      {
        soft: 25,
        hard: 26,
        notice:
          /^Withheld 26 document removal\(s\) — more than the 25 allowed per generation in one sync of 100 documents\. Documents already pending removal were not purged/,
      },
    ])(
      'applies the per-generation cap to $soft soft and $hard hard removals of 100 documents',
      async ({ soft, hard, notice }) => {
        const live = absent(soft, 'gone')
        const tombstones = absent(hard, 'pending', TOMBSTONED_AT)
        await insertDocuments([...listed(100 - soft - hard), ...live, ...tombstones])

        const { result, notice: holdNotice } = await reconcile()

        const softHeld = soft > 25
        const hardHeld = hard > 25
        expect(holdNotice ?? null).toEqual(notice ? expect.stringMatching(notice) : null)
        expect(await tombstonedIds()).toEqual(softHeld ? [] : ids(live))
        expect(result.docsDeleted).toBe(softHeld ? 0 : soft)
        expect(purgedIds()).toEqual(hardHeld ? [] : ids(tombstones))
        /** A hold withholds removals, never revocations: absent grants are revoked either way. */
        expect(await revokedIds()).toEqual([...ids(live), ...ids(tombstones)].sort())
      }
    )

    it('removes every absent document past the cap on a full sync, reporting only the newly hidden', async () => {
      const live = absent(30, 'gone')
      const tombstones = absent(30, 'pending', TOMBSTONED_AT)
      await insertDocuments([...listed(40), ...live, ...tombstones])

      const { result, notice } = await reconcile(true)

      expect(notice).toBeNull()
      expect(purgedIds()).toEqual([...ids(live), ...ids(tombstones)].sort())
      expect(result.docsDeleted).toBe(live.length)
      expect(await tombstonedIds()).toEqual([])
    })

    it('tallies an empty connector in one statement and removes nothing', async () => {
      const statements = windowStatements()
      try {
        const { result, notice } = await reconcile()

        expect(notice).toBeNull()
        expect(result.docsDeleted).toBe(0)
        expect(hardDelete).not.toHaveBeenCalled()
        expect({ tallies: statements.tallies(), walks: statements.walks() }).toEqual({
          tallies: 1,
          walks: 0,
        })
      } finally {
        statements.restore()
      }
    })

    it('reads a connector of several windows once and acts on the rows it tallied', async () => {
      /** Absent documents sort between the listed ones, so every window holds some of each. */
      const rows = Array.from(
        { length: 2 * RECONCILIATION_WINDOW_SIZE + 2_000 },
        (_unused, index) => {
          const id = `doc-${pad(index)}`
          if (index % 1_000 === 7) return { id, acl: [ALICE], seenAt: ABSENT_SINCE }
          if (index % 1_000 === 500)
            return { id, acl: [ALICE], seenAt: ABSENT_SINCE, deletedAt: TOMBSTONED_AT }
          return { id, acl: [ALICE], seenAt: LISTED_AT }
        }
      )
      const live = rows.filter((row) => row.seenAt === ABSENT_SINCE && !row.deletedAt)
      const tombstones = rows.filter((row) => row.deletedAt)
      await insertDocuments(rows)
      const statements = windowStatements()
      try {
        const { result, notice } = await reconcile()

        expect(notice).toBeNull()
        expect(await tombstonedIds()).toEqual(ids(live))
        expect(result.docsDeleted).toBe(live.length)
        expect(purgedIds()).toEqual(ids(tombstones))
        expect(await revokedIds()).toEqual([...ids(live), ...ids(tombstones)].sort())
        expect(await fannedOut()).toEqual([...ids(live), ...ids(tombstones)].sort())
        /** One statement per window decides and finds every removal; no removal reads it again. */
        expect({ tallies: statements.tallies(), walks: statements.walks() }).toEqual({
          tallies: 3,
          walks: 0,
        })
      } finally {
        statements.restore()
      }
    }, 60_000)

    it('walks again for removals too many to keep, removing each exactly once', async () => {
      const gone = Array.from(
        { length: RECONCILIATION_RETAINED_MATCHES + 1 },
        (_unused, index) => ({
          id: `gone-${pad(index)}`,
          acl: [],
          seenAt: ABSENT_SINCE,
        })
      )
      const present = listed(1_200)
      await insertDocuments([...present, ...gone])
      const statements = windowStatements()
      try {
        const { result, notice } = await reconcile(true)

        expect(notice).toBeNull()
        expect(purgedIds()).toEqual(ids(gone))
        expect(hardDelete.mock.calls.every(([batch]) => batch.length <= 25)).toBe(true)
        expect(result.docsDeleted).toBe(gone.length)
        const windows = Math.ceil((present.length + gone.length) / RECONCILIATION_WINDOW_SIZE)
        expect({ tallies: statements.tallies(), walks: statements.walks() }).toEqual({
          tallies: windows,
          walks: windows,
        })
      } finally {
        statements.restore()
      }
    }, 120_000)

    it('skips a tallied removal the user excluded before it ran, and never tallies a later one', async () => {
      const early = absent(3, 'a-gone')
      const late = absent(3, 'z-gone')
      await insertDocuments([...early, ...listed(RECONCILIATION_WINDOW_SIZE, 'm-listed'), ...late])
      const statements = windowStatements()
      let excluded = false
      try {
        /** Once the first window is tallied, the user excludes one document from each window. */
        const { result, notice } = await reconcile(false, {
          beatIfDue: async () => {
            if (excluded || statements.tallies() !== 1) return
            excluded = true
            await sql`UPDATE document SET user_excluded = true
              WHERE id IN (${early[0].id}, ${late[0].id})`
          },
        })

        expect(excluded).toBe(true)
        expect(notice).toBeNull()
        const removed = [...ids(early.slice(1)), ...ids(late.slice(1))]
        expect(await tombstonedIds()).toEqual(removed)
        expect(result.docsDeleted).toBe(removed.length)
        expect(await revokedIds()).toEqual(removed)
      } finally {
        statements.restore()
      }
    }, 60_000)

    it('resumes removals a deadline cut short on the next pass, removing each exactly once', async () => {
      /** 2,400 owned documents allow 600 removals: exactly this many, in two soft-delete pages. */
      const gone = absent(600, 'gone')
      await insertDocuments([...listed(1_800), ...gone])
      vi.useFakeTimers({ toFake: ['Date'] })
      try {
        let cut = false
        const first = await reconcile(false, {
          incomplete: true,
          beatIfDue: async () => {
            if (cut || (await tombstonedIds()).length === 0) return
            cut = true
            vi.setSystemTime(Date.now() + 120_000)
          },
        })
        expect(first.result.docsDeleted).toBe(500)

        const second = await reconcile()

        expect(second.result.docsDeleted).toBe(100)
        expect(second.notice).toBeNull()
        expect(await tombstonedIds()).toEqual(ids(gone))
      } finally {
        vi.useRealTimers()
      }
    })
  })
})
