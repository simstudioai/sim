/**
 * Real PostgreSQL coverage for the connector-lease ACL writers: every transaction that holds the
 * connector row assigns at most one page of ACLs, a lease lost between pages stops the writes that
 * follow, and an interrupted member-sync disable resumes to a disabled connector with every ACL
 * revoked. The `document` ACL trigger installed by the migrations fires on every page.
 */
import { db } from '@sim/db'
import {
  document,
  embedding,
  knowledgeConnector,
  knowledgeConnectorMember,
  knowledgeConnectorMemberSyncLog,
  knowledgeDocumentObservation,
  organization,
  resourcePolicy,
  user,
  workspace,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const provider = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), changes: vi.fn() }))
vi.mock('@/connectors/registry.server', () => ({
  CONNECTOR_REGISTRY: {
    google_drive: {
      id: 'google_drive',
      name: 'Fixture Drive',
      auth: { mode: 'oauth', provider: 'google-drive' },
      permissionScopedListing: { capFieldIds: [] },
      listDocuments: provider.list,
      getDocument: provider.get,
      getChangeCursor: async () => 'fixture-start',
      listChanges: provider.changes,
    },
  },
}))

import { resolveBillingAttribution } from '@/lib/billing/core/billing-attribution'
import { compileCredentialGroupWorkflowAccessPolicy } from '@/lib/credential-groups/application/workflow-access-policy'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
  seedKnowledgeMemberFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import * as connectorTokens from '@/lib/knowledge/connectors/access-token'
import * as memberAccess from '@/lib/knowledge/connectors/member-access'
import * as memberObservations from '@/lib/knowledge/connectors/member-observations'
import {
  materializeDocumentAcls,
  recordMemberObservations,
  rewriteConnectorAcls,
  sweepStaleMemberObservations,
} from '@/lib/knowledge/connectors/member-observations'
import {
  executeMemberSync,
  resumeMembershipRewrites,
} from '@/lib/knowledge/connectors/member-sync-engine'
import { executeSync } from '@/lib/knowledge/connectors/sync-engine'
import { PROJECTION_ROW_BATCH_SIZE } from '@/lib/knowledge/connectors/sync-limits'
import {
  createMemberSyncLease,
  type LeaseTransaction,
  leaseTransaction,
  SyncLockLostException,
  stillHoldsMemberSyncLock,
  stillHoldsSyncLock,
} from '@/lib/knowledge/connectors/sync-lock'
import * as syncPersistence from '@/lib/knowledge/connectors/sync-persistence'
import {
  persistDocumentAcls,
  restoreWorkspaceDocumentAcls,
} from '@/lib/knowledge/connectors/sync-persistence'

const PAGE = 25
const DOCUMENTS = 60

