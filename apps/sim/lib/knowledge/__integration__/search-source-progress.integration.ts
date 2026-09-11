import { db } from '@sim/db'
import {
  document,
  embedding,
  knowledgeBase,
  knowledgeConnector,
  organization,
  permissions,
  user,
  workspace,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ConnectorDocumentFilter } from '@/lib/api/contracts/knowledge/connectors'
import * as embeddings from '@/lib/embeddings'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import {
  deleteKnowledgeConnector,
  listKnowledgeConnectorDocuments,
} from '@/lib/knowledge/application/connectors'
import {
  listKnowledgeDocuments,
  readKnowledgeDocument,
  updateKnowledgeDocument,
} from '@/lib/knowledge/application/documents'
import { readSearchSourceProgress } from '@/lib/knowledge/application/search-source-progress'
import { listSearchSources } from '@/lib/knowledge/application/search-sources'
import { createContentSyncLease } from '@/lib/knowledge/connectors/sync-lock'
import { persistSkippedDocuments } from '@/lib/knowledge/connectors/sync-persistence'
import * as documentProcessor from '@/lib/knowledge/documents/document-processor'
import { processDocumentAsync, retryDocumentProcessing } from '@/lib/knowledge/documents/service'

const ids = createKnowledgeAclFixtureIds()
const alice = { kind: 'session' as const, userId: ids.aliceId, sessionId: 'fixture-alice' }
const bob = { kind: 'session' as const, userId: ids.bobId, sessionId: 'fixture-bob' }
const failedId = generateId()
const pendingId = generateId()
const input = { workspaceId: ids.workspaceId, connectorIds: [ids.connectorId] }

/** Drive models the mirrored email grants exercised by these provider-independent progress tests. */
beforeAll(async () => {
  await seedKnowledgeAclFixture(ids, { connectorType: 'google_drive' })
  await db
    .update(knowledgeBase)
    .set({ isSearchIndex: true })
    .where(eq(knowledgeBase.id, ids.knowledgeBaseId))
  await db
    .update(knowledgeConnector)
    .set({ status: 'active', syncLockToken: null })
    .where(eq(knowledgeConnector.id, ids.connectorId))
  await db.insert(document).values(
    [
      { id: failedId, status: 'failed', owner: ids.aliceId },
      { id: pendingId, status: 'pending', owner: ids.bobId },
    ].map((row) => ({
      id: row.id,
      knowledgeBaseId: ids.knowledgeBaseId,
      connectorId: ids.connectorId,
      externalId: row.id,
      filename: `${row.status}.txt`,
      fileUrl: `https://fixture.test/${row.id}`,
      fileSize: 10,
      mimeType: 'text/plain',
      processingStatus: row.status,
      acl: [`u:${row.owner}@fixture.test`],
      aclVerifiedAt: new Date(),
    }))
  )
})
afterAll(async () => {
  await db.delete(workspace).where(eq(workspace.id, ids.workspaceId))
  await db.delete(organization).where(eq(organization.id, ids.organizationId))
  await db.delete(user).where(eq(user.id, ids.aliceId))
  await db.delete(user).where(eq(user.id, ids.bobId))
})

