/** Opt-in paid provider checks using only explicitly selected local OpenAI/Mistral keys and synthetic content. */
import { readFile } from 'node:fs/promises'
import { parseEnv } from 'node:util'
import { db } from '@sim/db'
import {
  document,
  embedding,
  knowledgeConnector,
  user,
  workspace,
  workspaceFiles,
} from '@sim/db/schema'
import { createLogger, LogLevel } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { PDFDocument } from 'pdf-lib'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolveBillingAttribution } from '@/lib/billing/core/billing-attribution'
import { env } from '@/lib/core/config/env'
import { seedKnowledgeAclFixture } from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { searchKnowledge } from '@/lib/knowledge/application/search'
import { createContentSyncLease } from '@/lib/knowledge/connectors/sync-lock'
import { addDocument, persistDocumentAcls } from '@/lib/knowledge/connectors/sync-persistence'
import { processDocument } from '@/lib/knowledge/documents/document-processor'
import { processDocumentAsync } from '@/lib/knowledge/documents/service'
import { generateEmbeddings } from '@/lib/knowledge/embeddings'
import { runWithKnowledgeModelInputProvenance } from '@/lib/knowledge/model-input-provenance'
import { deleteFile } from '@/lib/uploads/core/storage-service'

const credentialsFile = process.env.KNOWLEDGE_PROVIDER_LIVE_ENV_FILE
const logger = createLogger('KnowledgeLiveRetrievalQuality', {
  enabled: true,
  logLevel: LogLevel.INFO,
})

