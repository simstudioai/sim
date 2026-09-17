/** Real transaction rollback across embedding, search projections, provenance, and completion state. */
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { db } from '@sim/db'
import {
  document,
  embedding,
  embeddingSecretProvenance,
  knowledgeBase,
  organization,
  user,
  workspace,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

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
import {
  createKnowledgeDocumentSourceValue,
  replaceKnowledgeDocumentSecretProvenanceInTx,
} from '@/lib/knowledge/secret-provenance'

describe('bounded embedding insert transactions', () => {
  const ids = createKnowledgeAclFixtureIds()
  const triggerName = `fixture_embedding_batch_${generateId().replaceAll('-', '')}`

  beforeAll(async () => {
    fixtures.root = mkdtempSync(path.join(tmpdir(), 'sim-embedding-batches-'))
    await seedKnowledgeAclFixture(ids, { connectorType: 'google_drive' })
    vi.spyOn(embeddingClient, 'assertKnowledgeEmbeddingCapacity').mockResolvedValue(undefined)
  })

  afterAll(async () => {
    vi.restoreAllMocks()
    await db.$client.unsafe(`DROP TRIGGER IF EXISTS ${triggerName} ON embedding`)
    await db.$client.unsafe(`DROP FUNCTION IF EXISTS ${triggerName}()`)
    await db.delete(knowledgeBase).where(eq(knowledgeBase.id, ids.knowledgeBaseId))
    await db.delete(workspace).where(eq(workspace.id, ids.workspaceId))
    await db.delete(organization).where(eq(organization.id, ids.organizationId))
    await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
    await rm(fixtures.root, { recursive: true, force: true })
    await db.$client.end()
  })

  it('rolls back a second-batch failure and replaces the complete index on retry', async () => {
    const file = await addDocument(
      ids.knowledgeBaseId,
      ids.connectorId,
      'google_drive',
      {
        externalId: 'atomic-batch-fixture',
        title: 'Synthetic batch fixture.txt',
        content: 'Synthetic replacement text',
        mimeType: 'text/plain',
        contentHash: 'synthetic-replacement',
      },
      { userId: ids.aliceId, workspaceId: ids.workspaceId },
      undefined,
      'workspace',
      createContentSyncLease(ids.connectorId, ids.lockId)
    )
    const [source] = await db.select().from(document).where(eq(document.id, file.documentId))
    await db.transaction((tx) =>
      replaceKnowledgeDocumentSecretProvenanceInTx(
        tx,
        file.documentId,
        createKnowledgeDocumentSourceValue(source),
        { status: 'exact', entries: [] }
      )
    )
    const previousId = generateId()
    await db.insert(embedding).values({
      id: previousId,
      knowledgeBaseId: ids.knowledgeBaseId,
      documentId: file.documentId,
      chunkIndex: 0,
      chunkHash: 'previous-hash',
      content: 'Previously indexed text',
      contentLength: 23,
      tokenCount: 5,
      startOffset: 0,
      endOffset: 23,
      embedding: Array(1536).fill(0.1),
      secretProvenanceVersion: 1,
    })
    await db.insert(embeddingSecretProvenance).values({
      embeddingId: previousId,
      contentHash: 'previous-hash',
      status: 'exact',
      entries: [],
    })
    await db.update(document).set({ chunkCount: 1 }).where(eq(document.id, file.documentId))

    const chunks = Array.from({ length: 205 }, (_, index) => ({
      text: `Synthetic chunk ${index}`,
      metadata: { startIndex: index * 20, endIndex: index * 20 + 19 },
    }))
    fixtures.process.mockResolvedValue({
      chunks,
      metadata: { chunkCount: chunks.length, tokenCount: 615, characterCount: 4100 },
    })
    fixtures.embeddings.mockResolvedValue({
      embeddings: chunks.map(() => Array(1536).fill(0.2)),
      billableTokens: 0,
      modelName: 'text-embedding-3-small',
      pricingId: 'text-embedding-3-small',
    })
    const billing = await resolveBillingAttribution({
      actorUserId: ids.aliceId,
      workspaceId: ids.workspaceId,
    })
    await db.$client.unsafe(`CREATE FUNCTION ${triggerName}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.document_id = '${file.documentId}' AND NEW.chunk_index >= 100 THEN
          RAISE EXCEPTION 'Synthetic second-batch failure' USING ERRCODE = '57014';
        END IF;
        RETURN NEW;
      END;
      $$`)
    await db.$client.unsafe(`CREATE TRIGGER ${triggerName} BEFORE INSERT ON embedding
      FOR EACH ROW EXECUTE FUNCTION ${triggerName}()`)

    await expect(
      processDocumentAsync(ids.knowledgeBaseId, file.documentId, file, {}, billing)
    ).rejects.toMatchObject({ cause: { code: '57014' } })
    expect(
      await db
        .select({ id: embedding.id })
        .from(embedding)
        .where(eq(embedding.documentId, file.documentId))
    ).toEqual([{ id: previousId }])
    for (const table of ['embedding_search', 'embedding_keyword_search']) {
      expect(
        await db.$client.unsafe(`SELECT id FROM ${table} WHERE document_id = $1`, [file.documentId])
      ).toEqual([{ id: previousId }])
    }
    expect(
      await db
        .select()
        .from(embeddingSecretProvenance)
        .where(eq(embeddingSecretProvenance.embeddingId, previousId))
    ).toMatchObject([{ contentHash: 'previous-hash', status: 'exact' }])
    expect(await db.select().from(document).where(eq(document.id, file.documentId))).toMatchObject([
      {
        processingStatus: 'failed',
        chunkCount: 1,
        processingError: 'Database request failed (SQLSTATE 57014).',
      },
    ])

    await db.$client.unsafe(`DROP TRIGGER ${triggerName} ON embedding`)
    await processDocumentAsync(ids.knowledgeBaseId, file.documentId, file, {}, billing)
    expect(await db.select().from(document).where(eq(document.id, file.documentId))).toMatchObject([
      { processingStatus: 'completed', chunkCount: 205, processingError: null },
    ])
    for (const table of ['embedding', 'embedding_search', 'embedding_keyword_search']) {
      expect(
        await db.$client.unsafe(
          `SELECT count(*)::int AS count FROM ${table} WHERE document_id = $1`,
          [file.documentId]
        )
      ).toEqual([{ count: 205 }])
    }
    expect(
      await db.$client`SELECT count(*)::int AS count FROM embedding_secret_provenance p
      INNER JOIN embedding e ON e.id = p.embedding_id WHERE e.document_id = ${file.documentId}`
    ).toEqual([{ count: 205 }])
  })
})
