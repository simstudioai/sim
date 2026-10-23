/** A real export, imported back through the runner, against PostgreSQL and local storage. */
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { db } from '@sim/db'
import {
  auditLog,
  document,
  embedding,
  knowledgeBase,
  knowledgeBaseImport,
  knowledgeBaseTagDefinitions,
  organization,
  outboxEvent,
  uploadSession,
  user,
  workspace,
} from '@sim/db/schema'
import { deleteWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { sha256Hex } from '@sim/security/hash'
import { generateId } from '@sim/utils/id'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import JSZip from 'jszip'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  root: '',
  embedded: 0,
  target: { model: 'text-embedding-3-small', dimensions: 1536 as const },
}))
vi.mock('@/lib/uploads/core/setup.server', () => ({
  get UPLOAD_DIR_SERVER() {
    return fixture.root
  },
}))
vi.mock('@/lib/embeddings', async () => ({
  ...(await import('@/lib/embeddings/client')),
  assertKnowledgeEmbeddingCapacity: async () => {},
  embedKnowledge: async (texts: string[]) => {
    fixture.embedded += texts.length
    return {
      embeddings: texts.map(() => [0, 0, 1, ...Array<number>(1533).fill(0)]),
      totalTokens: texts.length,
      billableTokens: 0,
      isBYOK: true,
      modelName: fixture.target.model,
      pricingId: fixture.target.model,
    }
  },
}))
vi.mock('@/lib/knowledge/embeddings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/knowledge/embeddings')>()),
  getConfiguredKbEmbedding: async () => fixture.target,
}))

import { resolveBillingAttribution } from '@/lib/billing/core/attribution'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { exportKnowledgeBase } from '@/lib/knowledge/application/exports'
import {
  completeKnowledgeImport,
  createKnowledgeImport,
  readKnowledgeImport,
} from '@/lib/knowledge/application/imports'
import { KNOWLEDGE_DOCUMENT_PROCESSING_OUTBOX_EVENT } from '@/lib/knowledge/documents/processing-events'
import { KNOWLEDGE_STORAGE_CLEANUP_EVENT } from '@/lib/knowledge/documents/storage-cleanup-event'
import { buildKnowledgeBundleArchive } from '@/lib/knowledge/transfer/export-archive'
import {
  findKnowledgeImport,
  insertKnowledgeImport,
  KNOWLEDGE_IMPORT_STORAGE_CONTEXT,
  stopKnowledgeImport,
} from '@/lib/knowledge/transfer/import-jobs'
import { runKnowledgeImport } from '@/lib/knowledge/transfer/import-runner'
import { embeddingVectorColumn, embeddingVectorValues } from '@/lib/knowledge/vector-columns'
import { downloadFile, uploadFile } from '@/lib/uploads/core/storage-service'
import { writeLocalPutObject } from '@/lib/uploads/upload-session/provider'
import { uploadSessionObjectMetadata } from '@/lib/uploads/upload-session/service'
import { runCleanupStaleExecutions } from '@/background/cleanup-stale-executions'

const ids = createKnowledgeAclFixtureIds()
const session = { kind: 'session' as const, userId: ids.aliceId, sessionId: generateId() }
const FIRST_VECTOR = [1, ...Array<number>(1535).fill(0)]
const SECOND_VECTOR = [0, 1, ...Array<number>(1534).fill(0)]

async function seedSourceDocument(options: {
  filename: string
  chunks: { content: string; vector: number[]; enabled: boolean }[]
  enabled: boolean
  inlineFile: boolean
}) {
  const text = options.chunks.map((chunk) => chunk.content).join('\n')
  const id = generateId()
  await db.insert(document).values({
    id,
    knowledgeBaseId: ids.knowledgeBaseId,
    filename: options.filename,
    fileUrl: options.inlineFile
      ? `data:text/plain;base64,${Buffer.from(text).toString('base64')}`
      : '',
    fileSize: options.inlineFile ? Buffer.byteLength(text) : 0,
    mimeType: 'text/plain',
    processingStatus: 'completed',
    chunkCount: options.chunks.length,
    tokenCount: options.chunks.length * 4,
    characterCount: text.length,
    enabled: options.enabled,
    tag1: 'public',
    acl: ['ws'],
    aclRequirements: [],
    aclVerifiedAt: new Date(),
  })
  await db.insert(embedding).values(
    options.chunks.map((chunk, chunkIndex) => ({
      id: generateId(),
      documentId: id,
      knowledgeBaseId: ids.knowledgeBaseId,
      chunkIndex,
      ...embeddingVectorValues(1536, chunk.vector),
      chunkHash: sha256Hex(chunk.content),
      content: chunk.content,
      contentLength: chunk.content.length,
      tokenCount: 4,
      startOffset: 0,
      endOffset: chunk.content.length,
      enabled: chunk.enabled,
      tag1: 'public',
    }))
  )
}