describe('viewer-isolated indexing progress and recovery lists', () => {
  it('keeps failed and pending state scoped to the viewer, including admins', async () => {
    expect((await readSearchSourceProgress.execute({ principal: alice, input })).sources).toEqual([
      {
        connectorId: ids.connectorId,
        isSyncing: false,
        hasSyncError: false,
        hasIndexingError: true,
      },
    ])
    expect((await readSearchSourceProgress.execute({ principal: bob, input })).sources).toEqual([
      {
        connectorId: ids.connectorId,
        isSyncing: true,
        hasSyncError: false,
        hasIndexingError: false,
      },
    ])
    const [aliceSources, bobSources] = await Promise.all(
      [alice, bob].map((principal) =>
        listSearchSources.execute({ principal, input: { workspaceId: ids.workspaceId } })
      )
    )
    expect(aliceSources.sources[0].viewerFailedDocumentCount).toBe(1)
    expect(bobSources.sources[0].viewerFailedDocumentCount).toBe(0)
  })
  it('only lists accessible failures, with authoritative filtered pagination', async () => {
    const read = (principal: typeof alice) =>
      listKnowledgeConnectorDocuments.execute({
        principal,
        input: {
          knowledgeBaseId: ids.knowledgeBaseId,
          connectorId: ids.connectorId,
          failedOnly: true,
          limit: 1,
        },
      })
    const result = await read(alice)
    expect(result.documents.map((doc) => doc.id)).toEqual([failedId])
    expect(result.counts.failed).toBe(1)
    expect(result.hasMore).toBe(false)
    expect((await read(bob)).documents).toEqual([])
  })
  it('does not report excluded or deleted failures as actionable', async () => {
    await db.update(document).set({ userExcluded: true }).where(eq(document.id, failedId))
    expect(
      (await readSearchSourceProgress.execute({ principal: alice, input })).sources[0]
        .hasIndexingError
    ).toBe(false)
    await db
      .update(document)
      .set({ userExcluded: false, deletedAt: new Date() })
      .where(eq(document.id, failedId))
    expect(
      (await readSearchSourceProgress.execute({ principal: alice, input })).sources[0]
        .hasIndexingError
    ).toBe(false)
  })
  it('rechecks membership before showing progress', async () => {
    await db
      .delete(permissions)
      .where(and(eq(permissions.entityId, ids.workspaceId), eq(permissions.userId, ids.bobId)))
    await expect(readSearchSourceProgress.execute({ principal: bob, input })).rejects.toThrow(
      'Insufficient workspace permissions'
    )
  })
})

