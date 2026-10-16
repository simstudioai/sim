/**
 * Relation locks held by the document processing commit while it writes embeddings, and the source
 * check that discards its output when a connector or knowledge base deletion commits meanwhile.
 */
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { db } from '@sim/db'
import {
  document,
  embedding,
  knowledgeBase,
  knowledgeBaseTagDefinitions,
  organization,
  user,
  workspace,
} from '@sim/db/schema'
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { deleteWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
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
vi.mock('@/lib/knowledge/documents/processor', () => ({
  processDocument: fixtures.process,
}))
vi.mock('@/lib/knowledge/embeddings', () => ({ generateEmbeddings: fixtures.embeddings }))

import { resolveBillingAttribution } from '@/lib/billing/core/attribution'
import { observeContentDelivery } from '@/lib/core/application'
import * as embeddingClient from '@/lib/embeddings/client'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { KNOWLEDGE_DELEGATION_AUDIENCE } from '@/lib/knowledge/application/authorization'
import { createKnowledgeChunk, listKnowledgeChunks } from '@/lib/knowledge/application/chunks'
import { createContentSyncLease } from '@/lib/knowledge/connectors/sync-lock'
import { addDocument } from '@/lib/knowledge/connectors/sync-persistence'
import { processDocumentAsync, updateDocument } from '@/lib/knowledge/documents/service'
import { deleteAllTagDefinitions } from '@/lib/knowledge/tags/service'
import { createCopilotChatPrincipal } from '@/lib/mothership/auth/application-delegation'
import { createRegistryContentGate } from '@/lib/mothership/content-delivery/registry-gate'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

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
    await deleteWorkspaceFixture(db, eq(workspace.id, ids.workspaceId))
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

  async function expectCurrentChunks(
    documentId: string,
    contents: string[],
    expectedTag: string | null = 'current'
  ) {
    const principal = createCopilotChatPrincipal(
      { userId: ids.aliceId, workspaceId: ids.workspaceId },
      KNOWLEDGE_DELEGATION_AUDIENCE
    )
    const result = await observeContentDelivery(
      createRegistryContentGate({
        registry: new ResolvedSecretTraceRegistry([], {
          userId: ids.aliceId,
          workspaceId: ids.workspaceId,
        }),
        actorUserId: ids.aliceId,
        workspaceId: ids.workspaceId,
      }),
      () =>
        listKnowledgeChunks.execute({
          principal,
          input: { knowledgeBaseId: ids.knowledgeBaseId, documentId },
        })
    )
    expect(result.chunks.map((row) => row.content).sort()).toEqual([...contents].sort())
    expect(result.chunks.every((row) => row.tag1 === expectedTag)).toBe(true)
  }

  it('uses metadata committed while processing waits for embeddings', async () => {
    const file = await addConnectorDocument('metadata-during-provider')
    await db.update(document).set({ connectorId: null }).where(eq(document.id, file.documentId))
    fixtures.embeddings.mockImplementationOnce(async () => {
      await updateDocument(file.documentId, { tag1: 'current' }, 'metadata-during-provider')
      return embeddingResult
    })
    expect(
      await processDocumentAsync(ids.knowledgeBaseId, file.documentId, file, {}, await billing())
    ).toEqual({ outcome: 'indexed' })
    await expectCurrentChunks(
      file.documentId,
      chunks.map((chunk) => chunk.text)
    )
  })

  it.each(['metadata edit', 'tag deletion'] as const)(
    'applies a waiting %s to the chunks committed by processing',
    async (kind) => {
      const file = await addConnectorDocument('metadata-during-commit')
      await db.update(document).set({ connectorId: null }).where(eq(document.id, file.documentId))
      if (kind === 'tag deletion') {
        await db
          .insert(knowledgeBaseTagDefinitions)
          .values([
            {
              id: generateId(),
              knowledgeBaseId: ids.knowledgeBaseId,
              tagSlot: 'tag1',
              displayName: 'Fixture text',
              fieldType: 'text',
            },
            {
              id: generateId(),
              knowledgeBaseId: ids.knowledgeBaseId,
              tagSlot: 'number1',
              displayName: 'Fixture number',
              fieldType: 'number',
            },
          ])
          .onConflictDoNothing()
        await db
          .update(document)
          .set({ tag1: 'old', number1: 3 })
          .where(eq(document.id, file.documentId))
      }
      const gate = postgres(readTestDatabaseUrl(), { max: 1, onnotice: () => undefined })
      let processing: ReturnType<typeof processDocumentAsync> | undefined
      let editing: Promise<unknown> | undefined
      try {
        await gate`SELECT pg_advisory_lock(${EMBEDDING_GATE})`
        await installEmbeddingProbe(
          file.documentId,
          `PERFORM pg_advisory_xact_lock_shared(${EMBEDDING_GATE});`
        )
        processing = processDocumentAsync(
          ids.knowledgeBaseId,
          file.documentId,
          file,
          {},
          await billing()
        )
        let processingPid = 0
        await vi.waitFor(
          async () => {
            const [row] = await gate<Array<{ pid: number }>>`
          SELECT pid FROM pg_locks WHERE locktype = 'advisory' AND objid = ${EMBEDDING_GATE} AND NOT granted`
            expect(row?.pid).toBeGreaterThan(0)
            processingPid = row?.pid ?? 0
          },
          { timeout: 10_000, interval: 20 }
        )
        editing =
          kind === 'metadata edit'
            ? updateDocument(file.documentId, { tag1: 'current' }, 'metadata-during-commit')
            : deleteAllTagDefinitions(ids.knowledgeBaseId, 'tag-deletion-during-commit')
        await vi.waitFor(
          async () => {
            const [row] = await gate<Array<{ waiting: boolean }>>`
          SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE ${processingPid} = ANY(pg_blocking_pids(pid))) AS waiting`
            expect(row?.waiting).toBe(true)
          },
          { timeout: 10_000, interval: 20 }
        )
      } finally {
        await gate`SELECT pg_advisory_unlock(${EMBEDDING_GATE})`
        try {
          await Promise.all([processing, editing])
        } finally {
          await gate.end()
        }
      }
      await expectCurrentChunks(
        file.documentId,
        chunks.map((chunk) => chunk.text),
        kind === 'metadata edit' ? 'current' : null
      )
      if (kind === 'tag deletion') {
        const retained = await db
          .select({ tag1: embedding.tag1, number1: embedding.number1 })
          .from(embedding)
          .where(eq(embedding.documentId, file.documentId))
        expect(retained).toHaveLength(chunks.length)
        expect(retained.every((row) => row.tag1 === null && row.number1 === null)).toBe(true)
        expect(
          await db
            .select()
            .from(knowledgeBaseTagDefinitions)
            .where(eq(knowledgeBaseTagDefinitions.knowledgeBaseId, ids.knowledgeBaseId))
        ).toEqual([])
      }
    }
  )

  it('uses current document tags when a manual chunk finishes its provider request', async () => {
    const file = await addConnectorDocument('manual-metadata-during-provider')
    await db
      .update(document)
      .set({ connectorId: null, processingStatus: 'completed' })
      .where(eq(document.id, file.documentId))
    fixtures.embeddings.mockImplementationOnce(async () => {
      await updateDocument(file.documentId, { tag1: 'current' }, 'manual-metadata-during-provider')
      return { ...embeddingResult, embeddings: [embeddingResult.embeddings[0]] }
    })
    await createKnowledgeChunk.execute({
      principal: { kind: 'session', userId: ids.aliceId, sessionId: generateId() },
      input: {
        knowledgeBaseId: ids.knowledgeBaseId,
        documentId: file.documentId,
        content: 'Manual chunk content',
        resolveContentProvenance: () => ({ status: 'exact', entries: [] }),
      },
    })
    await expectCurrentChunks(file.documentId, ['Manual chunk content'])
  })

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
    for (const projection of ['embedding_search']) {
      expect(
        await db.$client.unsafe(
          `SELECT count(*)::int AS count FROM ${projection} WHERE document_id = $1`,
          [file.documentId]
        )
      ).toEqual([{ count: 3 }])
    }
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
      const gate = postgres(readTestDatabaseUrl(), { max: 1, onnotice: () => undefined })
      const deleter = postgres(readTestDatabaseUrl(), { max: 1, onnotice: () => undefined })
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
        for (const projection of ['embedding_search']) {
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