async function exportedBundleBytes(): Promise<Buffer> {
  const bundle = await exportKnowledgeBase.execute({
    principal: session,
    input: {
      knowledgeBaseId: ids.knowledgeBaseId,
      assertedWorkspaceId: ids.workspaceId,
      vectors: true,
    },
  })
  const buffers: Buffer[] = []
  for await (const chunk of buildKnowledgeBundleArchive(bundle)) buffers.push(Buffer.from(chunk))
  return Buffer.concat(buffers)
}

/** Exports the fixture base and stages the archive where a completed import upload leaves it. */
async function stageExportedBundle(importId: string): Promise<string> {
  return stageBundleBytes(importId, await exportedBundleBytes())
}

async function stageBundleBytes(importId: string, bytes: Buffer): Promise<string> {
  const sourceKey = `knowledge-import/${ids.workspaceId}/${importId}/bundle.simkb.zip`
  await uploadFile({
    file: bytes,
    fileName: 'bundle.simkb.zip',
    contentType: 'application/zip',
    context: KNOWLEDGE_IMPORT_STORAGE_CONTEXT,
    customKey: sourceKey,
    preserveKey: true,
    persistMetadata: false,
  })
  await insertKnowledgeImport({
    id: importId,
    workspaceId: ids.workspaceId,
    userId: ids.aliceId,
    sourceKey,
  })
  return sourceKey
}

async function runImport(importId: string, sourceKey: string, name: string) {
  await runKnowledgeImport(await importPayload(importId, sourceKey, name))
  const record = await findKnowledgeImport({ importId, assertedWorkspaceId: ids.workspaceId })
  if (!record) throw new Error('Import record disappeared')
  return record
}

async function importPayload(importId: string, sourceKey: string, name: string) {
  return {
    importId,
    workspaceId: ids.workspaceId,
    userId: ids.aliceId,
    name,
    sourceKey,
    billingAttribution: await resolveBillingAttribution({
      actorUserId: ids.aliceId,
      workspaceId: ids.workspaceId,
    }),
  }
}

async function importedDocuments(knowledgeBaseId: string) {
  return db
    .select({
      id: document.id,
      filename: document.filename,
      fileUrl: document.fileUrl,
      mimeType: document.mimeType,
      enabled: document.enabled,
      processingStatus: document.processingStatus,
      chunkCount: document.chunkCount,
      tag1: document.tag1,
    })
    .from(document)
    .where(eq(document.knowledgeBaseId, knowledgeBaseId))
    .orderBy(asc(document.filename))
}

async function importedChunks(documentId: string) {
  return db
    .select({
      content: embedding.content,
      enabled: embedding.enabled,
      tag1: embedding.tag1,
      vector: embeddingVectorColumn(1536),
    })
    .from(embedding)
    .where(eq(embedding.documentId, documentId))
    .orderBy(asc(embedding.chunkIndex))
}

beforeAll(async () => {
  fixture.root = mkdtempSync(path.join(tmpdir(), 'sim-knowledge-import-'))
  await seedKnowledgeAclFixture(ids)
  await seedSourceDocument({
    filename: 'handbook.txt',
    inlineFile: true,
    enabled: true,
    chunks: [
      { content: 'Refunds are issued within 14 days.', vector: FIRST_VECTOR, enabled: true },
      { content: 'Archived policy text.', vector: SECOND_VECTOR, enabled: false },
    ],
  })
  await seedSourceDocument({
    filename: 'notes.txt',
    inlineFile: false,
    enabled: false,
    chunks: [
      { content: 'Chunk text with no original file.', vector: SECOND_VECTOR, enabled: true },
    ],
  })
})
afterEach(() => {
  fixture.embedded = 0
  fixture.target = { model: 'text-embedding-3-small', dimensions: 1536 }
})
afterAll(async () => {
  const workspaceBases = sql`SELECT ${knowledgeBase.id} FROM ${knowledgeBase} WHERE ${knowledgeBase.workspaceId} = ${ids.workspaceId}`
  await db
    .delete(outboxEvent)
    .where(
      sql`${outboxEvent.payload}::jsonb ->> 'knowledgeBaseId' IN (${workspaceBases}) OR ${outboxEvent.payload}::jsonb ->> 'documentId' IN (SELECT ${document.id} FROM ${document} WHERE ${document.knowledgeBaseId} IN (${workspaceBases}))`
    )
  await db.delete(auditLog).where(eq(auditLog.workspaceId, ids.workspaceId))
  await db.delete(knowledgeBase).where(eq(knowledgeBase.workspaceId, ids.workspaceId))
  await deleteWorkspaceFixture(db, eq(workspace.id, ids.workspaceId))
  await db.delete(organization).where(eq(organization.id, ids.organizationId))
  await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
  await rm(fixture.root, { recursive: true, force: true })
  await db.$client.end()
})