describe('connector document filename search and document sets', () => {
  const fixture = createKnowledgeAclFixtureIds()
  const viewer = { kind: 'session' as const, userId: fixture.aliceId, sessionId: 'fixture-search' }
  const otherViewer = { ...viewer, userId: fixture.bobId }
  const planIds = [generateId(), generateId()].sort()
  const excludedId = generateId()
  const failureId = generateId()
  const privateId = generateId()
  const literalId = generateId()
  const quoteId = generateId()
  const scope = { knowledgeBaseId: fixture.knowledgeBaseId, connectorId: fixture.connectorId }

  beforeAll(async () => {
    await seedKnowledgeAclFixture(fixture, { connectorType: 'google_drive' })
    const rows: Array<Partial<typeof document.$inferInsert> & { id: string; filename: string }> = [
      ...Array.from({ length: 221 }, (_, index) => ({
        id: generateId(),
        filename: `aaa-${String(index).padStart(3, '0')}.md`,
      })),
      ...planIds.map((id) => ({ id, filename: 'zNeedle plan.md' })),
      { id: failureId, filename: 'zNeedle failure.md', processingStatus: 'failed' },
      {
        id: excludedId,
        filename: 'zNeedle excluded.md',
        processingStatus: 'failed',
        userExcluded: true,
      },
      {
        id: privateId,
        filename: 'zNeedle private.md',
        processingStatus: 'failed',
        acl: [`u:${fixture.bobId}@fixture.test`],
      },
      { id: generateId(), filename: 'zNeedle deleted.md', deletedAt: new Date() },
      { id: generateId(), filename: 'zNeedle archived.md', archivedAt: new Date() },
      { id: literalId, filename: 'Literal 50%_\\Team.md' },
      { id: generateId(), filename: 'Literal 500ABC Team.md' },
      { id: quoteId, filename: "O'Brien.md" },
    ]
    await db.insert(document).values(
      rows.map((row) => ({
        knowledgeBaseId: fixture.knowledgeBaseId,
        connectorId: fixture.connectorId,
        externalId: row.id,
        fileUrl: `https://fixture.test/${row.id}`,
        fileSize: 10,
        mimeType: 'text/plain',
        processingStatus: 'completed',
        acl: [`u:${fixture.aliceId}@fixture.test`],
        aclVerifiedAt: new Date(),
        ...row,
      }))
    )
  })

  afterAll(async () => {
    await db.delete(workspace).where(eq(workspace.id, fixture.workspaceId))
    await db.delete(organization).where(eq(organization.id, fixture.organizationId))
    await db.delete(user).where(eq(user.id, fixture.aliceId))
    await db.delete(user).where(eq(user.id, fixture.bobId))
  })

  it('finds documents beyond the first page and returns all searched counts for every set', async () => {
    const firstPage = await listKnowledgeConnectorDocuments.execute({
      principal: viewer,
      input: { ...scope, filter: 'active', limit: 200 },
    })
    expect(firstPage.documents).toHaveLength(200)
    expect(firstPage.hasMore).toBe(true)
    expect(firstPage.documents.every((row) => row.filename.startsWith('aaa-'))).toBe(true)

    const expectedIds: Record<ConnectorDocumentFilter, string[]> = {
      active: [failureId, ...planIds],
      excluded: [excludedId],
      failed: [failureId],
      skipped: [],
    }
    for (const filter of ['active', 'excluded', 'failed', 'skipped'] as const) {
      const result = await listKnowledgeConnectorDocuments.execute({
        principal: viewer,
        input: { ...scope, filter, search: '  nEeDle  ' },
      })
      expect(result.documents.map((row) => row.id)).toEqual(expectedIds[filter])
      expect(result.counts).toEqual({ active: 3, excluded: 1, failed: 1, skipped: 0 })
      expect(result.hasMore).toBe(false)
    }
  })

  it('paginates within matching filenames with a stable ID tie-breaker', async () => {
    const results = []
    for (const offset of [0, 1]) {
      results.push(
        await listKnowledgeConnectorDocuments.execute({
          principal: viewer,
          input: { ...scope, filter: 'active', search: 'needle plan', limit: 1, offset },
        })
      )
    }
    expect(results.flatMap((result) => result.documents.map((row) => row.id))).toEqual(planIds)
    expect(results.map((result) => result.hasMore)).toEqual([true, false])
    expect(results.map((result) => result.counts.active)).toEqual([2, 2])
  })

  it('treats SQL pattern characters and quotes literally', async () => {
    for (const [search, id] of [
      ['50%_\\', literalId],
      ["O'Brien", quoteId],
    ] as const) {
      const result = await listKnowledgeConnectorDocuments.execute({
        principal: viewer,
        input: { ...scope, filter: 'active', search },
      })
      expect(result.documents.map((row) => row.id)).toEqual([id])
      expect(result.counts).toEqual({ active: 1, excluded: 0, failed: 0, skipped: 0 })
    }
  })

  it('keeps legacy flags and limits both results and counts to current document access', async () => {
    const mixed = await listKnowledgeConnectorDocuments.execute({
      principal: viewer,
      input: { ...scope, search: 'needle', includeExcluded: true },
    })
    expect(mixed.documents.map((row) => row.id)).toEqual([failureId, ...planIds, excludedId])
    const failures = await listKnowledgeConnectorDocuments.execute({
      principal: viewer,
      input: { ...scope, search: 'needle', includeExcluded: true, failedOnly: true },
    })
    expect(failures.documents.map((row) => row.id)).toEqual([failureId])
    const override = await listKnowledgeConnectorDocuments.execute({
      principal: viewer,
      input: { ...scope, search: 'needle', filter: 'excluded', failedOnly: true },
    })
    expect(override.documents.map((row) => row.id)).toEqual([excludedId])
    const privateResult = await listKnowledgeConnectorDocuments.execute({
      principal: otherViewer,
      input: { ...scope, filter: 'active', search: 'needle' },
    })
    expect(privateResult.documents.map((row) => row.id)).toEqual([privateId])
    expect(privateResult.counts).toEqual({ active: 1, excluded: 0, failed: 1, skipped: 0 })

    await db
      .delete(permissions)
      .where(
        and(eq(permissions.entityId, fixture.workspaceId), eq(permissions.userId, fixture.bobId))
      )
    await expect(
      listKnowledgeConnectorDocuments.execute({
        principal: otherViewer,
        input: { ...scope, filter: 'active', search: 'needle' },
      })
    ).rejects.toThrow('Insufficient workspace permissions')
  })
})

