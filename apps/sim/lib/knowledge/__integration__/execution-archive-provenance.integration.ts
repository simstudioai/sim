/** Real execution-file storage, ZIP extraction, durable provenance, table import, and KB indexing. */
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { DelegatedPrincipal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { withInsertColumns } from '@sim/db/insert-columns'
import {
  document,
  documentSecretProvenance,
  knowledgeBase,
  organization,
  outboxEvent,
  user,
  userTableRowSecretProvenance,
  userTableRows,
  workspace,
  workspaceFileColumns,
  workspaceFiles,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { eq, inArray, sql } from 'drizzle-orm'
import JSZip from 'jszip'
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

import { fileManageDecompressBodySchema } from '@/lib/api/contracts/tools/file'
import { processOutboxEventById } from '@/lib/core/outbox/service'
import { encryptSecret } from '@/lib/core/security/encryption'
import { isUserFile } from '@/lib/core/utils/user-file'
import { executeFileManageOperation } from '@/lib/internal/file/operations'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { addWorkspaceFilesToKnowledgeBase } from '@/lib/knowledge/application/add-workspace-files'
import { listKnowledgeChunks } from '@/lib/knowledge/application/chunks'
import { searchKnowledge } from '@/lib/knowledge/application/search'
import { KNOWLEDGE_DOCUMENT_PROCESSING_OUTBOX_EVENT } from '@/lib/knowledge/documents/processing-outbox-event'
import { knowledgeDocumentProcessingOutboxHandlers } from '@/lib/knowledge/documents/processing-outbox-handler'
import { createSingleDocument } from '@/lib/knowledge/documents/service'
import { loadKnowledgeDocumentSecretRegistry } from '@/lib/knowledge/secret-provenance'
import { createTableFromWorkspaceFile } from '@/lib/table/application/workspace-file-imports'
import { uploadExecutionFile } from '@/lib/uploads/contexts/execution/execution-file-manager'
import {
  deleteWorkspaceFile,
  getWorkspaceFile,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import {
  filterModelSafeWorkspaceFileAttachments,
  getBoundWorkspaceFileSecretProvenance,
  isModelSafeWorkspaceFileKey,
  isOpaqueWorkspaceFileEgressSafe,
  type WorkspaceFileSecretProvenance,
} from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { deleteFile, downloadFile } from '@/lib/uploads/core/storage-service'
import { createWorkspaceFileDelegatedPrincipal } from '@/lib/workspace-files/application/delegated-principal'
import type { UserFile } from '@/executor/types'

const fixtures: ReturnType<typeof createKnowledgeAclFixtureIds>[] = []
const trackedEventIds: string[] = []
const REPORT_TEXT =
  'Orion archive import retains verified source bytes through every durable surface.'
const REPORT_CSV = `name,description\nOrion,${REPORT_TEXT}\n`
const FIXTURE_SECRET = 'fixture-resolved-secret-not-a-live-key'

async function seed() {
  const ids = createKnowledgeAclFixtureIds()
  fixtures.push(ids)
  await seedKnowledgeAclFixture(ids)
  return { ...ids, workflowId: generateId(), executionId: generateId() }
}

type Fixture = Awaited<ReturnType<typeof seed>>

function sessionPrincipal(ids: Fixture) {
  return { kind: 'session', userId: ids.aliceId, sessionId: 'fixture-session' } as const
}

function tablePrincipal(ids: Fixture): DelegatedPrincipal {
  const issuedAt = new Date()
  return {
    kind: 'delegated',
    serviceId: 'copilot',
    subjectUserId: ids.aliceId,
    workspaceId: ids.workspaceId,
    delegationId: generateId(),
    audience: 'sim:tables',
    issuedAt,
    expiresAt: new Date(issuedAt.getTime() + 5 * 60_000),
  }
}

async function uploadArchive(
  ids: Fixture,
  provenance?: WorkspaceFileSecretProvenance,
  content = REPORT_CSV
) {
  const zip = new JSZip()
  zip.file('report.csv', content)
  return uploadExecutionFile(
    ids,
    await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }),
    'report.zip',
    'application/zip',
    ids.aliceId,
    provenance
  )
}

async function decompress(ids: Fixture, archive: UserFile, executionId = ids.executionId) {
  return executeFileManageOperation(
    fileManageDecompressBodySchema.parse({
      operation: 'decompress',
      workspaceId: ids.workspaceId,
      fileInput: archive,
    }),
    {
      principal: createWorkspaceFileDelegatedPrincipal({
        serviceId: 'executor',
        subjectUserId: ids.aliceId,
        workspaceId: ids.workspaceId,
        delegationId: generateId(),
        executionId,
      }),
      workspaceId: ids.workspaceId,
      attributedUserId: ids.aliceId,
      fileAccessUserId: ids.aliceId,
      workflowId: ids.workflowId,
      executionId,
      headers: new Headers(),
      requestId: generateId(),
    }
  )
}

async function extract(ids: Fixture, archive: UserFile) {
  const response = await decompress(ids, archive)
  const body = await response.json()
  expect(response.status, JSON.stringify(body)).toBe(200)
  expect(body.success).toBe(true)
  const candidates: unknown = body.data?.files
  if (!Array.isArray(candidates) || !candidates.every(isUserFile)) {
    throw new Error('Archive extraction returned invalid file metadata')
  }
  expect(candidates).toHaveLength(1)
  const child = candidates[0]
  const record = await getWorkspaceFile(ids.workspaceId, child.id)
  if (!record) throw new Error('Extracted file has no canonical workspace record')
  const identity = {
    fileId: record.id,
    key: record.key,
    context: 'workspace' as const,
    contentUpdatedAt: record.contentUpdatedAt ?? undefined,
  }
  return { child, record, identity, publicMetadata: JSON.stringify({ archive, body }) }
}

async function assertBlockedConsumers(ids: Fixture, source: Awaited<ReturnType<typeof extract>>) {
  expect(await isOpaqueWorkspaceFileEgressSafe(ids.workspaceId, source.identity)).toBe(false)
  const imported = await addWorkspaceFilesToKnowledgeBase.execute({
    principal: sessionPrincipal(ids),
    input: { knowledgeBaseId: ids.knowledgeBaseId, fileReferences: [source.child.id] },
  })
  expect(imported).toMatchObject({ added: [], failed: [source.child.id] })
  await expect(
    createTableFromWorkspaceFile.execute({
      principal: tablePrincipal(ids),
      input: { workspaceId: ids.workspaceId, fileReference: source.child.id },
    })
  ).rejects.toThrow('cannot be verified as free of resolved secrets')
}

beforeAll(() => {
  fixtureStorage.root = mkdtempSync(path.join(tmpdir(), 'sim-execution-archive-provenance-'))
})
afterAll(async () => {
  if (trackedEventIds.length) {
    await db.delete(outboxEvent).where(inArray(outboxEvent.id, trackedEventIds))
  }
  for (const ids of fixtures) {
    await db.delete(knowledgeBase).where(eq(knowledgeBase.id, ids.knowledgeBaseId))
    await db.delete(workspace).where(eq(workspace.id, ids.workspaceId))
    await db.delete(organization).where(eq(organization.id, ids.organizationId))
    await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
  }
  await rm(fixtureStorage.root, { recursive: true, force: true })
  await db.$client.end()
})

describe('execution archive durable provenance', () => {
  it('carries exact-empty lineage through extraction, table rows, and delayed KB indexing/search', async () => {
    const ids = await seed()
    const archive = await uploadArchive(ids, { status: 'exact', entries: [] })
    const [storedArchive] = await db
      .select({
        secretProvenanceVersion: workspaceFiles.secretProvenanceVersion,
        context: workspaceFiles.context,
      })
      .from(workspaceFiles)
      .where(eq(workspaceFiles.key, archive.key))
    expect(storedArchive.secretProvenanceVersion).toBe(1)
    expect(storedArchive.context).toBe('execution')
    const source = await extract(ids, archive)
    expect(await getBoundWorkspaceFileSecretProvenance(ids.workspaceId, source.identity)).toEqual({
      status: 'exact',
      entries: [],
    })
    expect(await isOpaqueWorkspaceFileEgressSafe(ids.workspaceId, source.identity)).toBe(true)
    expect((await downloadFile({ key: source.child.key, context: 'workspace' })).toString()).toBe(
      REPORT_CSV
    )

    const table = await createTableFromWorkspaceFile.execute({
      principal: tablePrincipal(ids),
      input: { workspaceId: ids.workspaceId, fileReference: source.child.id },
    })
    expect(table.kind).toBe('inline')
    if (table.kind !== 'inline') throw new Error('Small CSV did not use the inline import path')
    expect(table.insertedCount).toBe(1)
    const rows = await db
      .select({
        data: userTableRows.data,
        updatedAt: userTableRows.updatedAt,
        version: userTableRows.secretProvenanceVersion,
        contentUpdatedAt: userTableRowSecretProvenance.contentUpdatedAt,
        status: userTableRowSecretProvenance.status,
        entries: userTableRowSecretProvenance.entries,
      })
      .from(userTableRows)
      .leftJoin(
        userTableRowSecretProvenance,
        eq(userTableRowSecretProvenance.rowId, userTableRows.id)
      )
      .where(eq(userTableRows.tableId, table.table.id))
    expect(rows).toHaveLength(1)
    const nameColumn = table.table.schema.columns.find((column) => column.name === 'name')
    const descriptionColumn = table.table.schema.columns.find(
      (column) => column.name === 'description'
    )
    if (!nameColumn?.id || !descriptionColumn?.id) {
      throw new Error('Imported table lost its canonical source columns')
    }
    expect(rows[0]).toMatchObject({
      data: { [nameColumn.id]: 'Orion', [descriptionColumn.id]: REPORT_TEXT },
      version: 1,
      status: 'exact',
      entries: [],
    })
    expect(rows[0].contentUpdatedAt).toEqual(rows[0].updatedAt)

    const imported = await addWorkspaceFilesToKnowledgeBase.execute({
      principal: sessionPrincipal(ids),
      input: { knowledgeBaseId: ids.knowledgeBaseId, fileReferences: [source.child.id] },
    })
    expect(imported.failed).toEqual([])
    expect(imported.added).toHaveLength(1)
    const documentId = imported.added[0].documentId
    const [admitted] = await db.select().from(document).where(eq(document.id, documentId))
    expect(admitted.secretProvenanceVersion).toBe(1)
    expect(admitted.storageKey).toMatch(/^kb\//)
    const events = await db
      .select()
      .from(outboxEvent)
      .where(sql`${outboxEvent.payload}::jsonb ->> 'documentId' = ${documentId}`)
    trackedEventIds.push(...events.map((event) => event.id))
    const dispatch = events.find(
      (event) => event.eventType === KNOWLEDGE_DOCUMENT_PROCESSING_OUTBOX_EVENT
    )
    if (!dispatch) throw new Error('Knowledge import did not atomically admit processing')
    await deleteWorkspaceFile(ids.workspaceId, source.child.id)
    await deleteFile({ key: source.child.key, context: 'workspace' })
    await deleteFile({ key: archive.key, context: 'execution' })
    await processOutboxEventById(dispatch.id, knowledgeDocumentProcessingOutboxHandlers)
    const [indexed] = await db.select().from(document).where(eq(document.id, documentId))
    expect(indexed.processingStatus, indexed.processingError ?? undefined).toBe('completed')
    const chunks = await listKnowledgeChunks.execute({
      principal: sessionPrincipal(ids),
      input: { knowledgeBaseId: ids.knowledgeBaseId, documentId },
    })
    expect(chunks.chunks.map((chunk) => chunk.content).join('\n')).toContain(REPORT_TEXT)
    const search = await searchKnowledge.execute({
      principal: sessionPrincipal(ids),
      input: {
        workspaceId: ids.workspaceId,
        knowledgeBaseIds: [ids.knowledgeBaseId],
        query: 'Orion',
        searchMode: 'hybrid',
        topK: 10,
      },
    })
    expect(search.results.map((entry) => entry.documentId)).toContain(documentId)
  })

  it('keeps an explicitly unknown execution source unavailable to model, KB, and table consumers', async () => {
    const ids = await seed()
    const archive = await uploadArchive(ids, { status: 'unknown' })
    const source = await extract(ids, archive)
    expect(await getBoundWorkspaceFileSecretProvenance(ids.workspaceId, source.identity)).toEqual({
      status: 'unknown',
    })
    await assertBlockedConsumers(ids, source)
  })

  it('does not infer safe extracted bytes from a secret-bearing archive or expose private metadata', async () => {
    const ids = await seed()
    const { encrypted } = await encryptSecret(FIXTURE_SECRET)
    const archive = await uploadArchive(
      ids,
      {
        status: 'exact',
        entries: [
          {
            name: 'FIXTURE_SECRET',
            encryptedValue: encrypted,
            sourceUserId: ids.aliceId,
            sourceWorkspaceId: ids.workspaceId,
          },
        ],
      },
      `name,description\nOrion,${FIXTURE_SECRET}\n`
    )
    const source = await extract(ids, archive)
    expect(source.publicMetadata).not.toContain(FIXTURE_SECRET)
    expect(source.publicMetadata).not.toContain(encrypted)
    expect(source.publicMetadata).not.toContain('encryptedValue')
    expect(await getBoundWorkspaceFileSecretProvenance(ids.workspaceId, source.identity)).toEqual({
      status: 'unknown',
    })
    await assertBlockedConsumers(ids, source)
  })

  it('preserves compatibility for execution files created before provenance stamping', async () => {
    const ids = await seed()
    const archive = await uploadArchive(ids)
    const [storedArchive] = await db
      .select({
        secretProvenanceVersion: workspaceFiles.secretProvenanceVersion,
        context: workspaceFiles.context,
      })
      .from(workspaceFiles)
      .where(eq(workspaceFiles.key, archive.key))
    expect(storedArchive.secretProvenanceVersion).toBeNull()
    const source = await extract(ids, archive)
    expect(await isOpaqueWorkspaceFileEgressSafe(ids.workspaceId, source.identity)).toBe(true)
    const imported = await createTableFromWorkspaceFile.execute({
      principal: tablePrincipal(ids),
      input: { workspaceId: ids.workspaceId, fileReference: source.child.id },
    })
    expect(imported.kind).toBe('inline')
  })

  it.each([false, true])(
    'refuses tracked unknown execution attachments with historical metadata (archivedOnly=%s)',
    async (archivedOnly) => {
      const ids = await seed()
      const file = await uploadExecutionFile(
        ids,
        Buffer.from(REPORT_CSV),
        'report.csv',
        'text/csv',
        ids.aliceId,
        { status: 'unknown' }
      )
      if (archivedOnly) {
        await db
          .update(workspaceFiles)
          .set({ deletedAt: new Date() })
          .where(eq(workspaceFiles.key, file.key))
      } else {
        await db.insert(withInsertColumns(workspaceFiles, workspaceFileColumns)).values({
          id: generateId(),
          key: file.key,
          userId: ids.aliceId,
          workspaceId: ids.workspaceId,
          context: 'execution',
          originalName: 'historical-report.csv',
          contentType: file.type,
          sizeBytes: file.size,
          deletedAt: new Date(),
          contentUpdatedAt: new Date(Date.now() + 60_000),
          secretProvenanceVersion: null,
        })
      }

      expect(
        await filterModelSafeWorkspaceFileAttachments([file], { workspaceId: ids.workspaceId })
      ).toEqual([])
      expect(await isModelSafeWorkspaceFileKey(file.key, { workspaceId: ids.workspaceId })).toBe(
        false
      )
    }
  )

  it.each([
    { status: 'exact', deleted: false },
    { status: 'unknown', deleted: false },
    { status: 'exact', deleted: true },
    { status: 'unknown', deleted: true },
  ] as const)(
    'binds $status execution bytes into KB admission despite URL-only classification (deleted=$deleted)',
    async ({ status, deleted }) => {
      const ids = await seed()
      const file = await uploadExecutionFile(
        ids,
        Buffer.from(REPORT_CSV),
        'report.csv',
        'text/csv',
        ids.aliceId,
        status === 'exact' ? { status, entries: [] } : { status }
      )
      if (deleted) {
        await db
          .update(workspaceFiles)
          .set({ deletedAt: new Date() })
          .where(eq(workspaceFiles.key, file.key))
      }
      const admitted = await createSingleDocument(
        {
          filename: file.name,
          fileUrl: `/api/files/serve/${encodeURIComponent(file.key)}?context=workspace`,
          fileSize: file.size,
          mimeType: file.type,
        },
        ids.knowledgeBaseId,
        generateId(),
        ids.aliceId,
        undefined,
        {
          filename: { status: 'exact', entries: [] },
          content: { status: 'exact', entries: [] },
          tags: [],
        }
      )
      const [stored] = await db
        .select({
          version: document.secretProvenanceVersion,
          status: documentSecretProvenance.status,
        })
        .from(document)
        .leftJoin(documentSecretProvenance, eq(documentSecretProvenance.documentId, document.id))
        .where(eq(document.id, admitted.id))
      expect(stored).toEqual({ version: 1, status })
      const registry = loadKnowledgeDocumentSecretRegistry(admitted.id, {
        userId: ids.aliceId,
        workspaceId: ids.workspaceId,
      })
      if (status === 'exact') {
        await expect(registry).resolves.toMatchObject({
          tracked: true,
          provenance: { status: 'exact', entries: [] },
        })
      } else {
        await expect(registry).rejects.toThrow(
          'Knowledge document secret provenance is unavailable'
        )
      }
    }
  )

  it('refuses another execution before extracting any workspace files', async () => {
    const ids = await seed()
    const archive = await uploadArchive(ids, { status: 'exact', entries: [] })
    const response = await decompress(ids, archive, generateId())
    expect(response.status).toBe(404)
    const files = await db
      .select({ context: workspaceFiles.context })
      .from(workspaceFiles)
      .where(eq(workspaceFiles.workspaceId, ids.workspaceId))
    expect(files).toEqual([{ context: 'execution' }])
  })
})