describe('knowledge base bundle import', () => {
  it('recreates an exported base and indexes it from the bundle when the embedding model matches', async () => {
    const importId = generateId()
    const sourceKey = await stageExportedBundle(importId)

    const record = await runImport(importId, sourceKey, 'Imported fixture')

    expect(record).toMatchObject({
      status: 'completed',
      documentsTotal: 2,
      documentsImported: 2,
      documentsFailed: 0,
      vectorsReused: true,
      failures: [],
      error: null,
    })
    const knowledgeBaseId = record.knowledgeBaseId
    if (!knowledgeBaseId) throw new Error('Import did not link its knowledge base')
    const [created] = await db
      .select()
      .from(knowledgeBase)
      .where(eq(knowledgeBase.id, knowledgeBaseId))
    expect(created).toMatchObject({
      name: 'Imported fixture',
      workspaceId: ids.workspaceId,
      userId: ids.aliceId,
      embeddingModel: 'text-embedding-3-small',
      chunkingConfig: { maxSize: 1024, minSize: 1, overlap: 20 },
    })
    expect(
      await db
        .select({
          tagSlot: knowledgeBaseTagDefinitions.tagSlot,
          displayName: knowledgeBaseTagDefinitions.displayName,
        })
        .from(knowledgeBaseTagDefinitions)
        .where(eq(knowledgeBaseTagDefinitions.knowledgeBaseId, knowledgeBaseId))
    ).toEqual([{ tagSlot: 'tag1', displayName: 'Fixture' }])

    const [handbook, notes] = await importedDocuments(knowledgeBaseId)
    expect(handbook).toMatchObject({
      filename: 'handbook.txt',
      enabled: true,
      processingStatus: 'completed',
      chunkCount: 2,
      tag1: 'public',
    })
    expect(handbook.fileUrl).toMatch(/^\/api\/files\/serve\/kb\/.+\?context=knowledge-base$/)
    expect(
      await db
        .select({ status: outboxEvent.status })
        .from(outboxEvent)
        .where(
          and(
            eq(outboxEvent.eventType, KNOWLEDGE_STORAGE_CLEANUP_EVENT),
            sql`${outboxEvent.payload}::jsonb ->> 'documentId' = ${handbook.id}`
          )
        )
    ).toEqual([{ status: 'completed' }])
    expect(notes).toMatchObject({
      filename: 'notes.txt',
      mimeType: 'text/plain',
      enabled: false,
      processingStatus: 'completed',
      chunkCount: 1,
    })
    expect(
      (
        await downloadFile({
          key: decodeURIComponent(notes.fileUrl.split('?')[0].replace('/api/files/serve/', '')),
          context: 'knowledge-base',
        })
      ).toString()
    ).toBe('Chunk text with no original file.')
    expect(await importedChunks(handbook.id)).toEqual([
      {
        content: 'Refunds are issued within 14 days.',
        enabled: true,
        tag1: 'public',
        vector: FIRST_VECTOR,
      },
      { content: 'Archived policy text.', enabled: false, tag1: 'public', vector: SECOND_VECTOR },
    ])
    expect(fixture.embedded).toBe(0)
    await expect(
      downloadFile({ key: sourceKey, context: KNOWLEDGE_IMPORT_STORAGE_CONTEXT })
    ).rejects.toThrow()
  })

  it('queues documents with a file for processing and re-embeds chunk-only ones when the model differs', async () => {
    fixture.target = { model: 'text-embedding-3-large', dimensions: 1536 }
    const importId = generateId()
    const sourceKey = await stageExportedBundle(importId)

    const record = await runImport(importId, sourceKey, 'Re-embedded fixture')

    expect(record).toMatchObject({
      status: 'completed',
      documentsImported: 2,
      documentsFailed: 0,
      vectorsReused: false,
    })
    const knowledgeBaseId = record.knowledgeBaseId
    if (!knowledgeBaseId) throw new Error('Import did not link its knowledge base')
    const [handbook, notes] = await importedDocuments(knowledgeBaseId)
    expect(handbook.processingStatus).toBe('pending')
    expect(await importedChunks(handbook.id)).toEqual([])
    const queued = await db
      .select({ id: outboxEvent.id })
      .from(outboxEvent)
      .where(
        and(
          eq(outboxEvent.eventType, KNOWLEDGE_DOCUMENT_PROCESSING_OUTBOX_EVENT),
          sql`${outboxEvent.payload}::jsonb ->> 'documentId' = ${handbook.id}`
        )
      )
    expect(queued).toHaveLength(1)
    expect(notes.processingStatus).toBe('completed')
    expect(fixture.embedded).toBe(1)
    expect(await importedChunks(notes.id)).toEqual([
      {
        content: 'Chunk text with no original file.',
        enabled: true,
        tag1: 'public',
        vector: [0, 0, 1, ...Array<number>(1533).fill(0)],
      },
    ])
  })

  it('fails an archive that is not a bundle without creating a knowledge base', async () => {
    const importId = generateId()
    const sourceKey = await stageBundleBytes(importId, Buffer.from('not a zip archive'))

    const record = await runImport(importId, sourceKey, 'Never created')

    expect(record).toMatchObject({
      status: 'failed',
      knowledgeBaseId: null,
      error: 'Invalid knowledge base bundle: not a zip archive',
    })
    expect(
      await db
        .select({ id: knowledgeBase.id })
        .from(knowledgeBase)
        .where(eq(knowledgeBase.name, 'Never created'))
    ).toEqual([])
    await expect(
      downloadFile({ key: sourceKey, context: KNOWLEDGE_IMPORT_STORAGE_CONTEXT })
    ).rejects.toThrow()
  })

  it('fails a bundle with a damaged chunk entry before creating anything', async () => {
    const zip = new JSZip()
    zip.file('chunks/doc-1.ndjson', '{"index": 0, "content": "half a line"\n')
    zip.file(
      'manifest.json',
      JSON.stringify({
        version: 1,
        exportedAt: '2026-10-01T00:00:00.000Z',
        embedding: { model: 'text-embedding-3-small', dimension: 1536, vectorsIncluded: false },
        knowledgeBase: {
          name: 'Damaged fixture',
          description: null,
          chunkingConfig: { maxSize: 1024, minSize: 1, overlap: 20 },
        },
        tags: [],
        documents: [
          {
            id: 'doc-1',
            filename: 'notes.txt',
            mimeType: 'text/plain',
            fileSize: 0,
            enabled: true,
            tags: {},
            file: null,
            chunks: 'chunks/doc-1.ndjson',
            chunkCount: 1,
            tokenCount: 1,
            characterCount: 11,
          },
        ],
      })
    )
    const importId = generateId()
    const sourceKey = await stageBundleBytes(
      importId,
      await zip.generateAsync({ type: 'nodebuffer' })
    )

    const record = await runImport(importId, sourceKey, 'Damaged fixture')

    expect(record).toMatchObject({ status: 'failed', knowledgeBaseId: null, documentsTotal: 0 })
    expect(record.error).toContain('chunks/doc-1.ndjson line 1 is not valid JSON')
    expect(
      await db
        .select({ id: knowledgeBase.id })
        .from(knowledgeBase)
        .where(eq(knowledgeBase.name, 'Damaged fixture'))
    ).toEqual([])
  })

  it('creates no base for an import canceled before its worker reached it', async () => {
    const importId = generateId()
    const sourceKey = await stageExportedBundle(importId)
    const staged = await findKnowledgeImport({ importId })
    if (!staged) throw new Error('Import was not staged')
    await stopKnowledgeImport(staged)

    const record = await runImport(importId, sourceKey, 'Canceled fixture')

    expect(record).toMatchObject({ status: 'canceled', knowledgeBaseId: null })
    expect(
      await db
        .select({ id: knowledgeBase.id })
        .from(knowledgeBase)
        .where(eq(knowledgeBase.name, 'Canceled fixture'))
    ).toEqual([])
    await expect(
      downloadFile({ key: sourceKey, context: KNOWLEDGE_IMPORT_STORAGE_CONTEXT })
    ).rejects.toThrow()
  })

  it('lets exactly one of two concurrent workers run an import', async () => {
    const importId = generateId()
    const sourceKey = await stageExportedBundle(importId)
    const payload = await importPayload(importId, sourceKey, 'Claimed fixture')

    await Promise.all([runKnowledgeImport(payload), runKnowledgeImport(payload)])

    expect(await findKnowledgeImport({ importId })).toMatchObject({
      status: 'completed',
      knowledgeBaseId: importId,
      documentsImported: 2,
      documentsFailed: 0,
    })
    expect(
      await db
        .select({ id: knowledgeBase.id })
        .from(knowledgeBase)
        .where(eq(knowledgeBase.name, 'Claimed fixture'))
    ).toEqual([{ id: importId }])
  })

  it('fails without a partial base when the name is already taken', async () => {
    const importId = generateId()
    const sourceKey = await stageExportedBundle(importId)

    const record = await runImport(importId, sourceKey, 'Search fixture')

    expect(record.status).toBe('failed')
    expect(record.knowledgeBaseId).toBeNull()
    expect(record.error).toContain('A knowledge base named "Search fixture" already exists')
    expect(
      await db
        .select({ id: knowledgeBase.id })
        .from(knowledgeBase)
        .where(
          and(
            eq(knowledgeBase.workspaceId, ids.workspaceId),
            eq(knowledgeBase.name, 'Search fixture')
          )
        )
    ).toEqual([{ id: ids.knowledgeBaseId }])
    await expect(
      downloadFile({ key: sourceKey, context: KNOWLEDGE_IMPORT_STORAGE_CONTEXT })
    ).rejects.toThrow()
  })
})

