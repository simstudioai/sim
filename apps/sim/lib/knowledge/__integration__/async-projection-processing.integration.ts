/**
 * Document processing with `knowledge-async-projection` on, through the real service: the commit
 * writes the chunks and a mark on their document and no projection row, asks for a projector pass
 * after it commits, and the pass then writes every projection row from the chunks and the document.
 */
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { db } from '@sim/db'
import { runKnowledgeProjection } from '@sim/db/knowledge-projection'
import {
  document,
  embeddingSearch,
  knowledgeBase,
  knowledgeProjectionDirty,
  organization,
  user,
  workspace,
} from '@sim/db/schema'
import { eq, inArray } from 'drizzle-orm'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const fixtures = vi.hoisted(() => ({
  root: '',
  process: vi.fn(),
  embeddings: vi.fn(),
  requestKnowledgeProjection: vi.fn(),
}))
vi.mock('@/lib/uploads/core/setup.server', () => ({
  get UPLOAD_DIR_SERVER() {
    return fixtures.root
  },
}))
vi.mock('@/lib/knowledge/documents/document-processor', () => ({
  processDocument: fixtures.process,
}))
vi.mock('@/lib/knowledge/embeddings', () => ({ generateEmbeddings: fixtures.embeddings }))
vi.mock('@/lib/core/config/feature-flags', () => ({
  isFeatureEnabled: async (flag: string) => flag === 'knowledge-async-projection',
}))
/** The pass is run by the test itself, so the commit can be read before any pass has run. */
vi.mock('@/lib/knowledge/projection/enqueue', () => ({
  requestKnowledgeProjection: fixtures.requestKnowledgeProjection,
}))

import { resolveBillingAttribution } from '@/lib/billing/core/billing-attribution'
import * as embeddingClient from '@/lib/embeddings/client'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { createContentSyncLease } from '@/lib/knowledge/connectors/sync-lock'
import { addDocument } from '@/lib/knowledge/connectors/sync-persistence'
import { processDocumentAsync } from '@/lib/knowledge/documents/service'

/** The projections a processing commit writes where the Tin extension is absent. */
const PROJECTIONS = ['embedding_search', 'embedding_keyword_search'] as const

describe('document processing with the asynchronous projection', () => {
  const ids = createKnowledgeAclFixtureIds()
  let projector: postgres.Sql

  beforeAll(async () => {
    fixtures.root = mkdtempSync(path.join(tmpdir(), 'sim-async-projection-'))
    projector = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => undefined })
    await seedKnowledgeAclFixture(ids, { connectorType: 'google_drive' })
    vi.spyOn(embeddingClient, 'assertKnowledgeEmbeddingCapacity').mockResolvedValue(undefined)
  })

  afterAll(async () => {
    vi.restoreAllMocks()
    await db.delete(knowledgeBase).where(eq(knowledgeBase.id, ids.knowledgeBaseId))
    await db.delete(workspace).where(eq(workspace.id, ids.workspaceId))
    await db.delete(organization).where(eq(organization.id, ids.organizationId))
    await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
    await rm(fixtures.root, { recursive: true, force: true })
    await projector?.end()
    await db.$client.end()
  })

  const count = async (table: string, documentId: string) => {
    const [row] = await db.$client.unsafe<Array<{ count: number }>>(
      `SELECT count(*)::int AS count FROM ${table} WHERE document_id = $1`,
      [documentId]
    )
    return row?.count
  }

  it('commits the chunks with a mark and no projection rows, and a pass then projects them', async () => {
    const file = await addDocument(
      ids.knowledgeBaseId,
      ids.connectorId,
      'google_drive',
      {
        externalId: 'async-projection-fixture',
        title: 'Synthetic async projection fixture.txt',
        content: 'Synthetic text',
        mimeType: 'text/plain',
        contentHash: 'synthetic-async-projection',
      },
      { userId: ids.aliceId, workspaceId: ids.workspaceId },
      undefined,
      'workspace',
      createContentSyncLease(ids.connectorId, ids.lockId)
    )
    const chunks = Array.from({ length: 12 }, (_, index) => ({
      text: `Synthetic chunk ${index}`,
      metadata: { startIndex: index * 20, endIndex: index * 20 + 19 },
    }))
    fixtures.process.mockResolvedValue({
      chunks,
      metadata: { chunkCount: chunks.length, tokenCount: 36, characterCount: 240 },
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
    fixtures.requestKnowledgeProjection.mockClear()

    await processDocumentAsync(ids.knowledgeBaseId, file.documentId, file, {}, billing)

    expect(await count('embedding', file.documentId)).toBe(chunks.length)
    for (const table of PROJECTIONS) expect(await count(table, file.documentId)).toBe(0)
    expect(
      await db
        .select({ content: knowledgeProjectionDirty.content })
        .from(knowledgeProjectionDirty)
        .where(eq(knowledgeProjectionDirty.documentId, file.documentId))
    ).toEqual([{ content: true }])
    expect(fixtures.requestKnowledgeProjection).toHaveBeenCalledTimes(1)

    await runKnowledgeProjection(projector)

    for (const table of PROJECTIONS) {
      expect(await count(table, file.documentId)).toBe(chunks.length)
    }
    const [source] = await db
      .select({ connectorId: document.connectorId, acl: document.acl })
      .from(document)
      .where(eq(document.id, file.documentId))
    expect(
      await db
        .selectDistinct({ connectorId: embeddingSearch.connectorId, acl: embeddingSearch.acl })
        .from(embeddingSearch)
        .where(eq(embeddingSearch.documentId, file.documentId))
    ).toEqual([source])
    expect(
      await db
        .select()
        .from(knowledgeProjectionDirty)
        .where(eq(knowledgeProjectionDirty.documentId, file.documentId))
    ).toEqual([])
  })
})
