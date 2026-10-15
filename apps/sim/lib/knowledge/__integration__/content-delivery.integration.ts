/** Real PostgreSQL content admission, pagination, captured metadata, and streamed ZIP readback. */
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as audit from '@sim/audit'
import { db } from '@sim/db'
import {
  auditLog,
  document,
  embedding,
  knowledgeBase,
  organization,
  user,
  workspace,
} from '@sim/db/schema'
import { deleteWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { sha256Hex } from '@sim/security/hash'
import { createExecutorPrincipal } from '@sim/testing/factories/principal.factory'
import { generateId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import { eq, inArray } from 'drizzle-orm'
import { PostgresJsPreparedQuery } from 'drizzle-orm/postgres-js/session'
import JSZip from 'jszip'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const fixtureStorage = vi.hoisted(() => ({ root: '' }))
vi.mock('@/lib/uploads/core/setup.server', () => ({
  get UPLOAD_DIR_SERVER() {
    return fixtureStorage.root
  },
}))

import { observeContentDelivery } from '@/lib/core/application'
import { encryptSecret } from '@/lib/core/security/encryption'
import type { DurableSecretProvenance } from '@/lib/execution/durable-secret-provenance'
import {
  PRIVATE_TOOL_METADATA_REQUEST_HEADER,
  RESOLVED_SECRET_PROVENANCE_FIELD,
  RESOLVED_SECRET_PROVENANCE_METADATA_V1,
} from '@/lib/execution/private-tool-metadata'
import { listDocumentsOperation } from '@/lib/internal/knowledge/operations'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { admitKnowledgeChunks } from '@/lib/knowledge/application/admit-knowledge-content'
import { KNOWLEDGE_DELEGATION_AUDIENCE } from '@/lib/knowledge/application/authorization'
import { listKnowledgeChunks } from '@/lib/knowledge/application/chunks'
import * as knowledgeContexts from '@/lib/knowledge/application/contexts'
import { listKnowledgeDocuments } from '@/lib/knowledge/application/documents'
import {
  exportKnowledgeBase,
  type KnowledgeBaseExportBundle,
} from '@/lib/knowledge/application/exports'
import { readOriginalKnowledgeDocument } from '@/lib/knowledge/application/read-original-document'
import {
  readDetailedKnowledgeTagUsage,
  readKnowledgeTagUsage,
} from '@/lib/knowledge/application/tags'
import * as documentService from '@/lib/knowledge/documents/service'
import {
  bindKnowledgeDocumentFieldSecretProvenance,
  classifyKnowledgeDocumentMetadata,
  createKnowledgeDocumentSourceValue,
  replaceKnowledgeDocumentSecretProvenanceInTx,
  replaceKnowledgeEmbeddingSecretProvenanceInTx,
} from '@/lib/knowledge/secret-provenance'
import { buildKnowledgeBundleArchive } from '@/lib/knowledge/transfer/export-archive'
import { embeddingVectorValues } from '@/lib/knowledge/vector-columns'
import { createCopilotChatPrincipal } from '@/lib/mothership/auth/application-delegation'
import { createRegistryContentGate } from '@/lib/mothership/content-delivery/registry-gate'
import { uploadFile } from '@/lib/uploads/core/storage-service'
import { projectResolvedSecretModelContent } from '@/executor/utils/resolved-secret-content-projection'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const SECRET = 'fixture-knowledge-token-41875'
const ids = createKnowledgeAclFixtureIds()
const principal = createCopilotChatPrincipal(
  { userId: ids.aliceId, workspaceId: ids.workspaceId },
  KNOWLEDGE_DELEGATION_AUDIENCE
)
const session = { kind: 'session' as const, userId: ids.aliceId, sessionId: generateId() }
let exact: DurableSecretProvenance
let submittedAudits = 0

function inChat<T>(read: () => T) {
  return observeContentDelivery(
    createRegistryContentGate({
      registry: new ResolvedSecretTraceRegistry([], {
        userId: ids.aliceId,
        workspaceId: ids.workspaceId,
      }),
      actorUserId: ids.aliceId,
      workspaceId: ids.workspaceId,
    }),
    read
  )
}

async function seedDocument(
  options: {
    name?: string
    content?: string
    provenance?: DurableSecretProvenance
    original?: boolean
    contentHash?: string | null
  } = {}
) {
  const content = options.content ?? 'page public content'
  const id = generateId()
  const [row] = await db
    .insert(document)
    .values({
      id,
      knowledgeBaseId: ids.knowledgeBaseId,
      filename: options.name ?? 'page.txt',
      contentHash: options.contentHash ?? null,
      fileUrl:
        options.original === false
          ? ''
          : `data:text/plain;base64,${Buffer.from(content).toString('base64')}`,
      fileSize: Buffer.byteLength(content),
      mimeType: 'text/plain',
      processingStatus: 'completed',
      chunkCount: 1,
      tag1: 'public',
      acl: ['ws'],
      aclRequirements: [],
      aclVerifiedAt: new Date(),
    })
    .returning()
  const provenance = options.provenance
  if (provenance)
    await db.transaction((tx) =>
      replaceKnowledgeDocumentSecretProvenanceInTx(
        tx,
        id,
        createKnowledgeDocumentSourceValue(row),
        provenance
      )
    )
  const chunkId = await seedChunk(id, 0, content)
  return { id, chunkId, content }
}

async function seedChunk(
  documentId: string,
  index: number,
  content: string,
  provenance?: DurableSecretProvenance
) {
  const id = generateId()
  await db.insert(embedding).values({
    id,
    documentId,
    knowledgeBaseId: ids.knowledgeBaseId,
    chunkIndex: index,
    ...embeddingVectorValues(1536, [1, ...Array<number>(1535).fill(0)]),
    chunkHash: sha256Hex(content),
    content,
    contentLength: content.length,
    tokenCount: 4,
    startOffset: 0,
    endOffset: content.length,
    tag1: 'public',
  })
  if (provenance)
    await db.transaction((tx) =>
      replaceKnowledgeEmbeddingSecretProvenanceInTx(tx, id, content, provenance)
    )
  return id
}

async function exportedBundle(human = false) {
  return inChat(() =>
    exportKnowledgeBase.execute({
      principal: human ? session : principal,
      input: { knowledgeBaseId: ids.knowledgeBaseId, vectors: false },
    })
  )
}

async function archiveBytes(bundle: KnowledgeBaseExportBundle) {
  const buffers: Buffer[] = []
  for await (const chunk of buildKnowledgeBundleArchive(bundle)) buffers.push(Buffer.from(chunk))
  return Buffer.concat(buffers)
}

async function drainAudits() {
  await vi.waitFor(async () =>
    expect(
      await db
        .select({ id: auditLog.id })
        .from(auditLog)
        .where(eq(auditLog.workspaceId, ids.workspaceId))
    ).toHaveLength(submittedAudits)
  )
}

beforeAll(async () => {
  fixtureStorage.root = mkdtempSync(path.join(tmpdir(), 'sim-knowledge-delivery-'))
  await seedKnowledgeAclFixture(ids)
  const record = audit.recordAudit
  vi.spyOn(audit, 'recordAudit').mockImplementation((entry) => {
    if (entry.workspaceId === ids.workspaceId) submittedAudits += 1
    record(entry)
  })
  const recordBatch = audit.recordAuditBatch
  vi.spyOn(audit, 'recordAuditBatch').mockImplementation((entries) => {
    submittedAudits += entries.filter((entry) => entry.workspaceId === ids.workspaceId).length
    recordBatch(entries)
  })
  exact = {
    status: 'exact',
    entries: [
      {
        encryptedValue: (await encryptSecret(SECRET)).encrypted,
        sourceUserId: ids.aliceId,
        sourceWorkspaceId: ids.workspaceId,
        name: 'FIXTURE_TOKEN',
      },
    ],
  }
})
afterEach(async () => {
  await drainAudits()
  await db.delete(document).where(eq(document.knowledgeBaseId, ids.knowledgeBaseId))
})
afterAll(async () => {
  await drainAudits()
  vi.restoreAllMocks()
  await db.delete(auditLog).where(eq(auditLog.workspaceId, ids.workspaceId))
  await db.delete(knowledgeBase).where(eq(knowledgeBase.id, ids.knowledgeBaseId))
  await deleteWorkspaceFixture(db, eq(workspace.id, ids.workspaceId))
  await db.delete(organization).where(eq(organization.id, ids.organizationId))
  await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
  await rm(fixtureStorage.root, { recursive: true, force: true })
  await db.$client.end()
})

describe('knowledge content delivery', () => {
  it.each([null, sha256Hex('stable connector source')])(
    'keeps workflow list provenance complete for an unchanged document with content hash %s',
    async (contentHash) => {
      const doc = await seedDocument({
        name: `${SECRET}.txt`,
        contentHash,
        provenance: bindKnowledgeDocumentFieldSecretProvenance(exact, 'filename', `${SECRET}.txt`),
      })
      const context = {
        principal: createExecutorPrincipal({
          subjectUserId: ids.aliceId,
          workspaceId: ids.workspaceId,
          audience: KNOWLEDGE_DELEGATION_AUDIENCE,
          delegationContext: { kind: 'workflow_execution' as const, workflowId: generateId() },
        }),
        headers: new Headers({
          [PRIVATE_TOOL_METADATA_REQUEST_HEADER]: RESOLVED_SECRET_PROVENANCE_METADATA_V1,
        }),
      }
      const result = await listDocumentsOperation(
        ids.knowledgeBaseId,
        { limit: 50, offset: 0 },
        context
      )
      const provenance = result.bodyFields?.[RESOLVED_SECRET_PROVENANCE_FIELD]
      expect(provenance).toMatchObject({ complete: true })
      expect(result.body).toMatchObject({
        data: { documents: [{ id: doc.id, filename: `${SECRET}.txt` }] },
      })
      expect(JSON.stringify(result.body)).not.toContain('contentHash')
      const registry = new ResolvedSecretTraceRegistry([], {
        userId: ids.aliceId,
        workspaceId: ids.workspaceId,
      })
      expect(await registry.importProvenance(provenance, { trusted: true })).toBe(true)
      const projected = projectResolvedSecretModelContent(result.body, registry)
      expect(projected.safe).toBe(true)
      expect(JSON.stringify(projected)).toContain('{{FIXTURE_TOKEN}}.txt')
      expect(JSON.stringify(projected)).not.toContain(SECRET)

      const read = documentService.getDocuments
      const replace = vi
        .spyOn(documentService, 'getDocuments')
        .mockImplementation(async (...args) => {
          const snapshot = await read(...args)
          await db.transaction(async (tx) => {
            const [replacement] = await tx
              .update(document)
              .set({ contentHash: sha256Hex('replacement connector source') })
              .where(eq(document.id, doc.id))
              .returning()
            await replaceKnowledgeDocumentSecretProvenanceInTx(
              tx,
              doc.id,
              createKnowledgeDocumentSourceValue(replacement),
              bindKnowledgeDocumentFieldSecretProvenance(exact, 'filename', `${SECRET}.txt`)
            )
          })
          return snapshot
        })
      try {
        const changed = await listDocumentsOperation(
          ids.knowledgeBaseId,
          { limit: 50, offset: 0 },
          context
        )
        expect(changed.bodyFields?.[RESOLVED_SECRET_PROVENANCE_FIELD]).toMatchObject({
          complete: false,
        })
      } finally {
        replace.mockRestore()
      }
    }
  )

  it('classifies a mixed metadata page without materializing multiple inline originals together', async () => {
    const content = 'inline source content '.repeat(8192)
    const legacy = await seedDocument({ content })
    const clean = await seedDocument({ content, provenance: { status: 'exact', entries: [] } })
    const unknown = await seedDocument({ content, provenance: { status: 'unknown' } })
    const tracked = await seedDocument({ content })
    const [trackedRow] = await db
      .update(document)
      .set({ tag1: SECRET })
      .where(eq(document.id, tracked.id))
      .returning()
    await db.transaction((tx) =>
      replaceKnowledgeDocumentSecretProvenanceInTx(
        tx,
        tracked.id,
        createKnowledgeDocumentSourceValue(trackedRow),
        bindKnowledgeDocumentFieldSecretProvenance(exact, 'tag1', SECRET)
      )
    )
    const originalBytes = Buffer.byteLength(
      `data:text/plain;base64,${Buffer.from(content).toString('base64')}`
    )
    let peakOriginalBytes = 0
    const execute = PostgresJsPreparedQuery.prototype.execute
    const measure = vi
      .spyOn(PostgresJsPreparedQuery.prototype, 'execute')
      .mockImplementation(async function (this: typeof PostgresJsPreparedQuery.prototype, values) {
        const rows = await execute.call(this, values)
        if (Array.isArray(rows)) {
          let bytes = 0
          for (const row of rows) {
            if (!isRecordLike(row)) continue
            const value = row.fileUrl
            if (typeof value === 'string' && value.startsWith('data:'))
              bytes += Buffer.byteLength(value)
          }
          peakOriginalBytes = Math.max(peakOriginalBytes, bytes)
        }
        return rows
      })
    try {
      const result = await classifyKnowledgeDocumentMetadata([
        legacy.id,
        clean.id,
        unknown.id,
        tracked.id,
      ])
      expect(result.get(legacy.id)).toEqual({ status: 'exact', entries: [] })
      expect(result.get(clean.id)).toEqual({ status: 'exact', entries: [] })
      expect(result.get(unknown.id)).toEqual({ status: 'unknown' })
      expect(result.get(tracked.id)).toMatchObject({
        status: 'exact',
        entries: [{ name: 'FIXTURE_TOKEN' }],
      })
      expect(peakOriginalBytes).toBeGreaterThan(0)
      expect(peakOriginalBytes).toBeLessThanOrEqual(originalBytes)
    } finally {
      measure.mockRestore()
    }
  })

  it('streams chunk pages without reloading the tracked inline original for each page', async () => {
    const content = 'inline original content '.repeat(4096)
    const doc = await seedDocument({ content, provenance: { status: 'exact', entries: [] } })
    await db.insert(embedding).values(
      Array.from({ length: 100 }, (_, index) => {
        const text = `public exported chunk ${index + 1}`
        return {
          id: generateId(),
          documentId: doc.id,
          knowledgeBaseId: ids.knowledgeBaseId,
          chunkIndex: index + 1,
          ...embeddingVectorValues(1536, [1, ...Array<number>(1535).fill(0)]),
          chunkHash: sha256Hex(text),
          content: text,
          contentLength: text.length,
          tokenCount: 4,
          startOffset: 0,
          endOffset: text.length,
          tag1: 'public',
        }
      })
    )
    const bundle = await inChat(() =>
      exportKnowledgeBase.execute({
        principal,
        input: { knowledgeBaseId: ids.knowledgeBaseId, vectors: true },
      })
    )
    const originalBytes = Buffer.byteLength(
      `data:text/plain;base64,${Buffer.from(content).toString('base64')}`
    )
    let loadedOriginalBytes = 0
    const execute = PostgresJsPreparedQuery.prototype.execute
    const measure = vi
      .spyOn(PostgresJsPreparedQuery.prototype, 'execute')
      .mockImplementation(async function (this: typeof PostgresJsPreparedQuery.prototype, values) {
        const rows = await execute.call(this, values)
        if (Array.isArray(rows)) {
          for (const row of rows) {
            if (!isRecordLike(row)) continue
            const value = row.fileUrl
            if (typeof value === 'string' && value.startsWith('data:'))
              loadedOriginalBytes += Buffer.byteLength(value)
          }
        }
        return rows
      })
    try {
      const exported: string[] = []
      for await (const chunk of bundle.chunks(doc.id)) exported.push(chunk.content)
      expect(exported).toHaveLength(101)
      expect(exported[0]).toBe(content)
      expect(exported.at(-1)).toBe('public exported chunk 100')
      expect(loadedOriginalBytes).toBeGreaterThan(0)
      expect(loadedOriginalBytes).toBeLessThanOrEqual(originalBytes)
    } finally {
      measure.mockRestore()
    }
  })

  it('keeps stored search totals and continuation while withholding only unsafe documents', async () => {
    await seedDocument({ name: 'page-a.txt' })
    await seedDocument({ name: 'page-b.txt', provenance: { status: 'unknown' } })
    await seedDocument({ name: 'page-c.txt' })
    const result = await inChat(() =>
      listKnowledgeDocuments.execute({
        principal,
        input: {
          knowledgeBaseId: ids.knowledgeBaseId,
          search: 'page',
          limit: 2,
          sortBy: 'filename',
          sortOrder: 'asc',
        },
      })
    )
    expect(result.documents.map((row) => row.filename)).toEqual(['page-a.txt'])
    expect(result.pagination).toMatchObject({ total: 3, hasMore: true })
  })

  it('keeps chunk search totals and its next page when one matching chunk is withheld', async () => {
    const doc = await seedDocument()
    await seedChunk(doc.id, 1, 'page withheld content', { status: 'unknown' })
    await seedChunk(doc.id, 2, 'page final content')
    const result = await inChat(() =>
      listKnowledgeChunks.execute({
        principal,
        input: {
          knowledgeBaseId: ids.knowledgeBaseId,
          documentId: doc.id,
          search: 'page',
          limit: 2,
        },
      })
    )
    expect(result.chunks.map((row) => row.content)).toEqual(['page public content'])
    expect(result.pagination).toMatchObject({ total: 3, hasMore: true })
    expect(result.nextCursorKeys).not.toBeNull()
  })

  it('returns ordinary aggregate counts while admitting detailed tag metadata per document', async () => {
    const clean = await seedDocument()
    await seedDocument({ provenance: { status: 'unknown' } })
    const stats = await inChat(() =>
      readKnowledgeTagUsage.execute({ principal, input: { knowledgeBaseId: ids.knowledgeBaseId } })
    )
    expect(stats.usage.find((row) => row.tagSlot === 'tag1')).toMatchObject({
      documentCount: 2,
      chunkCount: 2,
    })
    const detail = await inChat(() =>
      readDetailedKnowledgeTagUsage.execute({
        principal,
        input: { knowledgeBaseId: ids.knowledgeBaseId },
      })
    )
    expect(detail.usage[0].documents.map((row) => row.id)).toEqual([clean.id])
  })

  it.each(['tag1', 'filename'] as const)(
    'binds captured chunk %s metadata to the row classified at delivery',
    async (field) => {
      const doc = await seedDocument()
      const captured = {
        id: doc.chunkId,
        documentId: doc.id,
        content: doc.content,
        value: { content: doc.content, [field]: SECRET },
      }
      await db
        .update(document)
        .set({ [field]: SECRET })
        .where(eq(document.id, doc.id))
      const [secretRow] = await db.select().from(document).where(eq(document.id, doc.id))
      await db.transaction((tx) =>
        replaceKnowledgeDocumentSecretProvenanceInTx(
          tx,
          doc.id,
          createKnowledgeDocumentSourceValue(secretRow),
          bindKnowledgeDocumentFieldSecretProvenance(exact, field, SECRET)
        )
      )
      const gate = createRegistryContentGate({
        registry: new ResolvedSecretTraceRegistry([], {
          userId: ids.aliceId,
          workspaceId: ids.workspaceId,
        }),
        actorUserId: ids.aliceId,
        workspaceId: ids.workspaceId,
      })
      expect(
        await observeContentDelivery(gate, () => admitKnowledgeChunks(principal, [captured]))
      ).toEqual(new Set([doc.chunkId]))
      expect(gate.project?.(SECRET)).toBe('{{FIXTURE_TOKEN}}')
      await db.transaction(async (tx) => {
        const [current] = await tx
          .update(document)
          .set({ [field]: 'public' })
          .where(eq(document.id, doc.id))
          .returning()
        await replaceKnowledgeDocumentSecretProvenanceInTx(
          tx,
          doc.id,
          createKnowledgeDocumentSourceValue(current),
          { status: 'exact', entries: [] }
        )
      })
      expect(await inChat(() => admitKnowledgeChunks(principal, [captured]))).toEqual(new Set())
    }
  )

  it('binds an original read to the captured storage key across a concurrent replacement', async () => {
    const doc = await seedDocument({ original: false, content: SECRET, provenance: exact })
    const oldKey = `kb/${generateId()}.txt`
    const newKey = `kb/${generateId()}.txt`
    for (const [key, content] of [
      [oldKey, SECRET],
      [newKey, 'replacement public content'],
    ]) {
      await uploadFile({
        file: Buffer.from(content),
        fileName: 'fixture.txt',
        contentType: 'text/plain',
        context: 'knowledge-base',
        customKey: key,
        preserveKey: true,
        persistMetadata: false,
      })
    }
    await db.update(document).set({ storageKey: oldKey }).where(eq(document.id, doc.id))
    const input = {
      knowledgeBaseId: ids.knowledgeBaseId,
      documentId: doc.id,
      assertedWorkspaceId: ids.workspaceId,
    }
    const matched = await inChat(() => readOriginalKnowledgeDocument.execute({ principal, input }))
    expect(matched.buffer?.toString()).toBe(SECRET)
    expect(matched.hasRecordedSecrets).toBe(true)
    const resolve = knowledgeContexts.resolveCanonicalActiveKnowledgeDocumentContext
    let replaced = false
    const interleave = vi
      .spyOn(knowledgeContexts, 'resolveCanonicalActiveKnowledgeDocumentContext')
      .mockImplementation(async (...args) => {
        const context = await resolve(...args)
        await db.transaction(async (tx) => {
          const [row] = await tx
            .update(document)
            .set({ storageKey: newKey })
            .where(eq(document.id, doc.id))
            .returning()
          await replaceKnowledgeDocumentSecretProvenanceInTx(
            tx,
            doc.id,
            createKnowledgeDocumentSourceValue(row),
            { status: 'exact', entries: [] }
          )
        })
        replaced = true
        return context
      })
    try {
      await expect(
        inChat(() => readOriginalKnowledgeDocument.execute({ principal, input }))
      ).rejects.toThrow(/provenance|model/i)
      expect(replaced).toBe(true)
    } finally {
      interleave.mockRestore()
    }
    const current = await inChat(() => readOriginalKnowledgeDocument.execute({ principal, input }))
    expect(current.buffer?.toString()).toBe('replacement public content')
    expect(current.hasRecordedSecrets).toBe(false)
  })

  it('exports clean and legacy originals with chunks through the existing ZIP stream', async () => {
    const docs = [
      await seedDocument(),
      await seedDocument({ name: 'tracked.txt', provenance: { status: 'exact', entries: [] } }),
    ]
    const bundle = await exportedBundle()
    const zip = await JSZip.loadAsync(await archiveBytes(bundle))
    for (const doc of docs) {
      const original = Object.values(zip.files).find(
        (file) => file.name.startsWith(`files/${doc.id}/`) && !file.dir
      )
      expect(await original?.async('string')).toBe(doc.content)
      const lines = await zip.file(`chunks/${doc.id}.ndjson`)?.async('string')
      expect(JSON.parse(lines?.trim() ?? '{}').content).toBe(doc.content)
    }
    expect(zip.file('manifest.json')).not.toBeNull()
  })

  it.each(['unknown', 'exact', 'corrupt'] as const)(
    'refuses %s chunk bytes introduced after bundle creation, even outside the original gate context',
    async (kind) => {
      const doc = await seedDocument({ original: false })
      const bundle = await exportedBundle()
      await db.transaction(async (tx) => {
        await tx
          .update(embedding)
          .set({ content: SECRET, chunkHash: sha256Hex(SECRET) })
          .where(eq(embedding.id, doc.chunkId))
        await replaceKnowledgeEmbeddingSecretProvenanceInTx(
          tx,
          doc.chunkId,
          kind === 'corrupt' ? 'previous content' : SECRET,
          kind === 'exact'
            ? exact
            : kind === 'unknown'
              ? { status: 'unknown' }
              : { status: 'exact', entries: [] }
        )
      })
      await expect(archiveBytes(bundle)).rejects.toThrow(/provenance|model/i)
      const emitted: string[] = []
      await expect(
        (async () => {
          for await (const chunk of bundle.chunks(doc.id)) emitted.push(chunk.content)
        })()
      ).rejects.toThrow(/provenance|model/i)
      expect(emitted).toEqual([])
    }
  )

  it('refuses an inline original replaced after bundle creation without exposing new bytes', async () => {
    const doc = await seedDocument()
    const bundle = await exportedBundle()
    await db.transaction(async (tx) => {
      const [row] = await tx
        .update(document)
        .set({ fileUrl: `data:text/plain;base64,${Buffer.from(SECRET).toString('base64')}` })
        .where(eq(document.id, doc.id))
        .returning()
      await replaceKnowledgeDocumentSecretProvenanceInTx(
        tx,
        doc.id,
        createKnowledgeDocumentSourceValue(row),
        exact
      )
    })
    await expect(archiveBytes(bundle)).rejects.toThrow(/provenance|model/i)
  })

  it('preserves authorized human export of the original and chunks', async () => {
    const doc = await seedDocument({ content: SECRET, provenance: { status: 'unknown' } })
    const zip = await JSZip.loadAsync(await archiveBytes(await exportedBundle(true)))
    expect(await zip.file(`chunks/${doc.id}.ndjson`)?.async('string')).toContain(SECRET)
    const original = Object.values(zip.files).find(
      (file) => file.name.startsWith(`files/${doc.id}/`) && !file.dir
    )
    expect(await original?.async('string')).toBe(SECRET)
  })
})