describe('knowledge base import requests', () => {
  const request = { headers: new Headers({ origin: 'http://localhost:3000' }) }

  it('creates an import, completes its upload once, and runs it to a new base', async () => {
    const bytes = await exportedBundleBytes()
    const created = await createKnowledgeImport.execute({
      principal: session,
      input: {
        body: {
          workspaceId: ids.workspaceId,
          name: 'Requested import',
          source: {
            type: 'upload',
            name: 'fixture.simkb.zip',
            contentType: 'application/zip',
            size: bytes.length,
          },
        },
      },
      request,
    })
    expect(created.import).toMatchObject({ status: 'uploading', knowledgeBaseId: null })
    await writeLocalPutObject({
      uploadId: created.upload.id,
      key: created.upload.finalKey,
      body: new Blob([new Uint8Array(bytes)]).stream(),
      expectedSize: bytes.length,
      contentType: created.upload.contentType,
      metadata: uploadSessionObjectMetadata(created.upload),
    })
    const input = {
      importId: created.import.id,
      workspaceId: ids.workspaceId,
      uploadToken: created.upload.uploadToken,
    }

    const completed = await completeKnowledgeImport.execute({ principal: session, input, request })
    const repeated = await completeKnowledgeImport.execute({ principal: session, input, request })

    expect(completed.import.id).toBe(created.import.id)
    expect(repeated.import.id).toBe(created.import.id)
    await expect
      .poll(
        async () =>
          (await readKnowledgeImport.execute({ principal: session, input })).import.status,
        { interval: 50, timeout: 10_000 }
      )
      .toBe('completed')
    const { import: finished } = await readKnowledgeImport.execute({ principal: session, input })
    expect(finished).toMatchObject({
      documentsImported: 2,
      documentsFailed: 0,
      vectorsReused: true,
    })
    expect(
      await db
        .select({ id: knowledgeBase.id })
        .from(knowledgeBase)
        .where(eq(knowledgeBase.name, 'Requested import'))
    ).toEqual([{ id: finished.knowledgeBaseId }])
    await expect
      .poll(async () =>
        db
          .select({ resourceId: auditLog.resourceId })
          .from(auditLog)
          .where(
            and(
              eq(auditLog.workspaceId, ids.workspaceId),
              eq(auditLog.action, 'knowledge_base.import_started')
            )
          )
      )
      .toEqual([{ resourceId: finished.knowledgeBaseId }])
  })

  it('starts an import whose first dispatch was lost when its completion is retried', async () => {
    const bytes = await exportedBundleBytes()
    const created = await createKnowledgeImport.execute({
      principal: session,
      input: {
        body: {
          workspaceId: ids.workspaceId,
          name: 'Redispatched import',
          source: {
            type: 'upload',
            name: 'fixture.simkb.zip',
            contentType: 'application/zip',
            size: bytes.length,
          },
        },
      },
      request,
    })
    await writeLocalPutObject({
      uploadId: created.upload.id,
      key: created.upload.finalKey,
      body: new Blob([new Uint8Array(bytes)]).stream(),
      expectedSize: bytes.length,
      contentType: created.upload.contentType,
      metadata: uploadSessionObjectMetadata(created.upload),
    })
    // The record a completion wrote before the request died, with no worker behind it.
    await insertKnowledgeImport({
      id: created.upload.id,
      workspaceId: ids.workspaceId,
      userId: ids.aliceId,
      sourceKey: created.upload.storageKey,
    })
    const input = {
      importId: created.import.id,
      workspaceId: ids.workspaceId,
      uploadToken: created.upload.uploadToken,
    }

    await completeKnowledgeImport.execute({ principal: session, input, request })

    await expect
      .poll(
        async () =>
          (await readKnowledgeImport.execute({ principal: session, input })).import.status,
        { interval: 50, timeout: 10_000 }
      )
      .toBe('completed')
    expect(
      await db
        .select({ id: knowledgeBase.id })
        .from(knowledgeBase)
        .where(eq(knowledgeBase.name, 'Redispatched import'))
    ).toEqual([{ id: created.import.id }])
    await expect
      .poll(async () =>
        db
          .select({ resourceId: auditLog.resourceId })
          .from(auditLog)
          .where(
            and(
              eq(auditLog.workspaceId, ids.workspaceId),
              eq(auditLog.resourceId, created.import.id)
            )
          )
      )
      .toEqual([{ resourceId: created.import.id }])
  })

  it('refuses a bundle that is not a zip archive before creating an upload', async () => {
    const importUploads = () =>
      db
        .select({ id: uploadSession.id })
        .from(uploadSession)
        .where(
          and(
            eq(uploadSession.workspaceId, ids.workspaceId),
            eq(uploadSession.purpose, 'knowledge_import')
          )
        )
    const before = await importUploads()
    await expect(
      createKnowledgeImport.execute({
        principal: session,
        input: {
          body: {
            workspaceId: ids.workspaceId,
            source: {
              type: 'upload',
              name: 'fixture.tar',
              contentType: 'application/x-tar',
              size: 10,
            },
          },
        },
        request,
      })
    ).rejects.toThrow('A knowledge base bundle must be a .zip archive')
    expect(await importUploads()).toEqual(before)
  })
})