async function rasterFixture(): Promise<Buffer> {
  return sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="500"><rect width="1600" height="500" fill="white"/><text x="60" y="150" font-size="48" fill="black">Orion release checklist</text><text x="60" y="240" font-size="36" fill="black">Engineers approved the migration plan.</text><text x="60" y="320" font-size="36" fill="black">All operational dependencies are verified.</text></svg>`
    )
  )
    .png()
    .toBuffer()
}

describe.skipIf(!credentialsFile)('real embedding and scanned PDF providers', () => {
  let ids: Awaited<ReturnType<typeof seedKnowledgeAclFixture>>
  const content =
    'Orion release checklist: engineers approved the migration plan and verified the operational dependencies.'
  const prior = {
    OPENAI_API_KEY: env.OPENAI_API_KEY,
    MISTRAL_API_KEY: env.MISTRAL_API_KEY,
    OCR_PROVIDER: env.OCR_PROVIDER,
  }

  beforeAll(async () => {
    const selected = parseEnv(await readFile(credentialsFile!, 'utf8'))
    if (!selected.OPENAI_API_KEY || !selected.MISTRAL_API_KEY) {
      throw new Error('Live provider tests require explicitly configured OpenAI and Mistral keys')
    }
    Object.assign(env, {
      OPENAI_API_KEY: selected.OPENAI_API_KEY,
      MISTRAL_API_KEY: selected.MISTRAL_API_KEY,
      OCR_PROVIDER: 'mistral',
    })
    ids = await seedKnowledgeAclFixture()
  })

  afterAll(async () => {
    Object.assign(env, prior)
    if (ids) {
      const files = await db
        .select({ key: workspaceFiles.key })
        .from(workspaceFiles)
        .where(eq(workspaceFiles.workspaceId, ids.workspaceId))
      for (const file of files) await deleteFile({ key: file.key, context: 'knowledge-base' })
      await db.delete(workspace).where(eq(workspace.id, ids.workspaceId))
      await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
    }
    await db.$client.end()
  })

  it('persists real OpenAI embeddings and retrieves them through the application ACL predicate', async () => {
    const connectorId = generateId()
    const runId = generateId()
    await db.insert(knowledgeConnector).values({
      id: connectorId,
      knowledgeBaseId: ids.knowledgeBaseId,
      connectorType: 'confluence',
      sourceConfig: {},
      accessMode: 'workspace',
      status: 'syncing',
      syncLockToken: runId,
    })
    const created = await addDocument(
      ids.knowledgeBaseId,
      connectorId,
      'confluence',
      {
        externalId: 'live-provider-text',
        title: 'Orion release checklist',
        content,
        contentHash: 'provider-fixture-v1',
        mimeType: 'text/plain',
      },
      { userId: ids.aliceId, workspaceId: ids.workspaceId },
      undefined,
      'workspace',
      createContentSyncLease(connectorId, runId)
    )
    await processDocumentAsync(
      ids.knowledgeBaseId,
      created.documentId,
      created,
      {},
      await resolveBillingAttribution({ actorUserId: ids.aliceId, workspaceId: ids.workspaceId })
    )
    const [stored] = await db
      .select({ status: document.processingStatus, error: document.processingError })
      .from(document)
      .where(eq(document.id, created.documentId))
    expect(stored).toEqual({ status: 'completed', error: null })
    const vectors = await db
      .select({ vector: embedding.embedding })
      .from(embedding)
      .where(eq(embedding.documentId, created.documentId))
    expect(vectors.length).toBeGreaterThan(0)
    expect(vectors[0].vector).toHaveLength(1536)
    expect(vectors[0].vector!.every(Number.isFinite)).toBe(true)
    expect(new Set(vectors[0].vector).size).toBeGreaterThan(100)
    const result = await searchKnowledge.execute({
      principal: {
        kind: 'workspace_api_key',
        workspaceId: ids.workspaceId,
        keyId: 'synthetic-provider-fixture',
      },
      input: {
        workspaceId: ids.workspaceId,
        knowledgeBaseIds: [ids.knowledgeBaseId],
        query: 'Who approved the Orion migration?',
        topK: 3,
      },
    })
    expect(result.results.map((row) => row.documentId)).toContain(created.documentId)
  }, 120000)

  it('ranks synthetic integration documents with real OpenAI embeddings and excludes private source content', async () => {
    const corpus = [
      {
        key: 'gmail-renewal',
        title: 'Bluebird renewal — approved net-60 payment terms',
        content: `Subject: Bluebird annual subscription renewal
From: procurement@example.com
Date: October 1, 2026
Alex: Can we extend payment terms on the Bluebird annual subscription invoice?
Priya Shah: Approved. Use net-60 instead of net-30 for this renewal. I am the approver for the purchasing exception. The revised quote expires October 15.`,
      },
      {
        key: 'gmail-security',
        title: 'Bluebird renewal — security questionnaire',
        content: `Subject: Bluebird renewal security review
From: security@example.com
The Bluebird annual subscription renewal requires a vendor security questionnaire. Marcus is reviewing SOC 2 certification, encryption at rest, and incident response. This conversation tracks the security assessment.`,
      },
      {
        key: 'jira-duplicate',
        title: 'PAY-4821: Duplicate invoices after webhook retries',
        content: `Issue: PAY-4821
Type: Bug
Status: In Progress
Assignee: Lena Ortiz
Project: Payments
Repeated delivery of a payment callback creates duplicate invoices. Deduplicate webhook events by their provider event ID before invoice generation. Acceptance: retrying the same callback must create one invoice. The idempotency fix is scheduled for the next patch release.`,
      },
      {
        key: 'jira-latency',
        title: 'PAY-4812: Invoice dashboard loads slowly',
        content: `Issue: PAY-4812
Type: Performance bug
Status: Open
The invoice dashboard takes eight seconds to show historical billing records. Add pagination and an index on customer_id to improve dashboard loading. This issue does not change payment callback handling.`,
      },
      {
        key: 'github-idempotency',
        title: 'billing-service/src/webhooks/idempotency.ts',
        content: `Repository: billing-service
Path: src/webhooks/idempotency.ts
The payment webhook handler calls reserveWebhookEvent before processing an event. This function records each processed event ID in Postgres. A duplicate insert returns false and prevents repeated callback execution.
export async function reserveWebhookEvent(eventId: string): Promise<boolean> {
  const result = await db.query('INSERT INTO processed_events (event_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING event_id', [eventId]);
  return result.rowCount === 1;
}`,
      },
      {
        key: 'github-client',
        title: 'billing-client/README.md — network retry configuration',
        content: `Repository: billing-client
Path: README.md
The HTTP client retries connection failures with exponential backoff. Configure maxRetries and requestTimeoutMs for invoice API requests. The client-side retry policy handles transient network outages; webhook server persistence is implemented in billing-service.`,
      },
      {
        key: 'calendar-rehearsal',
        title: 'Vega EU cutover rehearsal',
        content: `Event: Vega EU cutover rehearsal
Start: Thursday, October 8, 2026 at 10:00 UTC
End: Thursday, October 8, 2026 at 11:00 UTC
Organizer: Platform Engineering
Location: Room C
Description: Practice switching the European production database to its standby before the Vega launch. Review failover commands and rollback steps. This is a rehearsal, not the production migration.`,
      },
      {
        key: 'calendar-review',
        title: 'Vega US capacity review',
        content: `Event: Vega US capacity review
Start: Thursday, October 15, 2026 at 16:00 UTC
Location: Room A
Description: Review North American database storage growth and capacity forecasts. Finance and platform teams will compare infrastructure costs for next quarter.`,
      },
      {
        key: 'private-acquisition',
        title: 'INTERNAL-RAVEN-973 confidential acquisition closing plan',
        content: `INTERNAL-RAVEN-973 is the confidential acquisition closing plan. The Raven acquisition signing is scheduled for November 9. The legal team must complete the restricted merger checklist before the signing meeting. This synthetic document is available only to Alice.`,
      },
    ] as const
    const billing = await resolveBillingAttribution({
      actorUserId: ids.aliceId,
      workspaceId: ids.workspaceId,
    })
    const documentIds = new Map<string, string>()
    const acls = new Map<string, string[]>()
    for (const item of corpus) {
      const externalId = `quality-${item.key}`
      const created = await addDocument(
        ids.knowledgeBaseId,
        ids.connectorId,
        'confluence',
        {
          externalId,
          title: item.title,
          content: item.content,
          contentHash: externalId,
          mimeType: 'text/plain',
        },
        { userId: ids.aliceId, workspaceId: ids.workspaceId },
        undefined,
        'admin',
        createContentSyncLease(ids.connectorId, ids.lockId)
      )
      documentIds.set(item.key, created.documentId)
      await db
        .update(document)
        .set({ tag1: 'retrieval-quality' })
        .where(eq(document.id, created.documentId))
      await processDocumentAsync(ids.knowledgeBaseId, created.documentId, created, {}, billing)
      acls.set(
        externalId,
        item.key === 'private-acquisition'
          ? [`u:${ids.aliceId}@fixture.test`]
          : [`u:${ids.aliceId}@fixture.test`, `u:${ids.bobId}@fixture.test`]
      )
    }
    expect(await persistDocumentAcls(ids.connectorId, acls)).toEqual({
      updated: corpus.length,
      rejected: 0,
    })
    const stored = await db
      .select({
        id: document.id,
        status: document.processingStatus,
        error: document.processingError,
      })
      .from(document)
      .where(inArray(document.id, [...documentIds.values()]))
    expect(stored).toHaveLength(corpus.length)
    expect(stored.every((row) => row.status === 'completed' && row.error === null)).toBe(true)
    const vectors = await db
      .select({ vector: embedding.embedding })
      .from(embedding)
      .where(inArray(embedding.documentId, [...documentIds.values()]))
    expect(vectors.length).toBeGreaterThanOrEqual(corpus.length)
    expect(
      vectors.every(
        (row) =>
          row.vector?.length === 1536 &&
          row.vector.every(Number.isFinite) &&
          new Set(row.vector).size > 100
      )
    ).toBe(true)

    const queries = [
      {
        key: 'gmail-renewal',
        mode: 'vector',
        maxRank: 3,
        query:
          'Who approved paying the Bluebird subscription invoice two months after it is issued?',
      },
      {
        key: 'jira-duplicate',
        mode: 'vector',
        maxRank: 3,
        query:
          'Which bug ticket addresses invoices being generated twice when the payment notification is delivered again?',
      },
      {
        key: 'github-idempotency',
        mode: 'vector',
        maxRank: 3,
        query:
          'Where in the repository does the payment callback handler remember event identifiers so the same notification is only processed once?',
      },
      {
        key: 'calendar-rehearsal',
        mode: 'vector',
        maxRank: 3,
        query:
          'When is the practice switchover for the European database and where are we meeting?',
      },
      { key: 'gmail-renewal', mode: 'hybrid', maxRank: 1, query: 'Bluebird net-60 payment terms' },
      { key: 'jira-duplicate', mode: 'hybrid', maxRank: 1, query: 'PAY-4821' },
      { key: 'github-idempotency', mode: 'hybrid', maxRank: 1, query: 'reserveWebhookEvent' },
      { key: 'calendar-rehearsal', mode: 'hybrid', maxRank: 1, query: 'Vega EU cutover rehearsal' },
    ] as const
    const search = async (query: string, searchMode: 'vector' | 'hybrid', userId = ids.bobId) =>
      searchKnowledge.execute({
        principal: { kind: 'session', userId, sessionId: 'synthetic-retrieval-quality' },
        input: {
          workspaceId: ids.workspaceId,
          knowledgeBaseIds: [ids.knowledgeBaseId],
          query,
          searchMode,
          topK: 10,
          rerankerEnabled: false,
          tagFilters: [{ tagName: 'Fixture', operator: 'eq', value: 'retrieval-quality' }],
        },
      })
    const observations: { key: string; mode: string; rank: number | null }[] = []
    for (const item of queries) {
      const result = await search(item.query, item.mode)
      const rankedIds = [...new Set(result.results.map((row) => row.documentId))]
      const rank = rankedIds.indexOf(documentIds.get(item.key)!) + 1
      observations.push({ key: item.key, mode: item.mode, rank: rank || null })
      expect(rankedIds).not.toContain(documentIds.get('private-acquisition'))
      expect(rank, `${item.mode}: ${item.query}`).toBeGreaterThan(0)
      expect(rank, `${item.mode}: ${item.query}`).toBeLessThanOrEqual(item.maxRank)
    }
    for (const mode of ['vector', 'hybrid'] as const) {
      const privateQuery = 'INTERNAL-RAVEN-973 confidential acquisition closing plan'
      const blocked = await search(privateQuery, mode)
      expect(blocked.results.map((row) => row.documentId)).not.toContain(
        documentIds.get('private-acquisition')
      )
      const allowed = await search(privateQuery, mode, ids.aliceId)
      expect(allowed.results[0]?.documentId).toBe(documentIds.get('private-acquisition'))
    }
    const report = {
      embeddingModel: 'text-embedding-3-small',
      corpusDocuments: corpus.length,
      publicQueries: observations.length,
      top1: observations.filter((row) => row.rank === 1).length,
      top3: observations.filter((row) => row.rank !== null && row.rank <= 3).length,
      observations,
      privateDocumentExcludedInBothModes: true,
    }
    logger.info('Small synthetic integration retrieval benchmark', report)
  }, 120000)

  it('extracts a raster-only PDF through Mistral and embeds the recovered text', async () => {
    const png = await rasterFixture()
    const pdf = await PDFDocument.create()
    const image = await pdf.embedPng(png)
    pdf.addPage([800, 250]).drawImage(image, { x: 0, y: 0, width: 800, height: 250 })
    const fileUrl = `data:application/pdf;base64,${Buffer.from(await pdf.save()).toString('base64')}`
    const result = await runWithKnowledgeModelInputProvenance(
      undefined,
      () =>
        processDocument(
          fileUrl,
          'synthetic-scanned-checklist.pdf',
          'application/pdf',
          1024,
          0,
          1,
          { userId: ids.aliceId },
          ids.workspaceId
        ),
      { opaqueInputSafe: true }
    )
    expect(result.metadata.processingMethod).toBe('mistral-ocr')
    expect(result.chunks.map((chunk) => chunk.text).join('\n')).toMatch(/Orion release checklist/i)
    const embedded = await generateEmbeddings(
      result.chunks.map((chunk) => chunk.text),
      { model: 'text-embedding-3-small', dimensions: 1536 },
      ids.workspaceId
    )
    expect(embedded.embeddings).toHaveLength(result.chunks.length)
    expect(embedded.embeddings[0]).toHaveLength(1536)
  }, 120000)
  it('extracts a PNG image through the real Mistral image endpoint', async () => {
    const bytes = await rasterFixture()
    const result = await runWithKnowledgeModelInputProvenance(
      undefined,
      () =>
        processDocument(
          `data:image/png;base64,${bytes.toString('base64')}`,
          'synthetic-checklist.png',
          'image/png',
          1024,
          0,
          1,
          { userId: ids.aliceId },
          ids.workspaceId
        ),
      { opaqueInputSafe: true }
    )
    expect(result.metadata.processingMethod).toBe('mistral-ocr')
    expect(result.chunks.map((chunk) => chunk.text).join('\n')).toMatch(/Orion release checklist/i)
  }, 120000)
})
