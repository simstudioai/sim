/**
 * Relation locks held by the document processing commit while it writes embeddings, and the source
 * check that discards its output when a connector or knowledge base deletion commits meanwhile.
 */
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { db } from '@sim/db'
import { document, embedding, knowledgeBase, organization, user, workspace } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import postgres from 'postgres'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const fixtures = vi.hoisted(() => ({ root: '', process: vi.fn(), embeddings: vi.fn() }))
vi.mock('@/lib/uploads/core/setup.server', () => ({
  get UPLOAD_DIR_SERVER() {
    return fixtures.root
  },
}))
vi.mock('@/lib/knowledge/documents/document-processor', () => ({
  processDocument: fixtures.process,
}))
vi.mock('@/lib/knowledge/embeddings', () => ({ generateEmbeddings: fixtures.embeddings }))

import { resolveBillingAttribution } from '@/lib/billing/core/billing-attribution'
import * as embeddingClient from '@/lib/embeddings/client'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { createContentSyncLease } from '@/lib/knowledge/connectors/sync-lock'
import { addDocument } from '@/lib/knowledge/connectors/sync-persistence'
import { processDocumentAsync } from '@/lib/knowledge/documents/service'

/** Advisory lock key that parks a processing transaction inside its embedding insert. */
const EMBEDDING_GATE = 7_310_191