describe('stale knowledge import cleanup', () => {
  async function seedProcessingDocument(processingQueueToken: string | null) {
    const id = generateId()
    await db.insert(document).values({
      id,
      knowledgeBaseId: ids.knowledgeBaseId,
      filename: 'stranded.txt',
      fileUrl: '',
      fileSize: 0,
      mimeType: 'text/plain',
      processingStatus: 'processing',
      processingStartedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      processingQueueToken,
    })
    return id
  }

  async function processingStatus(documentId: string) {
    const [row] = await db
      .select({ status: document.processingStatus })
      .from(document)
      .where(eq(document.id, documentId))
    return row?.status
  }

  it('fails an import whose worker went silent, its stranded documents, and its bundle, and prunes settled imports with theirs', async () => {
    const staleId = generateId()
    const staleBundle = await stageBundleBytes(staleId, Buffer.from('bundle bytes'))
    const settledId = generateId()
    const settledBundle = await stageBundleBytes(settledId, Buffer.from('bundle bytes'))
    const stranded = await seedProcessingDocument(null)
    const queued = await seedProcessingDocument('queue-token')
    const longAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    await db
      .update(knowledgeBaseImport)
      .set({
        knowledgeBaseId: ids.knowledgeBaseId,
        updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      })
      .where(eq(knowledgeBaseImport.id, staleId))
    await db
      .update(knowledgeBaseImport)
      .set({ status: 'canceled', updatedAt: longAgo, completedAt: longAgo })
      .where(eq(knowledgeBaseImport.id, settledId))

    await runCleanupStaleExecutions()

    const stale = await findKnowledgeImport({ importId: staleId })
    expect(stale).toMatchObject({ status: 'failed' })
    expect(stale?.error).toContain('no progress')
    expect(await processingStatus(stranded)).toBe('failed')
    expect(await processingStatus(queued)).toBe('processing')
    expect(await findKnowledgeImport({ importId: settledId })).toBeNull()
    for (const key of [staleBundle, settledBundle]) {
      await expect(
        downloadFile({ key, context: KNOWLEDGE_IMPORT_STORAGE_CONTEXT })
      ).rejects.toThrow()
    }
  })
})
