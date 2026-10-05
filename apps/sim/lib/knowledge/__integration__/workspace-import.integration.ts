/** Real file ownership, PostgreSQL admission, delayed processing, and search of copied workspace bytes. */
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as audit from '@sim/audit'
import { AuditAction } from '@sim/audit'
import { db } from '@sim/db'
import {
  auditLog,
  document,
  knowledgeBase,
  organization,
  outboxEvent,
  permissions,
  user,
  workspace,
  workspaceFiles,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const fixtureStorage = vi.hoisted(() => ({ root: '' }))
vi.mock('@/lib/uploads/core/setup.server', () => ({
  get UPLOAD_DIR_SERVER() {
    return fixtureStorage.root
  },
}))
vi.mock('@/lib/embeddings', async () => ({
  ...(await import('@/lib/embeddings/client')),
  assertKnowledgeEmbeddingCapacity: async () => {},
  embedKnowledge: async (texts: string[]) => ({
    embeddings: texts.map(() => [1, ...Array<number>(1535).fill(0)]),
    totalTokens: texts.length,
    billableTokens: 0,
    isBYOK: true,
    modelName: 'text-embedding-3-small',
    pricingId: 'text-embedding-3-small',
  }),
}))

import { processOutboxEventById } from '@/lib/core/outbox/service'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { addWorkspaceFilesToKnowledgeBase } from '@/lib/knowledge/application/add-workspace-files'
import { listKnowledgeChunks } from '@/lib/knowledge/application/chunks'
import { searchKnowledge } from '@/lib/knowledge/application/search'
import { KNOWLEDGE_DOCUMENT_PROCESSING_OUTBOX_EVENT } from '@/lib/knowledge/documents/processing-outbox-event'
import { knowledgeDocumentProcessingOutboxHandlers } from '@/lib/knowledge/documents/processing-outbox-handler'
import { createDocumentRecords, createSingleDocument } from '@/lib/knowledge/documents/service'
import { KNOWLEDGE_STORAGE_CLEANUP_EVENT } from '@/lib/knowledge/documents/storage-cleanup'
import { uploadKnowledgeArtifact } from '@/lib/knowledge/documents/storage-upload'
import {
  deleteWorkspaceFile,
  uploadWorkspaceFile,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import type { WorkspaceFileSecretProvenance } from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { deleteFile, downloadFile } from '@/lib/uploads/core/storage-service'

const fixtures: ReturnType<typeof createKnowledgeAclFixtureIds>[] = []
const trackedEventIds: string[] = []

async function seed() {
  const ids = createKnowledgeAclFixtureIds()
  fixtures.push(ids)
  await seedKnowledgeAclFixture(ids)
  return ids
}

async function sourceFile(
  ids: ReturnType<typeof createKnowledgeAclFixtureIds>,
  content: string,
  secretProvenance: WorkspaceFileSecretProvenance = { status: 'exact', entries: [] }
) {
  return uploadWorkspaceFile(
    ids.workspaceId,
    ids.aliceId,
    Buffer.from(content),
    'import.txt',
    'text/plain',
    {
      secretProvenance,
      notifyWorkspaceChange: false,
    }
  )
}

/** Drains real audit writes before asserting persisted rows, including duplicates from one operation. */
function observeAbsenceAudits(workspaceId: string) {
  let submitted = 0
  const recordAudit = audit.recordAudit
  const observation = vi.spyOn(audit, 'recordAudit').mockImplementation((entry) => {
    if (
      entry.workspaceId === workspaceId &&
      entry.action === AuditAction.SECRET_PROVENANCE_UNRECORDED
    ) {
      submitted += 1
    }
    recordAudit(entry)
  })
  return {
    restore: () => observation.mockRestore(),
    async persisted() {
      const read = () =>
        db
          .select()
          .from(auditLog)
          .where(
            and(
              eq(auditLog.workspaceId, workspaceId),
              eq(auditLog.action, AuditAction.SECRET_PROVENANCE_UNRECORDED)
            )
          )
      await vi.waitFor(async () => expect(await read()).toHaveLength(submitted))
      return read()
    },
  }
}

beforeAll(() => {
  fixtureStorage.root = mkdtempSync(path.join(tmpdir(), 'sim-workspace-import-'))
})
afterAll(async () => {
  vi.useRealTimers()
  if (trackedEventIds.length)
    await db.delete(outboxEvent).where(inArray(outboxEvent.id, trackedEventIds))
  for (const ids of fixtures) {
    await db.delete(auditLog).where(eq(auditLog.workspaceId, ids.workspaceId))
    await db.delete(knowledgeBase).where(eq(knowledgeBase.id, ids.knowledgeBaseId))
    await db.delete(workspace).where(eq(workspace.id, ids.workspaceId))
    await db.delete(organization).where(eq(organization.id, ids.organizationId))
    await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
  }
  await rm(fixtureStorage.root, { recursive: true, force: true })
  await db.$client.end()
})

describe('durable workspace file import', () => {
  it('audits one accepted unrecorded source under the importer instead of its uploader', async () => {
    const ids = await seed()
    const source = await sourceFile(ids, 'ordinary source bytes', { status: 'unrecorded' })
    await db
      .update(permissions)
      .set({ permissionType: 'write' })
      .where(and(eq(permissions.userId, ids.bobId), eq(permissions.entityId, ids.workspaceId)))
    const observed = observeAbsenceAudits(ids.workspaceId)
    try {
      const result = await addWorkspaceFilesToKnowledgeBase.execute({
        principal: { kind: 'session', userId: ids.bobId, sessionId: 'fixture-session' },
        input: { knowledgeBaseId: ids.knowledgeBaseId, fileReferences: [source.id, source.id] },
      })
      expect(result.failed).toEqual([])
      expect(result.added).toHaveLength(1)
      const documentId = result.added[0].documentId
      const events = await db
        .select({ id: outboxEvent.id })
        .from(outboxEvent)
        .where(sql`${outboxEvent.payload}::jsonb ->> 'documentId' = ${documentId}`)
      trackedEventIds.push(...events.map((event) => event.id))
      const entries = await observed.persisted()
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({
        actorId: ids.bobId,
        metadata: { surface: 'workspace-file', recordCount: 1 },
      })
      expect(await db.select().from(document).where(eq(document.id, documentId))).toHaveLength(1)
    } finally {
      observed.restore()
    }
  })

  it.each([
    ['single', 'commit'],
    ['single', 'rollback'],
    ['bulk', 'commit'],
    ['bulk', 'rollback'],
  ] as const)('audits unrecorded %s document admission only after %s', async (mode, outcome) => {
    const ids = await seed()
    const source = await sourceFile(ids, 'ordinary source bytes', { status: 'unrecorded' })
    const observed = observeAbsenceAudits(ids.workspaceId)
    const tripwire = process.env.DB_TX_TRIPWIRE
    /** Match production's warning mode so a premature audit remains visible after rollback. */
    vi.stubEnv('DB_TX_TRIPWIRE', 'warn')
    const transaction = db.transaction.bind(db)
    const failure =
      outcome === 'rollback'
        ? vi.spyOn(db, 'transaction').mockImplementationOnce((callback, config) =>
            transaction(async (tx) => {
              await callback(tx)
              throw new Error('Document admission commit failed')
            }, config)
          )
        : undefined
    try {
      const input = {
        filename: source.name,
        fileUrl: `/api/files/serve/${encodeURIComponent(source.key)}?context=workspace`,
        fileSize: source.size,
        mimeType: source.type,
      }
      const created =
        mode === 'single'
          ? createSingleDocument(input, ids.knowledgeBaseId, generateId(), ids.aliceId)
          : createDocumentRecords([input], ids.knowledgeBaseId, generateId(), ids.aliceId)
      if (outcome === 'rollback') {
        await expect(created).rejects.toThrow('Document admission commit failed')
      } else {
        await created
      }
      const expectedCount = outcome === 'commit' ? 1 : 0
      expect(
        await db.select().from(document).where(eq(document.knowledgeBaseId, ids.knowledgeBaseId))
      ).toHaveLength(expectedCount)
      const entries = await observed.persisted()
      expect(entries).toHaveLength(expectedCount)
      if (outcome === 'commit') {
        expect(entries[0]).toMatchObject({
          actorId: null,
          metadata: { surface: 'workspace-file', recordCount: 1 },
        })
      }
    } finally {
      failure?.mockRestore()
      observed.restore()
      vi.stubEnv('DB_TX_TRIPWIRE', tripwire)
    }
  })

  it('indexes the admitted snapshot after the source was deleted and temporary access would have expired', async () => {
    const ids = await seed()
    const content =
      'Orion import snapshot: this retained copy remains searchable after the source workspace file is deleted.'
    const source = await sourceFile(ids, content)
    const principal = {
      kind: 'session',
      userId: ids.aliceId,
      sessionId: 'fixture-session',
    } as const
    const result = await addWorkspaceFilesToKnowledgeBase.execute({
      principal,
      input: { knowledgeBaseId: ids.knowledgeBaseId, fileReferences: [source.id] },
    })
    expect(result.failed).toEqual([])
    expect(result.added).toHaveLength(1)
    const documentId = result.added[0].documentId
    const [admitted] = await db.select().from(document).where(eq(document.id, documentId))
    expect(admitted.processingStatus).toBe('pending')
    expect(admitted.storageKey).toMatch(/^kb\//)
    expect(admitted.storageKey).not.toBe(source.key)
    expect(admitted.fileUrl).toContain('?context=knowledge-base')
    expect(admitted.fileUrl).not.toContain('X-Amz-')
    expect(admitted.secretProvenanceVersion).toBe(1)
    const documentEvents = await db
      .select()
      .from(outboxEvent)
      .where(sql`${outboxEvent.payload}::jsonb ->> 'documentId' = ${documentId}`)
    trackedEventIds.push(...documentEvents.map((event) => event.id))
    const dispatch = documentEvents.find(
      (event) => event.eventType === KNOWLEDGE_DOCUMENT_PROCESSING_OUTBOX_EVENT
    )
    const guard = documentEvents.find(
      (event) => event.eventType === KNOWLEDGE_STORAGE_CLEANUP_EVENT
    )
    expect(guard?.status).toBe('completed')
    expect(dispatch?.status).toBe('pending')
    expect(dispatch?.payload).not.toHaveProperty('fileUrl')

    await deleteWorkspaceFile(ids.workspaceId, source.id)
    await deleteFile({ key: source.key, context: 'workspace' })
    expect(
      (await downloadFile({ key: admitted.storageKey!, context: 'knowledge-base' })).toString()
    ).toBe(content)

    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(Date.now() + 60 * 60_000))
    try {
      expect(dispatch).toBeDefined()
      await processOutboxEventById(dispatch!.id, knowledgeDocumentProcessingOutboxHandlers)
      const [indexed] = await db.select().from(document).where(eq(document.id, documentId))
      expect(indexed.processingStatus, indexed.processingError ?? undefined).toBe('completed')
      const chunks = await listKnowledgeChunks.execute({
        principal,
        input: { knowledgeBaseId: ids.knowledgeBaseId, documentId },
      })
      expect(chunks.chunks.map((chunk) => chunk.content).join('\n')).toContain(content)
      const search = await searchKnowledge.execute({
        principal,
        input: {
          workspaceId: ids.workspaceId,
          knowledgeBaseIds: [ids.knowledgeBaseId],
          query: 'Orion',
          searchMode: 'hybrid',
          topK: 10,
        },
      })
      expect(search.results.map((entry) => entry.documentId)).toContain(documentId)
    } finally {
      vi.useRealTimers()
    }
  })

  it('conceals source files from another workspace before durable admission', async () => {
    const ids = await seed()
    const other = await seed()
    const source = await sourceFile(other, 'A separate workspace owns this file.')
    const result = await addWorkspaceFilesToKnowledgeBase.execute({
      principal: { kind: 'session', userId: ids.aliceId, sessionId: 'fixture-session' },
      input: { knowledgeBaseId: ids.knowledgeBaseId, fileReferences: [source.id] },
    })
    expect(result).toMatchObject({ added: [], failed: [source.id] })
    expect(
      await db.select().from(document).where(eq(document.knowledgeBaseId, ids.knowledgeBaseId))
    ).toEqual([])
    expect(
      await db
        .select({ id: workspaceFiles.id })
        .from(workspaceFiles)
        .where(
          and(
            eq(workspaceFiles.workspaceId, ids.workspaceId),
            eq(workspaceFiles.context, 'knowledge-base')
          )
        )
    ).toEqual([])
  })
  it('rolls back attachment and processing when the reserved file identity changed', async () => {
    const ids = await seed()
    const documentId = generateId()
    const stored = await uploadKnowledgeArtifact({
      documentId,
      key: `kb/${generateId()}.txt`,
      owner: { workspaceId: ids.workspaceId, userId: ids.aliceId },
      artifact: {
        bytes: Buffer.from('snapshot'),
        fileName: 'snapshot.txt',
        mimeType: 'text/plain',
      },
    })
    trackedEventIds.push(stored.cleanupEventId)
    await expect(
      createSingleDocument(
        {
          filename: 'snapshot.txt',
          fileUrl: `${stored.path}?context=knowledge-base`,
          fileSize: 8,
          mimeType: 'text/plain',
        },
        ids.knowledgeBaseId,
        generateId(),
        ids.aliceId,
        documentId,
        undefined,
        {
          expectedWorkspaceId: ids.workspaceId,
          uploadedArtifact: { ...stored, metadataId: generateId() },
        }
      )
    ).rejects.toThrow('expired before it could be attached')
    const [guard] = await db
      .select()
      .from(outboxEvent)
      .where(eq(outboxEvent.id, stored.cleanupEventId))
    expect(guard.status).toBe('pending')
    expect(await db.select().from(document).where(eq(document.id, documentId))).toEqual([])
    await db
      .update(outboxEvent)
      .set({ availableAt: new Date(0) })
      .where(eq(outboxEvent.id, guard.id))
    expect(await processOutboxEventById(guard.id, knowledgeDocumentProcessingOutboxHandlers)).toBe(
      'completed'
    )
    await expect(downloadFile({ key: stored.key, context: 'knowledge-base' })).rejects.toThrow()
  })
})