describe('intentional skips and genuine failures across document reads', () => {
  const fixture = createKnowledgeAclFixtureIds()
  const viewer = {
    kind: 'session' as const,
    userId: fixture.aliceId,
    sessionId: 'fixture-outcomes',
  }
  const otherViewer = { ...viewer, userId: fixture.bobId }
  const legacySkipId = generateId()
  const sourceFailureId = generateId()
  const indexingFailureId = generateId()
  const privateLegacySkipId = generateId()
  const scope = { knowledgeBaseId: fixture.knowledgeBaseId, connectorId: fixture.connectorId }
  const expectedCounts = { active: 4, excluded: 0, failed: 2, skipped: 2 }
  const skipIds = [legacySkipId]
  const failureIds = [sourceFailureId, indexingFailureId]
  const privateIds = [privateLegacySkipId]

  beforeAll(async () => {
    await seedKnowledgeAclFixture(fixture, { connectorType: 'google_drive' })
    await db
      .update(knowledgeBase)
      .set({ isSearchIndex: true })
      .where(eq(knowledgeBase.id, fixture.knowledgeBaseId))
    const rows: Array<Partial<typeof document.$inferInsert> & { id: string; filename: string }> = [
      {
        id: legacySkipId,
        filename: 'outcome-a-legacy.png',
        fileUrl: '',
        uploadedAt: new Date('2026-01-01T00:00:00Z'),
      },
      {
        id: sourceFailureId,
        filename: 'outcome-c-source.txt',
        contentHash: null,
        fileUrl: '',
        processingError: 'Source download unavailable',
      },
      {
        id: indexingFailureId,
        filename: 'outcome-d-indexing.txt',
        storageKey: 'fixture-retained-artifact',
        processingError: 'Embedding provider unavailable',
      },
      {
        id: privateLegacySkipId,
        filename: 'outcome-e-private-legacy.png',
        fileUrl: '',
        acl: [`u:${fixture.bobId}@fixture.test`],
      },
    ]
    await db.insert(document).values(
      rows.map((row) => ({
        knowledgeBaseId: fixture.knowledgeBaseId,
        connectorId: fixture.connectorId,
        externalId: row.id,
        fileUrl: `https://fixture.test/${row.id}`,
        fileSize: 10,
        mimeType: 'text/plain',
        processingStatus: 'failed',
        contentHash: `git-sha:${row.id}`,
        storageKey: null,
        processingError: 'A source omission reason whose wording may change',
        acl: [`u:${fixture.aliceId}@fixture.test`],
        aclVerifiedAt: new Date(),
        ...row,
      }))
    )
    for (const [externalId, title, userId, documentIds] of [
      ['current-skip', 'outcome-b-skipped.png', fixture.aliceId, skipIds],
      ['private-current-skip', 'outcome-f-private-skipped.png', fixture.bobId, privateIds],
    ] as const) {
      const [persisted] = await persistSkippedDocuments(
        fixture.knowledgeBaseId,
        fixture.connectorId,
        'google_drive',
        [
          {
            type: 'skip',
            extDoc: {
              externalId,
              title,
              content: '',
              mimeType: 'text/plain',
              contentHash: `git-sha:${externalId}`,
              skippedReason: 'Current worker intentionally omitted this file',
            },
          },
        ],
        undefined,
        'admin',
        createContentSyncLease(fixture.connectorId, fixture.lockId)
      )
      documentIds.push(persisted.documentId)
      await db
        .update(document)
        .set({ acl: [`u:${userId}@fixture.test`], aclVerifiedAt: new Date() })
        .where(eq(document.id, persisted.documentId))
    }
    await db
      .update(knowledgeConnector)
      .set({ status: 'active', syncLockToken: null })
      .where(eq(knowledgeConnector.id, fixture.connectorId))
  })

  afterAll(async () => {
    await db.delete(workspace).where(eq(workspace.id, fixture.workspaceId))
    await db.delete(organization).where(eq(organization.id, fixture.organizationId))
    await db.delete(user).where(eq(user.id, fixture.aliceId))
    await db.delete(user).where(eq(user.id, fixture.bobId))
  })

  it('projects legacy and current skips before authorized filtering, counting, and pagination', async () => {
    const expectedIds: Record<ConnectorDocumentFilter, string[]> = {
      active: [...skipIds, ...failureIds],
      excluded: [],
      failed: failureIds,
      skipped: skipIds,
    }
    for (const filter of ['active', 'excluded', 'failed', 'skipped'] as const) {
      const result = await listKnowledgeConnectorDocuments.execute({
        principal: viewer,
        input: { ...scope, filter, search: 'outcome-' },
      })
      expect(result.documents.map((row) => row.id)).toEqual(expectedIds[filter])
      expect(result.counts).toEqual(expectedCounts)
      expect(result.hasMore).toBe(false)
      for (const row of result.documents) {
        expect(row.processingStatus).toBe('failed')
        expect(row.processingOutcome).toBe(skipIds.includes(row.id) ? 'skipped' : null)
        expect(row.processingError).toBeTruthy()
      }
    }
    const pages = await Promise.all(
      [0, 1].map((offset) =>
        listKnowledgeConnectorDocuments.execute({
          principal: viewer,
          input: { ...scope, filter: 'skipped', limit: 1, offset },
        })
      )
    )
    expect(pages.flatMap((page) => page.documents.map((row) => row.id))).toEqual(skipIds)
    expect(pages.map((page) => page.hasMore)).toEqual([true, false])
    expect(pages.map((page) => page.counts)).toEqual([expectedCounts, expectedCounts])
    const legacyFailures = await listKnowledgeConnectorDocuments.execute({
      principal: viewer,
      input: { ...scope, failedOnly: true },
    })
    expect(legacyFailures.documents.map((row) => row.id)).toEqual(failureIds)
  })

  it('does not turn another viewer’s skips into indexing errors or expose their documents', async () => {
    for (const [principal, failedCount] of [
      [viewer, 2],
      [otherViewer, 0],
    ] as const) {
      const sources = await listSearchSources.execute({
        principal,
        input: { workspaceId: fixture.workspaceId },
      })
      expect(sources.sources[0].viewerFailedDocumentCount).toBe(failedCount)
      const progress = await readSearchSourceProgress.execute({
        principal,
        input: { workspaceId: fixture.workspaceId, connectorIds: [fixture.connectorId] },
      })
      expect(progress.sources).toEqual([
        {
          connectorId: fixture.connectorId,
          isSyncing: false,
          hasSyncError: false,
          hasIndexingError: failedCount > 0,
        },
      ])
    }
    for (const filter of ['active', 'skipped', 'failed'] as const) {
      const result = await listKnowledgeConnectorDocuments.execute({
        principal: otherViewer,
        input: { ...scope, filter },
      })
      expect(result.documents.map((row) => row.id)).toEqual(filter === 'failed' ? [] : privateIds)
      expect(result.counts).toEqual({ active: 2, excluded: 0, failed: 0, skipped: 2 })
    }
    await expect(
      readKnowledgeDocument.execute({
        principal: viewer,
        input: { knowledgeBaseId: fixture.knowledgeBaseId, documentId: privateLegacySkipId },
      })
    ).rejects.toThrow('Document not found')
    await expect(
      readKnowledgeDocument.execute({
        principal: otherViewer,
        input: { knowledgeBaseId: fixture.knowledgeBaseId, documentId: sourceFailureId },
      })
    ).rejects.toThrow('Document not found')
  })

  it('uses the same status for the regular knowledge base list and document detail', async () => {
    const result = await listKnowledgeDocuments.execute({
      principal: viewer,
      input: { knowledgeBaseId: fixture.knowledgeBaseId },
    })
    expect(result.documents.map((row) => row.id).sort()).toEqual([...skipIds, ...failureIds].sort())
    for (const row of result.documents) {
      const expectedOutcome = skipIds.includes(row.id) ? 'skipped' : null
      expect(row.processingStatus).toBe('failed')
      expect(row.processingOutcome).toBe(expectedOutcome)
      const detail = await readKnowledgeDocument.execute({
        principal: viewer,
        input: { knowledgeBaseId: fixture.knowledgeBaseId, documentId: row.id },
      })
      expect(detail.document.processingStatus).toBe('failed')
      expect(detail.document.processingOutcome).toBe(expectedOutcome)
      expect(detail.document.processingError).toBe(row.processingError)
    }
  })

  it('rejects skipped and source-failed retries without changing stored outcomes or embedding dispatch', async () => {
    const embed = vi
      .spyOn(embeddings, 'embedKnowledge')
      .mockRejectedValue(new Error('Unexpected embedding dispatch'))
    const retryIds = [...skipIds, sourceFailureId]
    const before = await db.select().from(document).where(inArray(document.id, retryIds))
    try {
      for (const documentId of retryIds) {
        await expect(
          updateKnowledgeDocument.execute({
            principal: viewer,
            input: { knowledgeBaseId: fixture.knowledgeBaseId, documentId, retryProcessing: true },
          })
        ).rejects.toThrow(
          documentId === sourceFailureId ? 'Sync the connector' : 'intentionally skipped'
        )
      }
      for (const documentId of skipIds) {
        const stored = before.find((row) => row.id === documentId)!
        const result = await retryDocumentProcessing(
          fixture.knowledgeBaseId,
          documentId,
          stored,
          'fixture-skipped-retry',
          undefined
        )
        expect(result).toMatchObject({ success: false, status: 'skipped' })
        expect(result.message).toContain('intentionally skipped')
      }
      const after = await db.select().from(document).where(inArray(document.id, retryIds))
      expect(after.sort((left, right) => left.id.localeCompare(right.id))).toEqual(
        before.sort((left, right) => left.id.localeCompare(right.id))
      )
      expect(
        await db.select().from(embedding).where(inArray(embedding.documentId, retryIds))
      ).toEqual([])
      expect(embed).not.toHaveBeenCalled()
    } finally {
      embed.mockRestore()
    }
  })

  it.each([false, true])(
    'preserves legacy and current skips against delayed tokenless workers (missing context: %s)',
    async (missingContext) => {
      const processor = vi
        .spyOn(documentProcessor, 'processDocument')
        .mockRejectedValue(new Error('Unexpected skipped document processing'))
      const embed = vi
        .spyOn(embeddings, 'embedKnowledge')
        .mockRejectedValue(new Error('Unexpected embedding dispatch'))
      const before = await db.select().from(document).where(inArray(document.id, skipIds))
      try {
        if (missingContext) {
          await db
            .update(knowledgeBase)
            .set({ deletedAt: new Date() })
            .where(eq(knowledgeBase.id, fixture.knowledgeBaseId))
        }
        for (const row of before) {
          await processDocumentAsync(
            fixture.knowledgeBaseId,
            row.id,
            row,
            {},
            undefined,
            'fixture-delayed-tokenless-worker',
            { chargedAtDispatch: false }
          )
        }
        const after = await db.select().from(document).where(inArray(document.id, skipIds))
        expect(after.sort((left, right) => left.id.localeCompare(right.id))).toEqual(
          before.sort((left, right) => left.id.localeCompare(right.id))
        )
        expect(processor).not.toHaveBeenCalled()
        expect(embed).not.toHaveBeenCalled()
      } finally {
        if (missingContext) {
          await db
            .update(knowledgeBase)
            .set({ deletedAt: null })
            .where(eq(knowledgeBase.id, fixture.knowledgeBaseId))
        }
        processor.mockRestore()
        embed.mockRestore()
      }
    }
  )

  it('preserves skip outcomes and real failures when a workspace source is removed with documents kept', async () => {
    await expect(
      deleteKnowledgeConnector.execute({
        principal: viewer,
        input: { ...scope, deleteDocuments: false },
      })
    ).rejects.toThrow('cannot be kept')
    await db
      .update(knowledgeBase)
      .set({ isSearchIndex: false })
      .where(eq(knowledgeBase.id, fixture.knowledgeBaseId))
    await db
      .update(knowledgeConnector)
      .set({ accessMode: 'workspace' })
      .where(eq(knowledgeConnector.id, fixture.connectorId))
    /** Workspace syncs write workspace ACLs; detached rows must not retain mirrored grants. */
    await db
      .update(document)
      .set({ acl: ['ws'], aclRequirements: [] })
      .where(eq(document.connectorId, fixture.connectorId))
    const result = await deleteKnowledgeConnector.execute({
      principal: viewer,
      input: { ...scope, deleteDocuments: false },
    })
    expect(result).toMatchObject({ documentsDeleted: 0, documentsKept: 6 })
    const retained = await db
      .select()
      .from(document)
      .where(eq(document.knowledgeBaseId, fixture.knowledgeBaseId))
    expect(retained).toHaveLength(6)
    for (const row of retained) {
      expect(row.connectorId).toBeNull()
      expect(row.acl).toEqual(['ws'])
      expect(row.processingStatus).toBe('failed')
    }
    for (const documentId of skipIds) {
      for (const principal of [viewer, otherViewer]) {
        const detail = await readKnowledgeDocument.execute({
          principal,
          input: { knowledgeBaseId: fixture.knowledgeBaseId, documentId },
        })
        expect(detail.document.processingStatus).toBe('failed')
        expect(detail.document.processingOutcome).toBe('skipped')
      }
      await expect(
        updateKnowledgeDocument.execute({
          principal: viewer,
          input: { knowledgeBaseId: fixture.knowledgeBaseId, documentId, retryProcessing: true },
        })
      ).rejects.toThrow('intentionally skipped')
    }
  })
})