describe('document processing commit lock scope', () => {
  const ids = createKnowledgeAclFixtureIds()
  const probe = `fixture_lock_probe_${generateId().replaceAll('-', '')}`
  const chunks = Array.from({ length: 3 }, (_, index) => ({
    text: `Synthetic chunk ${index}`,
    metadata: { startIndex: index * 20, endIndex: index * 20 + 19 },
  }))
  const embeddingResult = {
    embeddings: chunks.map(() => Array(1536).fill(0.2)),
    billableTokens: 0,
    modelName: 'text-embedding-3-small',
    pricingId: 'text-embedding-3-small',
  }

  beforeAll(async () => {
    fixtures.root = mkdtempSync(path.join(tmpdir(), 'sim-processing-lock-scope-'))
    await seedKnowledgeAclFixture(ids, { connectorType: 'google_drive' })
    vi.spyOn(embeddingClient, 'assertKnowledgeEmbeddingCapacity').mockResolvedValue(undefined)
    fixtures.process.mockResolvedValue({
      chunks,
      metadata: { chunkCount: chunks.length, tokenCount: 9, characterCount: 60 },
    })
    fixtures.embeddings.mockResolvedValue(embeddingResult)
  })

  afterEach(async () => {
    await db.$client.unsafe(`DROP TRIGGER IF EXISTS ${probe} ON embedding`)
    await db.$client.unsafe(`DROP FUNCTION IF EXISTS ${probe}()`)
  })

  afterAll(async () => {
    vi.restoreAllMocks()
    await db.delete(knowledgeBase).where(eq(knowledgeBase.id, ids.knowledgeBaseId))
    await db.delete(workspace).where(eq(workspace.id, ids.workspaceId))
    await db.delete(organization).where(eq(organization.id, ids.organizationId))
    await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
    await rm(fixtures.root, { recursive: true, force: true })
    await db.$client.end()
  })

  async function addConnectorDocument(externalId: string) {
    return addDocument(
      ids.knowledgeBaseId,
      ids.connectorId,
      'google_drive',
      {
        externalId,
        title: `${externalId}.txt`,
        content: 'Synthetic source text',
        mimeType: 'text/plain',
        contentHash: externalId,
      },
      { userId: ids.aliceId, workspaceId: ids.workspaceId },
      undefined,
      'workspace',
      createContentSyncLease(ids.connectorId, ids.lockId)
    )
  }

  /** Installs `body` as a BEFORE INSERT row trigger on embedding for one document. */
  async function installEmbeddingProbe(documentId: string, body: string) {
    await db.$client.unsafe(`CREATE FUNCTION ${probe}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.document_id = '${documentId}' THEN
          ${body}
        END IF;
        RETURN NEW;
      END;
      $$`)
    await db.$client.unsafe(`CREATE TRIGGER ${probe} BEFORE INSERT ON embedding
      FOR EACH ROW EXECUTE FUNCTION ${probe}()`)
  }

  /**
   * Fails any embedding insert statement whose backend holds a lock on
   * `knowledge_connector`. A statement-level AFTER trigger fires once the row
   * triggers and foreign-key checks of that statement have run, so it sees
   * every lock the insert itself took.
   */
  async function installConnectorLockProbe() {
    await db.$client.unsafe(`CREATE FUNCTION ${probe}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_locks
          WHERE pid = pg_backend_pid() AND relation = 'knowledge_connector'::regclass
        ) THEN
          RAISE EXCEPTION 'embedding write holds a knowledge_connector lock';
        END IF;
        RETURN NULL;
      END;
      $$`)
    await db.$client.unsafe(`CREATE TRIGGER ${probe} AFTER INSERT ON embedding
      FOR EACH STATEMENT EXECUTE FUNCTION ${probe}()`)
  }

  function billing() {
    return resolveBillingAttribution({ actorUserId: ids.aliceId, workspaceId: ids.workspaceId })
  }

  it('holds no knowledge_connector lock while writing embeddings', async () => {
    const file = await addConnectorDocument('lock-scope-fixture')
    await installConnectorLockProbe()

    const result = await processDocumentAsync(
      ids.knowledgeBaseId,
      file.documentId,
      file,
      {},
      await billing()
    )

    expect(result).toEqual({ outcome: 'indexed' })
    expect(await db.select().from(document).where(eq(document.id, file.documentId))).toMatchObject([
      { processingStatus: 'completed', chunkCount: 3 },
    ])
  })

  it.each([
    ['connector', 'lock-scope-deleted-connector', 'knowledge_connector', () => ids.connectorId],
    ['knowledge base', 'lock-scope-deleted-kb', 'knowledge_base', () => ids.knowledgeBaseId],
  ])(
    'discards the embeddings when a %s deletion commits during the embedding writes',
    async (_, externalId, table, id) => {
      const file = await addConnectorDocument(externalId)
      /**
       * The embedding insert waits on an advisory lock the test holds, so the processing
       * transaction is parked mid-write while a second connection commits the deletion.
       */
      const gate = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => undefined })
      const deleter = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => undefined })
      try {
        await gate`SELECT pg_advisory_lock(${EMBEDDING_GATE})`
        await installEmbeddingProbe(
          file.documentId,
          `PERFORM pg_advisory_xact_lock_shared(${EMBEDDING_GATE});`
        )
        const processing = processDocumentAsync(
          ids.knowledgeBaseId,
          file.documentId,
          file,
          {},
          await billing()
        )
        await vi.waitFor(
          async () => {
            const [row] = await deleter<Array<{ parked: boolean }>>`
              SELECT EXISTS (
                SELECT 1 FROM pg_locks
                WHERE locktype = 'advisory' AND objid = ${EMBEDDING_GATE} AND NOT granted
              ) AS parked`
            expect(row?.parked).toBe(true)
          },
          { timeout: 10_000, interval: 20 }
        )
        await deleter.begin(async (tx) => {
          await tx.unsafe(`SET LOCAL lock_timeout = '2s'`)
          await tx.unsafe(`UPDATE ${table} SET deleted_at = now() WHERE id = $1`, [id()])
        })
        await gate`SELECT pg_advisory_unlock(${EMBEDDING_GATE})`

        expect(await processing).toEqual({ outcome: 'skipped', reason: 'superseded' })
        const [tombstone] = await deleter.unsafe(`SELECT deleted_at FROM ${table} WHERE id = $1`, [
          id(),
        ])
        expect(tombstone?.deleted_at).toBeInstanceOf(Date)
        expect(
          await db
            .select({ id: embedding.id })
            .from(embedding)
            .where(eq(embedding.documentId, file.documentId))
        ).toEqual([])
        for (const projection of ['embedding_search', 'embedding_keyword_search']) {
          expect(
            await db.$client.unsafe(`SELECT id FROM ${projection} WHERE document_id = $1`, [
              file.documentId,
            ])
          ).toEqual([])
        }
        expect(
          await db.select().from(document).where(eq(document.id, file.documentId))
        ).toMatchObject([{ processingStatus: 'processing', chunkCount: 0 }])
      } finally {
        await db.$client.unsafe(`UPDATE ${table} SET deleted_at = NULL WHERE id = $1`, [id()])
        await gate.end()
        await deleter.end()
      }
    }
  )
  it.each([
    ['connector', 'lock-scope-precheck-connector', 'knowledge_connector', () => ids.connectorId],
    ['knowledge base', 'lock-scope-precheck-kb', 'knowledge_base', () => ids.knowledgeBaseId],
  ])(
    'skips the index writes when the %s went inactive after the claim',
    async (_, externalId, table, id) => {
      const file = await addConnectorDocument(externalId)
      await installEmbeddingProbe(
        file.documentId,
        `RAISE EXCEPTION 'index writes ran for an inactive source';`
      )
      fixtures.embeddings.mockImplementationOnce(async () => {
        await db.$client.unsafe(`UPDATE ${table} SET deleted_at = now() WHERE id = $1`, [id()])
        return embeddingResult
      })

      try {
        const result = await processDocumentAsync(
          ids.knowledgeBaseId,
          file.documentId,
          file,
          {},
          await billing()
        )
        expect(result).toEqual({ outcome: 'skipped', reason: 'superseded' })
      } finally {
        await db.$client.unsafe(`UPDATE ${table} SET deleted_at = NULL WHERE id = $1`, [id()])
      }
      expect(
        await db
          .select({ id: embedding.id })
          .from(embedding)
          .where(eq(embedding.documentId, file.documentId))
      ).toEqual([])
    }
  )
})
