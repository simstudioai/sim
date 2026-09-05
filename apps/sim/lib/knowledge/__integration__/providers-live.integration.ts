/** Opt-in paid provider checks using only explicitly selected local OpenAI/Mistral keys and synthetic content. */
import { readFile } from 'node:fs/promises'
import { parseEnv } from 'node:util'
import { db } from '@sim/db'
import { document, embedding, user, workspace, workspaceFiles } from '@sim/db/schema'
import { eq, inArray } from 'drizzle-orm'
import { PDFDocument } from 'pdf-lib'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolveBillingAttribution } from '@/lib/billing/core/billing-attribution'
import { env } from '@/lib/core/config/env'
import { seedKnowledgeAclFixture } from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { searchKnowledge } from '@/lib/knowledge/application/search'
import { createContentSyncLease } from '@/lib/knowledge/connectors/sync-lock'
import { addDocument } from '@/lib/knowledge/connectors/sync-persistence'
import { processDocument } from '@/lib/knowledge/documents/document-processor'
import { processDocumentAsync } from '@/lib/knowledge/documents/service'
import { generateEmbeddings } from '@/lib/knowledge/embeddings'
import { runWithKnowledgeModelInputProvenance } from '@/lib/knowledge/model-input-provenance'
import { deleteFile } from '@/lib/uploads/core/storage-service'

const credentialsFile = process.env.KNOWLEDGE_PROVIDER_LIVE_ENV_FILE

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
    const created = await addDocument(
      ids.knowledgeBaseId,
      ids.connectorId,
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
      createContentSyncLease(ids.connectorId, ids.lockId)
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