describe('connector lease ACL pages in PostgreSQL', () => {
  let ids: ReturnType<typeof createKnowledgeAclFixtureIds>
  let members: Awaited<ReturnType<typeof seedKnowledgeMemberFixture>>
  const alice = () => `u:${ids.aliceId}@fixture.test`
  const bob = () => `u:${ids.bobId}@fixture.test`

  beforeAll(async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('Unexpected provider request in the lease page fixture')
    })
    vi.spyOn(memberAccess, 'mintKnowledgeConnectorMemberToken').mockResolvedValue({
      accessToken: 'fixture-token',
      refreshed: false,
    })
    /** Records, for every ACL assignment, the transaction that made it. */
    await db.execute(sql`CREATE TABLE IF NOT EXISTS lease_page_acl_writes (
      document_id text NOT NULL, connector_id text, xact text NOT NULL,
      lock_timeout text NOT NULL, statement_timeout text NOT NULL
    )`)
    await db.execute(
      sql.raw(`CREATE OR REPLACE FUNCTION log_lease_page_acl_write() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN
        INSERT INTO lease_page_acl_writes VALUES (NEW.id, NEW.connector_id, pg_current_xact_id()::text,
          current_setting('lock_timeout'), current_setting('statement_timeout'));
        RETURN NEW;
      END $$`)
    )
    await db.execute(sql`DROP TRIGGER IF EXISTS log_lease_page_acl_write ON document`)
    await db.execute(sql`CREATE TRIGGER log_lease_page_acl_write AFTER UPDATE OF acl ON document
      FOR EACH ROW EXECUTE FUNCTION log_lease_page_acl_write()`)
    /** Records, for every projection row the document trigger rewrites, its table and transaction. */
    await db.execute(sql`CREATE TABLE IF NOT EXISTS lease_page_projection_writes (
      projection text NOT NULL, document_id text NOT NULL, xact text NOT NULL
    )`)
    await db.execute(
      sql.raw(`CREATE OR REPLACE FUNCTION log_lease_page_projection_write() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN
        INSERT INTO lease_page_projection_writes VALUES (TG_TABLE_NAME, NEW.document_id, pg_current_xact_id()::text);
        RETURN NEW;
      END $$`)
    )
    for (const projection of ['embedding_search', 'embedding_keyword_tin']) {
      await db.execute(
        sql.raw(`DROP TRIGGER IF EXISTS log_lease_page_projection_write ON ${projection}`)
      )
      await db.execute(
        sql.raw(`CREATE TRIGGER log_lease_page_projection_write AFTER UPDATE OF acl ON ${projection}
          FOR EACH ROW EXECUTE FUNCTION log_lease_page_projection_write()`)
      )
    }
  })

  beforeEach(async () => {
    ids = createKnowledgeAclFixtureIds()
    await seedKnowledgeAclFixture(ids, { connectorType: 'google_drive' })
    members = await seedKnowledgeMemberFixture(ids)
  })

  afterEach(async () => {
    await db.execute(sql`DROP TRIGGER IF EXISTS fail_after_acl_writes ON document`)
    await db.execute(sql`DELETE FROM lease_page_acl_writes`)
    await db.execute(sql`DELETE FROM lease_page_projection_writes`)
    await db.delete(workspace).where(eq(workspace.id, ids.workspaceId))
    await db.delete(organization).where(eq(organization.id, ids.organizationId))
    await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
  })

  afterAll(async () => {
    await db.execute(sql`DROP TRIGGER IF EXISTS log_lease_page_acl_write ON document`)
    await db.execute(sql`DROP FUNCTION IF EXISTS log_lease_page_acl_write()`)
    await db.execute(sql`DROP FUNCTION IF EXISTS fail_after_acl_writes()`)
    await db.execute(sql`DROP TABLE IF EXISTS lease_page_acl_writes`)
    for (const projection of ['embedding_search', 'embedding_keyword_tin'])
      await db.execute(
        sql.raw(`DROP TRIGGER IF EXISTS log_lease_page_projection_write ON ${projection}`)
      )
    await db.execute(sql`DROP FUNCTION IF EXISTS log_lease_page_projection_write()`)
    await db.execute(sql`DROP TABLE IF EXISTS lease_page_projection_writes`)
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    await db.$client.end()
  })

  const seedDocuments = async (connectorId: string, acl: string[], count = DOCUMENTS) => {
    const rows = Array.from({ length: count }, (_unused, index) => ({
      id: generateId(),
      knowledgeBaseId: ids.knowledgeBaseId,
      connectorId,
      externalId: `file-${String(index).padStart(3, '0')}`,
      filename: `file-${index}`,
      fileUrl: '',
      fileSize: 0,
      mimeType: 'text/plain',
      processingStatus: 'completed',
      contentHash: 'fixture-content',
      /** Ten chunks each, so a page of projection rows holds 25 documents. */
      chunkCount: 10,
      acl,
    }))
    await db.insert(document).values(rows)
    return rows
  }

  const storedAcls = async (connectorId: string) =>
    (
      await db
        .select({ externalId: document.externalId, acl: document.acl })
        .from(document)
        .where(eq(document.connectorId, connectorId))
    ).map((row) => row.acl)

  /** ACL assignments per transaction, for one connector. */
  const writesPerTransaction = async (connectorId: string) =>
    (
      await db.execute<{ writes: number }>(sql`
        SELECT count(*)::int AS writes FROM lease_page_acl_writes
        WHERE connector_id = ${connectorId} GROUP BY xact ORDER BY writes DESC`)
    ).map((row) => row.writes)

  /** Every ACL assignment ran under the bounds of a connector-lease transaction. */
  const expectBounded = async (connectorId: string) => {
    const bounds = await db.execute<{ lock: string; statement: string }>(sql`
      SELECT DISTINCT lock_timeout AS lock, statement_timeout AS statement
      FROM lease_page_acl_writes WHERE connector_id = ${connectorId}`)
    expect([...bounds]).toEqual([{ lock: '15s', statement: '30s' }])
  }

  /** Takes the lease away once `held` pages have committed, as a reclaim between pages would. */
  const losingAfter = (held: number, inner: LeaseTransaction, lose: () => Promise<unknown>) => {
    let opened = 0
    const lossy: LeaseTransaction = async (write) => {
      opened += 1
      if (opened === held + 1) await lose()
      return inner(write)
    }
    return lossy
  }

  const adminLease = () => ({ stillHeld: () => stillHoldsSyncLock(ids.connectorId, ids.lockId) })
  const reclaimAdmin = () =>
    db
      .update(knowledgeConnector)
      .set({ syncLockToken: generateId() })
      .where(eq(knowledgeConnector.id, ids.connectorId))

  describe('persistDocumentAcls', () => {
    const changed = () =>
      new Map(
        Array.from({ length: DOCUMENTS }, (_u, i) => [
          `file-${String(i).padStart(3, '0')}`,
          [bob()],
        ])
      )

    it('assigns at most one page of ACLs per lease transaction, with unchanged results', async () => {
      await seedDocuments(ids.connectorId, [alice()])

      await expect(
        persistDocumentAcls(
          ids.connectorId,
          changed(),
          leaseTransaction(ids.connectorId, adminLease())
        )
      ).resolves.toEqual({ updated: DOCUMENTS, rejected: 0 })

      expect(await writesPerTransaction(ids.connectorId)).toEqual([
        PAGE,
        PAGE,
        DOCUMENTS - 2 * PAGE,
      ])
      await expectBounded(ids.connectorId)
      expect((await storedAcls(ids.connectorId)).every((acl) => acl.join() === bob())).toBe(true)
    })

    it('writes nothing further once the lease is lost between pages, keeping the pages that landed', async () => {
      await seedDocuments(ids.connectorId, [alice()])
      /** Page one is the evidence refresh (nothing unchanged), page two the first ACL batch. */
      const transaction = losingAfter(
        2,
        leaseTransaction(ids.connectorId, adminLease()),
        reclaimAdmin
      )

      await expect(
        persistDocumentAcls(ids.connectorId, changed(), transaction)
      ).rejects.toBeInstanceOf(SyncLockLostException)

      const acls = await storedAcls(ids.connectorId)
      expect(acls.filter((acl) => acl.join() === bob())).toHaveLength(PAGE)
      expect(acls.filter((acl) => acl.join() === alice())).toHaveLength(DOCUMENTS - PAGE)
    })
  })

  describe('search projection fan-out', () => {
    const CHUNKS = 20

    /** Real chunks: the installed triggers create each chunk's search and keyword projection rows. */
    const seedChunks = async (documents: { id: string }[]) => {
      const rows = documents.flatMap((entry) =>
        Array.from({ length: CHUNKS }, (_unused, chunkIndex) => ({
          id: generateId(),
          knowledgeBaseId: ids.knowledgeBaseId,
          documentId: entry.id,
          chunkIndex,
          chunkHash: `${entry.id}-${chunkIndex}`,
          content: `lease page chunk ${chunkIndex}`,
          contentLength: 20,
          tokenCount: 4,
          embedding: [1, ...Array<number>(1535).fill(0)],
          startOffset: 0,
          endOffset: 20,
        }))
      )
      for (let offset = 0; offset < rows.length; offset += 200)
        await db.insert(embedding).values(rows.slice(offset, offset + 200))
      /**
       * The keyword projection's own sync trigger ships with the Tin migration, which a database
       * without the Tin extension skips; write the rows it would, and its installed ACL trigger
       * fills them from the document as it does for every insert.
       */
      await db.execute(sql`
        INSERT INTO embedding_keyword_tin (id, knowledge_base_id, document_id, enabled, content)
        SELECT e.id, e.knowledge_base_id, e.document_id, e.enabled, e.content FROM embedding e
        WHERE e.document_id IN (${sql.join(
          documents.map((entry) => sql`${entry.id}`),
          sql`, `
        )})
        ON CONFLICT (id) DO NOTHING`)
      await db
        .update(document)
        .set({ chunkCount: CHUNKS })
        .where(
          inArray(
            document.id,
            documents.map((entry) => entry.id)
          )
        )
    }

    /** Every projection row of the connector's documents, with its ACL and the document's, as text. */
    const projectionAcls = async (connectorId: string) =>
      db.execute<{ projection: string; acl: string | null; expected: string }>(sql`
        SELECT 'embedding_search' AS projection, array_to_string(p.acl, ',') AS acl,
          array_to_string(d.acl, ',') AS expected
        FROM embedding_search p JOIN document d ON d.id = p.document_id WHERE d.connector_id = ${connectorId}
        UNION ALL
        SELECT 'embedding_keyword_tin', array_to_string(p.acl, ','), array_to_string(d.acl, ',')
        FROM embedding_keyword_tin p JOIN document d ON d.id = p.document_id WHERE d.connector_id = ${connectorId}`)

    /** Projection rows each transaction rewrote, per table. */
    const projectionRowsPerTransaction = async () =>
      (
        await db.execute<{ rows: number }>(sql`
          SELECT count(*)::int AS rows FROM lease_page_projection_writes
          GROUP BY projection, xact ORDER BY rows DESC`)
      ).map((row) => row.rows)

    it('mirrors a paged ACL write onto every projection row, one page of rows per transaction', async () => {
      const seeded = await seedDocuments(ids.connectorId, [alice()], 30)
      await seedChunks(seeded)
      const before = [...(await projectionAcls(ids.connectorId))]
      expect(before).toHaveLength(2 * 30 * CHUNKS)

      await expect(
        persistDocumentAcls(
          ids.connectorId,
          new Map(seeded.map((row) => [row.externalId, [bob()]])),
          leaseTransaction(ids.connectorId, adminLease())
        )
      ).resolves.toEqual({ updated: 30, rejected: 0 })

      const after = [...(await projectionAcls(ids.connectorId))]
      expect(after.every((row) => row.acl === bob() && row.expected === bob())).toBe(true)
      const perTransaction = await projectionRowsPerTransaction()
      expect(perTransaction.reduce((total, rows) => total + rows, 0)).toBe(2 * 30 * CHUNKS)
      expect(Math.max(...perTransaction)).toBeLessThanOrEqual(PROJECTION_ROW_BATCH_SIZE)
    })

    it('hides a members connector across its projection rows, one page of rows per transaction', async () => {
      const seeded = await seedDocuments(members.connectorId, [alice()], 30)
      await seedChunks(seeded)

      await expect(
        rewriteConnectorAcls(members.connectorId, [], {
          lease: {
            stillHeld: () => stillHoldsMemberSyncLock(members.connectorId, members.runId),
          },
        })
      ).resolves.toBe(true)

      const after = [...(await projectionAcls(members.connectorId))]
      expect(after).toHaveLength(2 * 30 * CHUNKS)
      expect(after.every((row) => row.acl === '' && row.expected === '')).toBe(true)
      expect(Math.max(...(await projectionRowsPerTransaction()))).toBeLessThanOrEqual(
        PROJECTION_ROW_BATCH_SIZE
      )
    })
  })

  describe('fence-last pages', () => {
    /**
     * A processing commit holds a document row for its whole write. A page waiting on it must not
     * hold the connector row meanwhile, or every heartbeat, edit and reclaim queues behind it.
     */
    it('waits on a locked document row without holding any lock on the connector table', async () => {
      const [locked] = await seedDocuments(ids.connectorId, [alice()], 1)
      let release!: () => void
      let held!: () => void
      const holding = new Promise<void>((resolve) => {
        held = resolve
      })
      const holder = db.transaction(async (tx) => {
        await tx
          .select({ id: document.id })
          .from(document)
          .where(eq(document.id, locked.id))
          .for('update')
        held()
        await new Promise<void>((resolve) => {
          release = resolve
        })
      })
      await holding
      const write = persistDocumentAcls(
        ids.connectorId,
        new Map([[locked.externalId, [bob()]]]),
        leaseTransaction(ids.connectorId, adminLease())
      )
      try {
        let waiter: number | undefined
        for (let attempt = 0; attempt < 100 && waiter === undefined; attempt++) {
          const [row] = await db.execute<{ pid: number }>(sql`
            SELECT pid FROM pg_stat_activity
            WHERE wait_event_type = 'Lock' AND datname = current_database()
              AND (query ILIKE 'update "document" set "acl"%'
                OR query ILIKE 'select "id", "chunk_count" from "document"%for update')`)
          waiter = row?.pid
          if (waiter === undefined) await new Promise<void>((resolve) => setImmediate(resolve))
        }
        expect(waiter).toBeDefined()
        const connectorLocks = await db.execute<{ mode: string }>(sql`
          SELECT mode FROM pg_locks
          WHERE pid = ${waiter} AND relation = 'knowledge_connector'::regclass`)
        expect([...connectorLocks]).toEqual([])
      } finally {
        release()
        await holder
      }
      await expect(write).resolves.toEqual({ updated: 1, rejected: 0 })
      expect((await storedAcls(ids.connectorId)).map((acl) => acl.join())).toEqual([bob()])
    }, 30_000)

    /**
     * Pages are sized from a read taken without a lock; a reprocess can change a document's chunks
     * before the page writes. The page locks its documents and rereads their counts, so what it
     * writes still fits one page of projection rows.
     */
    it('resizes a page whose documents gained chunks after it was planned', async () => {
      const seeded = await seedDocuments(ids.connectorId, [alice()], 3)
      const reprocess = losingAfter(1, leaseTransaction(ids.connectorId, adminLease()), () =>
        db
          .update(document)
          .set({ chunkCount: 1_000 })
          .where(eq(document.connectorId, ids.connectorId))
      )

      await expect(
        persistDocumentAcls(
          ids.connectorId,
          new Map(seeded.map((row) => [row.externalId, [bob()]])),
          reprocess
        )
      ).resolves.toEqual({ updated: 3, rejected: 0 })

      expect(await writesPerTransaction(ids.connectorId)).toEqual([1, 1, 1])
    })

    /** Observation changes that must commit with their ACLs are paged by projection rows too. */
    it('rewrites a membership page by projection rows, a large document alone', async () => {
      const seeded = await seedDocuments(members.connectorId, [], 3)
      const [member] = members.members
      await recordMemberObservations(
        db,
        member.id,
        seeded.map((row) => row.id),
        members.runId
      )
      const huge = [...seeded].sort((a, b) => (a.id < b.id ? -1 : 1))[1]
      await db.update(document).set({ chunkCount: 1_000 }).where(eq(document.id, huge.id))
      await db
        .update(knowledgeConnectorMember)
        .set({ listingCheckpoint: { kind: 'membership', cursor: null, removeMember: false } })
        .where(eq(knowledgeConnectorMember.id, member.id))

      await expect(
        resumeMembershipRewrites({
          connectorId: members.connectorId,
          runId: members.runId,
          deadlineAt: Date.now() + 60_000,
          lease: createMemberSyncLease(members.connectorId, members.runId),
        })
      ).resolves.toBe(true)

      expect(await writesPerTransaction(members.connectorId)).toEqual([1, 1, 1])
      expect(
        (await storedAcls(members.connectorId)).every((acl) => acl.join() === member.subjectToken)
      ).toBe(true)
    })

    /** The member engine's ACL pages prove the lease last as well. */
    it('holds no connector lock while a member ACL page waits on a locked document row', async () => {
      const seeded = await seedDocuments(members.connectorId, [], 1)
      const [member] = members.members
      await recordMemberObservations(db, member.id, [seeded[0].id], members.runId)
      await db
        .update(knowledgeConnectorMember)
        .set({ listingCheckpoint: { kind: 'membership', cursor: null, removeMember: false } })
        .where(eq(knowledgeConnectorMember.id, member.id))
      let release!: () => void
      let held!: () => void
      const holding = new Promise<void>((resolve) => {
        held = resolve
      })
      const holder = db.transaction(async (tx) => {
        await tx
          .select({ id: document.id })
          .from(document)
          .where(eq(document.id, seeded[0].id))
          .for('update')
        held()
        await new Promise<void>((resolve) => {
          release = resolve
        })
      })
      await holding
      const rewrite = resumeMembershipRewrites({
        connectorId: members.connectorId,
        runId: members.runId,
        deadlineAt: Date.now() + 60_000,
        lease: createMemberSyncLease(members.connectorId, members.runId),
      })
      try {
        let waiter: number | undefined
        for (let attempt = 0; attempt < 200 && waiter === undefined; attempt++) {
          const [row] = await db.execute<{ pid: number }>(sql`
            SELECT pid FROM pg_stat_activity
            WHERE wait_event_type = 'Lock' AND datname = current_database()
              AND (query ILIKE 'update "document" set "acl"%'
                OR query ILIKE 'select "id", "chunk_count" from "document"%for update')`)
          waiter = row?.pid
          if (waiter === undefined) await new Promise<void>((resolve) => setImmediate(resolve))
        }
        expect(waiter).toBeDefined()
        const connectorLocks = await db.execute<{ mode: string }>(sql`
          SELECT mode FROM pg_locks
          WHERE pid = ${waiter} AND relation = 'knowledge_connector'::regclass`)
        expect([...connectorLocks]).toEqual([])
      } finally {
        release()
        await holder
      }
      await expect(rewrite).resolves.toBe(true)
      expect((await storedAcls(members.connectorId)).map((acl) => acl.join())).toEqual([
        member.subjectToken,
      ])
    }, 30_000)

    /** One page is bounded by projection rows; a document larger than the cap still lands, alone. */
    it('gives a document larger than one page of projection rows a page alone', async () => {
      const seeded = await seedDocuments(ids.connectorId, [alice()], 3)
      await db.update(document).set({ chunkCount: 1_000 }).where(eq(document.id, seeded[1].id))
      await db
        .update(document)
        .set({ chunkCount: 200 })
        .where(inArray(document.id, [seeded[0].id, seeded[2].id]))

      await expect(
        persistDocumentAcls(
          ids.connectorId,
          new Map(seeded.map((row) => [row.externalId, [bob()]])),
          leaseTransaction(ids.connectorId, adminLease())
        )
      ).resolves.toEqual({ updated: 3, rejected: 0 })

      expect(await writesPerTransaction(ids.connectorId)).toEqual([1, 1, 1])
    })
  })

  describe('restoreWorkspaceDocumentAcls', () => {
    beforeEach(async () => {
      await db
        .update(knowledgeConnector)
        .set({ accessMode: 'workspace' })
        .where(eq(knowledgeConnector.id, ids.connectorId))
    })

    it('restores a hidden connector one page per transaction and reports every document', async () => {
      await seedDocuments(ids.connectorId, [])

      await expect(
        restoreWorkspaceDocumentAcls(
          ids.connectorId,
          leaseTransaction(ids.connectorId, adminLease())
        )
      ).resolves.toEqual({ restored: DOCUMENTS, finished: true })

      expect(await writesPerTransaction(ids.connectorId)).toEqual([
        PAGE,
        PAGE,
        DOCUMENTS - 2 * PAGE,
      ])
      await expectBounded(ids.connectorId)
      expect((await storedAcls(ids.connectorId)).every((acl) => acl.join() === 'ws')).toBe(true)
      await expect(
        restoreWorkspaceDocumentAcls(
          ids.connectorId,
          leaseTransaction(ids.connectorId, adminLease())
        )
      ).resolves.toEqual({ restored: 0, finished: true })
    })

    it('finishes a pending rewrite before a sync completes, outside the completion transaction', async () => {
      await db
        .update(knowledgeConnector)
        .set({ status: 'active', syncLockToken: null, accessRewritePending: true })
        .where(eq(knowledgeConnector.id, ids.connectorId))
      const seeded = await seedDocuments(ids.connectorId, [])
      await db
        .update(document)
        .set({ sourceSeenAt: sql`now() + interval '1 day'`, storageKey: sql`'kb/fixture/' || id` })
        .where(eq(document.connectorId, ids.connectorId))
      provider.list.mockResolvedValue({
        documents: seeded.map((row) => ({
          externalId: row.externalId,
          title: row.filename,
          content: '',
          contentDeferred: true,
          contentHash: 'fixture-content',
          mimeType: 'text/plain',
        })),
        hasMore: false,
      })
      const token = vi
        .spyOn(connectorTokens, 'resolveConnectorAccessToken')
        .mockResolvedValue({ accessToken: 'fixture-token' } as never)
      try {
        const result = await executeSync(ids.connectorId, {
          billingAttribution: await resolveBillingAttribution({
            actorUserId: ids.aliceId,
            workspaceId: ids.workspaceId,
          }),
        })
        expect(result.error).toBeUndefined()
      } finally {
        token.mockRestore()
      }

      expect((await storedAcls(ids.connectorId)).every((acl) => acl.join() === 'ws')).toBe(true)
      expect(await writesPerTransaction(ids.connectorId)).toEqual([
        PAGE,
        PAGE,
        DOCUMENTS - 2 * PAGE,
      ])
      await expectBounded(ids.connectorId)
      const [connector] = await db
        .select({
          status: knowledgeConnector.status,
          syncLockToken: knowledgeConnector.syncLockToken,
          accessRewritePending: knowledgeConnector.accessRewritePending,
        })
        .from(knowledgeConnector)
        .where(eq(knowledgeConnector.id, ids.connectorId))
      expect(connector).toEqual({
        status: 'active',
        syncLockToken: null,
        accessRewritePending: false,
      })
    })

    /** A restore stops between pages at its deadline; a later walk resumes from what is still off. */
    it('stops a restore between pages at its deadline and resumes it on the next walk', async () => {
      await seedDocuments(ids.connectorId, [])
      let clock = Date.now()
      const now = vi.spyOn(Date, 'now').mockImplementation(() => clock)
      let pages = 0
      try {
        const partial = await restoreWorkspaceDocumentAcls(
          ids.connectorId,
          leaseTransaction(ids.connectorId, adminLease()),
          {
            deadlineAt: clock + 1_000,
            beforePage: async () => {
              pages += 1
              /** The window read, then the first page: the budget passes during that page. */
              if (pages === 2) clock += 2_000
            },
          }
        )
        expect(partial).toEqual({ restored: PAGE, finished: false })
      } finally {
        now.mockRestore()
      }
      await expect(
        restoreWorkspaceDocumentAcls(
          ids.connectorId,
          leaseTransaction(ids.connectorId, adminLease())
        )
      ).resolves.toEqual({ restored: DOCUMENTS - PAGE, finished: true })
      expect((await storedAcls(ids.connectorId)).every((acl) => acl.join() === 'ws')).toBe(true)
    })

    /** A sync whose restore ran out of budget keeps the flag and comes back at once to finish it. */
    it('keeps the pending rewrite of a sync whose restore did not finish', async () => {
      await db
        .update(knowledgeConnector)
        .set({ status: 'active', syncLockToken: null, accessRewritePending: true })
        .where(eq(knowledgeConnector.id, ids.connectorId))
      const seeded = await seedDocuments(ids.connectorId, [])
      await db
        .update(document)
        .set({ sourceSeenAt: sql`now() + interval '1 day'`, storageKey: sql`'kb/fixture/' || id` })
        .where(eq(document.connectorId, ids.connectorId))
      provider.list.mockResolvedValue({
        documents: seeded.map((row) => ({
          externalId: row.externalId,
          title: row.filename,
          content: '',
          contentDeferred: true,
          contentHash: 'fixture-content',
          mimeType: 'text/plain',
        })),
        hasMore: false,
      })
      const token = vi
        .spyOn(connectorTokens, 'resolveConnectorAccessToken')
        .mockResolvedValue({ accessToken: 'fixture-token' } as never)
      const original = syncPersistence.restoreWorkspaceDocumentAcls
      const restore = vi
        .spyOn(syncPersistence, 'restoreWorkspaceDocumentAcls')
        .mockImplementationOnce((connectorId, transaction, options) =>
          original(connectorId, transaction, { ...options, deadlineAt: Date.now() - 1 })
        )
      const billing = await resolveBillingAttribution({
        actorUserId: ids.aliceId,
        workspaceId: ids.workspaceId,
      })
      const state = async () => {
        const [row] = await db
          .select({
            accessRewritePending: knowledgeConnector.accessRewritePending,
            nextSyncAt: knowledgeConnector.nextSyncAt,
          })
          .from(knowledgeConnector)
          .where(eq(knowledgeConnector.id, ids.connectorId))
        return row
      }
      try {
        expect((await executeSync(ids.connectorId, { billingAttribution: billing })).error).toBe(
          undefined
        )
        /** The sync hands its own run budget to the restore. */
        expect(restore).toHaveBeenCalledWith(
          ids.connectorId,
          expect.any(Function),
          expect.objectContaining({ deadlineAt: expect.any(Number) })
        )
        const unfinished = await state()
        expect(unfinished?.accessRewritePending).toBe(true)
        expect(unfinished?.nextSyncAt?.getTime()).toBeLessThanOrEqual(Date.now())
        expect((await storedAcls(ids.connectorId)).every((acl) => acl.length === 0)).toBe(true)

        expect((await executeSync(ids.connectorId, { billingAttribution: billing })).error).toBe(
          undefined
        )
        expect((await state())?.accessRewritePending).toBe(false)
        expect((await storedAcls(ids.connectorId)).every((acl) => acl.join() === 'ws')).toBe(true)
      } finally {
        token.mockRestore()
        restore.mockRestore()
      }
    })

    /** An admin connector still hiding its documents lists nothing until the walk is done. */
    it('lists nothing and keeps the pending rewrite while an admin hide is unfinished', async () => {
      provider.list.mockClear()
      await db
        .update(knowledgeConnector)
        .set({
          accessMode: 'admin',
          status: 'active',
          syncLockToken: null,
          accessRewritePending: true,
        })
        .where(eq(knowledgeConnector.id, ids.connectorId))
      await seedDocuments(ids.connectorId, ['ws'])
      const token = vi
        .spyOn(connectorTokens, 'resolveConnectorAccessToken')
        .mockResolvedValue({ accessToken: 'fixture-token' } as never)
      const hide = vi
        .spyOn(memberObservations, 'rewriteConnectorAcls')
        .mockImplementationOnce(async (_connectorId, _target, options) => {
          expect(options?.deadlineAt).toEqual(expect.any(Number))
          return false
        })
      try {
        const result = await executeSync(ids.connectorId, {
          billingAttribution: await resolveBillingAttribution({
            actorUserId: ids.aliceId,
            workspaceId: ids.workspaceId,
          }),
        })
        expect(result.error).toBeUndefined()
        expect(hide).toHaveBeenCalledOnce()
        expect(provider.list).not.toHaveBeenCalled()
        const [row] = await db
          .select({
            accessRewritePending: knowledgeConnector.accessRewritePending,
            syncLockToken: knowledgeConnector.syncLockToken,
          })
          .from(knowledgeConnector)
          .where(eq(knowledgeConnector.id, ids.connectorId))
        expect(row).toEqual({ accessRewritePending: true, syncLockToken: null })
      } finally {
        token.mockRestore()
        hide.mockRestore()
      }
    })

    /** Only a pending switch leaves workspace documents off the workspace ACL; a healthy sync never walks them. */
    it('does not walk a workspace connector without a pending rewrite', async () => {
      await db
        .update(knowledgeConnector)
        .set({ status: 'active', syncLockToken: null, accessRewritePending: false })
        .where(eq(knowledgeConnector.id, ids.connectorId))
      const seeded = await seedDocuments(ids.connectorId, ['ws'])
      await db
        .update(document)
        .set({ sourceSeenAt: sql`now() + interval '1 day'`, storageKey: sql`'kb/fixture/' || id` })
        .where(eq(document.connectorId, ids.connectorId))
      provider.list.mockResolvedValue({
        documents: seeded.map((row) => ({
          externalId: row.externalId,
          title: row.filename,
          content: '',
          contentDeferred: true,
          contentHash: 'fixture-content',
          mimeType: 'text/plain',
        })),
        hasMore: false,
      })
      const token = vi
        .spyOn(connectorTokens, 'resolveConnectorAccessToken')
        .mockResolvedValue({ accessToken: 'fixture-token' } as never)
      const restore = vi.spyOn(syncPersistence, 'restoreWorkspaceDocumentAcls')
      try {
        const result = await executeSync(ids.connectorId, {
          billingAttribution: await resolveBillingAttribution({
            actorUserId: ids.aliceId,
            workspaceId: ids.workspaceId,
          }),
        })
        expect(result.error).toBeUndefined()
        expect(restore).not.toHaveBeenCalled()
      } finally {
        token.mockRestore()
        restore.mockRestore()
      }
    })

    it('restores nothing once the connector has left workspace mode', async () => {
      await seedDocuments(ids.connectorId, [])
      await db
        .update(knowledgeConnector)
        .set({ accessMode: 'admin' })
        .where(eq(knowledgeConnector.id, ids.connectorId))

      await expect(
        restoreWorkspaceDocumentAcls(
          ids.connectorId,
          leaseTransaction(ids.connectorId, adminLease())
        )
      ).resolves.toEqual({ restored: 0, finished: true })
      expect((await storedAcls(ids.connectorId)).every((acl) => acl.length === 0)).toBe(true)
    })

    it('stops at the first page after the lease is lost', async () => {
      await seedDocuments(ids.connectorId, [])

      await expect(
        restoreWorkspaceDocumentAcls(
          ids.connectorId,
          losingAfter(1, leaseTransaction(ids.connectorId, adminLease()), reclaimAdmin)
        )
      ).rejects.toBeInstanceOf(SyncLockLostException)

      expect((await storedAcls(ids.connectorId)).filter((acl) => acl.length > 0)).toHaveLength(PAGE)
    })
  })

  describe('rewriteConnectorAcls', () => {
    const memberLease = () => ({
      stillHeld: () => stillHoldsMemberSyncLock(members.connectorId, members.runId),
    })

    it('hides a members connector one page per transaction', async () => {
      await seedDocuments(members.connectorId, [alice()])

      await expect(
        rewriteConnectorAcls(members.connectorId, [], { lease: memberLease() })
      ).resolves.toBe(true)

      expect(await writesPerTransaction(members.connectorId)).toEqual([
        PAGE,
        PAGE,
        DOCUMENTS - 2 * PAGE,
      ])
      await expectBounded(members.connectorId)
      expect((await storedAcls(members.connectorId)).every((acl) => acl.length === 0)).toBe(true)
    })

    it('stops writing once the lease is lost between pages', async () => {
      await seedDocuments(members.connectorId, [alice()])
      let pages = 0

      await expect(
        rewriteConnectorAcls(members.connectorId, [], {
          lease: memberLease(),
          beforeBatch: async () => {
            pages += 1
            /** The first beat precedes the window read, the second the first page. */
            if (pages === 3)
              await db
                .update(knowledgeConnector)
                .set({ memberSyncLockToken: generateId() })
                .where(eq(knowledgeConnector.id, members.connectorId))
          },
        })
      ).rejects.toBeInstanceOf(SyncLockLostException)

      const acls = await storedAcls(members.connectorId)
      expect(acls.filter((acl) => acl.length === 0)).toHaveLength(PAGE)
      expect(acls.filter((acl) => acl.length > 0)).toHaveLength(DOCUMENTS - PAGE)
    })
  })

  describe('stale member sweep', () => {
    it('defers a connector whose row a member run holds and still sweeps the others', async () => {
      const busy = members
      const idle = await seedKnowledgeMemberFixture(ids)
      for (const fixture of [busy, idle]) {
        await db
          .update(knowledgeConnector)
          .set({
            status: 'active',
            memberSyncStatus: 'idle',
            memberSyncLockToken: null,
            syncIntervalMinutes: 60,
            lastMemberSyncAt: new Date(),
          })
          .where(eq(knowledgeConnector.id, fixture.connectorId))
        /** Enrolled long enough ago that never having listed makes them stale. */
        await db
          .update(knowledgeConnectorMember)
          .set({ createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) })
          .where(eq(knowledgeConnectorMember.connectorId, fixture.connectorId))
        const seeded = await seedDocuments(
          fixture.connectorId,
          fixture.members.map((member) => member.subjectToken).sort(),
          3
        )
        for (const member of fixture.members)
          await recordMemberObservations(
            db,
            member.id,
            seeded.map((row) => row.id),
            fixture.runId
          )
      }
      const observed = async (connectorId: string) =>
        (
          await db
            .select({ id: knowledgeDocumentObservation.memberId })
            .from(knowledgeDocumentObservation)
            .innerJoin(
              knowledgeConnectorMember,
              eq(knowledgeConnectorMember.id, knowledgeDocumentObservation.memberId)
            )
            .where(eq(knowledgeConnectorMember.connectorId, connectorId))
        ).length

      /** A member page of a running sync holds the busy connector's row for longer than a sweep page waits. */
      let release!: () => void
      let locked!: () => void
      const held = new Promise<void>((resolve) => {
        locked = resolve
      })
      const holder = db.transaction(async (tx) => {
        await tx
          .select({ id: knowledgeConnector.id })
          .from(knowledgeConnector)
          .where(eq(knowledgeConnector.id, busy.connectorId))
          .for('update')
        locked()
        await new Promise<void>((resolve) => {
          release = resolve
        })
      })
      await held
      try {
        const result = await sweepStaleMemberObservations(new Date(Date.now() + 1_000))
        expect(result.members).toBe(idle.members.length)
      } finally {
        release()
        await holder
      }

      expect(await observed(busy.connectorId)).toBe(busy.members.length * 3)
      expect(await observed(idle.connectorId)).toBe(0)
      expect((await storedAcls(idle.connectorId)).every((acl) => acl.length === 0)).toBe(true)
    }, 30_000)
  })

  describe('resumeMembershipRewrites', () => {
    it('rematerialises a changed member one page per lease transaction', async () => {
      const seeded = await seedDocuments(members.connectorId, [])
      const [member] = members.members
      await recordMemberObservations(
        db,
        member.id,
        seeded.map((row) => row.id),
        members.runId
      )
      await db
        .update(knowledgeConnectorMember)
        .set({ listingCheckpoint: { kind: 'membership', cursor: null, removeMember: false } })
        .where(eq(knowledgeConnectorMember.id, member.id))

      await expect(
        resumeMembershipRewrites({
          connectorId: members.connectorId,
          runId: members.runId,
          deadlineAt: Date.now() + 60_000,
          lease: createMemberSyncLease(members.connectorId, members.runId),
        })
      ).resolves.toBe(true)

      expect(
        (await storedAcls(members.connectorId)).every((acl) => acl.join() === member.subjectToken)
      ).toBe(true)
      expect(await writesPerTransaction(members.connectorId)).toEqual([
        PAGE,
        PAGE,
        DOCUMENTS - 2 * PAGE,
      ])
      await expectBounded(members.connectorId)
    })
  })

  describe('member listing materialisation', () => {
    beforeEach(async () => {
      provider.list.mockReset()
      provider.get.mockReset()
      provider.changes.mockReset()
      await db
        .insert(resourcePolicy)
        .values({
          id: generateId(),
          workspaceId: ids.workspaceId,
          resourceType: 'credential_group',
          resourceId: members.groupId,
          document: compileCredentialGroupWorkflowAccessPolicy({
            credentialGroupId: members.groupId,
            allowedWorkflowIds: [],
          }),
          createdBy: ids.aliceId,
          updatedBy: ids.aliceId,
        })
        .onConflictDoNothing()
      await memberAccess.grantKnowledgeConnectorCredentialAccess(
        {
          workspaceId: ids.workspaceId,
          credentialGroupId: members.groupId,
          credentialGroupOptionId: members.optionId,
          connectorId: members.connectorId,
        },
        ids.aliceId
      )
      await db
        .update(knowledgeConnector)
        .set({ status: 'active', memberSyncStatus: 'idle', memberSyncLockToken: null })
        .where(eq(knowledgeConnector.id, members.connectorId))
    })

    it('observes and materialises a large listing one page per lease transaction', async () => {
      const seeded = await seedDocuments(members.connectorId, [])
      /** Content this run already read stays unchanged, so only visibility is written. */
      await db
        .update(document)
        .set({ sourceSeenAt: sql`now() + interval '1 day'` })
        .where(eq(document.connectorId, members.connectorId))
      provider.list.mockResolvedValue({
        documents: seeded.map((row) => ({
          externalId: row.externalId,
          title: row.filename,
          content: '',
          contentDeferred: true,
          contentHash: 'fixture-content',
          mimeType: 'text/plain',
        })),
        hasMore: false,
      })

      const result = await executeMemberSync(members.connectorId, {
        billingAttribution: await resolveBillingAttribution({
          actorUserId: ids.aliceId,
          workspaceId: ids.workspaceId,
        }),
      })

      expect(result.error).toBeUndefined()
      expect(result.membersCompleted).toBe(2)
      expect(provider.get).not.toHaveBeenCalled()
      const tokens = members.members.map((member) => member.subjectToken).sort()
      expect(
        (await storedAcls(members.connectorId)).every((acl) => acl.join() === tokens.join())
      ).toBe(true)
      const perTransaction = await writesPerTransaction(members.connectorId)
      expect(perTransaction.reduce((total, writes) => total + writes, 0)).toBe(2 * DOCUMENTS)
      expect(Math.max(...perTransaction)).toBeLessThanOrEqual(PAGE)
      await expectBounded(members.connectorId)
    })

    it('rematerialises what a change feed withdrew one page per lease transaction', async () => {
      const tokens = members.members.map((member) => member.subjectToken).sort()
      const seeded = await seedDocuments(members.connectorId, tokens)
      for (const member of members.members)
        await recordMemberObservations(
          db,
          member.id,
          seeded.map((row) => row.id),
          members.runId
        )
      await db
        .update(knowledgeConnectorMember)
        .set({
          changeCursor: 'fixture-start',
          lastCompleteListingAt: new Date(),
          memberSyncedThrough: new Date(),
        })
        .where(eq(knowledgeConnectorMember.connectorId, members.connectorId))
      provider.changes.mockResolvedValue({
        changes: seeded.map((row) => ({ kind: 'removed', externalId: row.externalId })),
        hasMore: false,
        nextCursor: 'fixture-drained',
      })

      const result = await executeMemberSync(members.connectorId, {
        billingAttribution: await resolveBillingAttribution({
          actorUserId: ids.aliceId,
          workspaceId: ids.workspaceId,
        }),
      })

      expect(result.error).toBeUndefined()
      expect(result.observationsRemoved).toBe(2 * DOCUMENTS)
      expect((await storedAcls(members.connectorId)).every((acl) => acl.length === 0)).toBe(true)
      const perTransaction = await writesPerTransaction(members.connectorId)
      expect(perTransaction.reduce((total, writes) => total + writes, 0)).toBe(2 * DOCUMENTS)
      expect(Math.max(...perTransaction)).toBeLessThanOrEqual(PAGE)
      await expectBounded(members.connectorId)
    })
  })

  describe('member sync disable', () => {
    const billing = () =>
      resolveBillingAttribution({ actorUserId: ids.aliceId, workspaceId: ids.workspaceId })
    const connectorState = async () => {
      const [row] = await db
        .select({
          memberSyncStatus: knowledgeConnector.memberSyncStatus,
          memberSyncLockToken: knowledgeConnector.memberSyncLockToken,
        })
        .from(knowledgeConnector)
        .where(eq(knowledgeConnector.id, members.connectorId))
      return row
    }

    beforeEach(async () => {
      /** The option the connector synced through is gone, and no run holds the lease. */
      await db
        .update(knowledgeConnector)
        .set({
          credentialGroupOptionId: null,
          memberSyncStatus: 'idle',
          memberSyncLockToken: null,
        })
        .where(eq(knowledgeConnector.id, members.connectorId))
    })

    it('resumes an interrupted disable and ends disabled with every ACL revoked', async () => {
      const tokens = members.members.map((member) => member.subjectToken).sort()
      const seeded = await seedDocuments(members.connectorId, tokens)
      await recordMemberObservations(
        db,
        members.members[0].id,
        seeded.map((row) => row.id),
        members.runId
      )
      /** The third page fails, as a statement timeout would: two pages have committed. */
      await db.execute(
        sql.raw(`CREATE OR REPLACE FUNCTION fail_after_acl_writes() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN
          IF (SELECT count(*) FROM lease_page_acl_writes WHERE connector_id = NEW.connector_id) >= 30
          THEN RAISE EXCEPTION 'fixture statement failure'; END IF;
          RETURN NEW;
        END $$`)
      )
      await db.execute(
        sql`CREATE TRIGGER fail_after_acl_writes BEFORE UPDATE OF acl ON document FOR EACH ROW
          WHEN (NEW.connector_id = ${sql.raw(`'${members.connectorId}'`)})
          EXECUTE FUNCTION fail_after_acl_writes()`
      )

      const interrupted = await executeMemberSync(members.connectorId, {
        billingAttribution: await billing(),
      })

      expect(interrupted.error).toBeTruthy()
      expect((await connectorState())?.memberSyncStatus).not.toBe('disabled')
      const midway = await storedAcls(members.connectorId)
      expect(midway.filter((acl) => acl.length === 0)).toHaveLength(2 * PAGE)
      /** A document not yet revoked keeps only the grant it had; nothing is broadened. */
      expect(
        midway.filter((acl) => acl.length > 0).every((acl) => acl.join() === tokens.join())
      ).toBe(true)
      /** Members are suspended first, so a rematerialisation in the meantime grants nobody. */
      const suspended = await db
        .select({ status: knowledgeConnectorMember.status })
        .from(knowledgeConnectorMember)
        .where(eq(knowledgeConnectorMember.connectorId, members.connectorId))
      expect(suspended.every((row) => row.status === 'suspended')).toBe(true)

      await db.execute(sql`DROP TRIGGER fail_after_acl_writes ON document`)
      const unrevoked = seeded.at(-1)!.id
      expect(
        await leaseTransaction(members.connectorId)((tx) =>
          materializeDocumentAcls(members.connectorId, [unrevoked], tx)
        )
      ).toBe(1)
      const [rematerialized] = await db
        .select({ acl: document.acl })
        .from(document)
        .where(eq(document.id, unrevoked))
      expect(rematerialized.acl).toEqual([])
      const resumed = await executeMemberSync(members.connectorId, {
        billingAttribution: await billing(),
      })

      expect(resumed.skipReason).toBe('connector_not_syncable')
      expect(await connectorState()).toEqual({
        memberSyncStatus: 'disabled',
        memberSyncLockToken: null,
      })
      expect((await storedAcls(members.connectorId)).every((acl) => acl.length === 0)).toBe(true)
      expect(Math.max(...(await writesPerTransaction(members.connectorId)))).toBeLessThanOrEqual(
        PAGE
      )
      await expectBounded(members.connectorId)
      const [{ granted }] = await db
        .select({ granted: sql<number>`count(*)::int` })
        .from(document)
        .where(
          and(eq(document.connectorId, members.connectorId), sql`cardinality(${document.acl}) > 0`)
        )
      expect(granted).toBe(0)
    })

    it('closes a run whose disable of a removed option fails as an ordinary failure', async () => {
      /** The option id is set but no longer exists, which membership reconciliation reports. */
      await db
        .update(knowledgeConnector)
        .set({ credentialGroupOptionId: generateId() })
        .where(eq(knowledgeConnector.id, members.connectorId))
      await seedDocuments(
        members.connectorId,
        members.members.map((member) => member.subjectToken).sort()
      )
      await db.execute(
        sql.raw(`CREATE OR REPLACE FUNCTION fail_after_acl_writes() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture statement failure'; END $$`)
      )
      await db.execute(
        sql`CREATE TRIGGER fail_after_acl_writes BEFORE UPDATE OF acl ON document FOR EACH ROW
          WHEN (NEW.connector_id = ${sql.raw(`'${members.connectorId}'`)})
          EXECUTE FUNCTION fail_after_acl_writes()`
      )

      const failed = await executeMemberSync(members.connectorId, {
        billingAttribution: await billing(),
      })

      expect(failed.error).toBeTruthy()
      const state = await connectorState()
      expect(state?.memberSyncStatus).toBe('error')
      expect(state?.memberSyncLockToken).toBeNull()
      const [log] = await db
        .select({ status: knowledgeConnectorMemberSyncLog.status })
        .from(knowledgeConnectorMemberSyncLog)
        .where(eq(knowledgeConnectorMemberSyncLog.connectorId, members.connectorId))
      expect(log?.status).toBe('failed')

      await db.execute(sql`DROP TRIGGER fail_after_acl_writes ON document`)
      await executeMemberSync(members.connectorId, { billingAttribution: await billing() })
      expect((await connectorState())?.memberSyncStatus).toBe('disabled')
      expect((await storedAcls(members.connectorId)).every((acl) => acl.length === 0)).toBe(true)
    })
  })
})
