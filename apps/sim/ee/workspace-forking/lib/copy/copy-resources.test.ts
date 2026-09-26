import { folder as folderTable } from '@sim/db/schema'
import { sha256Hex } from '@sim/security/hash'
import {
  dbChainMockFns,
  flattenMockConditions,
  resetDbChainMock,
  schemaMock,
  storageServiceMock,
  storageServiceMockFns,
} from '@sim/testing'
import { billingStorageMock, billingStorageMockFns } from '@sim/testing/mocks/billing-storage.mock'
import {
  uploadsMetadataMock,
  uploadsMetadataMockFns,
} from '@sim/testing/mocks/uploads-metadata.mock'
import {
  workspaceForkingMappingStoreMock,
  workspaceForkingMappingStoreMockFns,
} from '@sim/testing/mocks/workspace-forking-mapping-store.mock'
import { sleep } from '@sim/utils/helpers'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createKnowledgeDocumentSourceValue } from '@/lib/knowledge/secret-provenance'

vi.mock('@/lib/uploads/core/storage-service', () => storageServiceMock)
vi.mock('@/lib/billing/storage', () => billingStorageMock)
vi.mock('@/lib/uploads/server/metadata', () => uploadsMetadataMock)
vi.mock('@/ee/workspace-forking/lib/mapping/mapping-store', () => workspaceForkingMappingStoreMock)

import type { DbOrTx } from '@/lib/db/types'
import type { ForkReferenceResolver } from '@/lib/workflows/references/remap-references'
import {
  copyForkResourceContainers,
  copyForkResourceContent,
  type ForkContentPlan,
  planForkMappedKbDocumentCopies,
} from '@/ee/workspace-forking/lib/copy/copy-resources'
import {
  ForkCopyContinuation,
  type ForkCopyProgress,
} from '@/ee/workspace-forking/lib/copy/progress'

const {
  mockIncrementStorageUsageForBillingContextInTx: mockIncrementStorageUsageInTx,
  mockDecrementStorageUsageForBillingContextInTx: mockDecrementStorageUsageInTx,
  mockResolveStorageBillingContext,
} = billingStorageMockFns
const { mockPersistCopiedResourceMappings, mockDeleteCopiedResourceMappingsByTargets } =
  workspaceForkingMappingStoreMockFns

const mockRecordKnowledgeBaseFileOwnership =
  uploadsMetadataMockFns.mockRecordKnowledgeBaseFileOwnership

function basePlan(overrides: Partial<ForkContentPlan> = {}): ForkContentPlan {
  return {
    sourceWorkspaceId: 'src-ws',
    childWorkspaceId: 'child-ws',
    userId: 'user-1',
    tables: [],
    knowledgeBases: [],
    skills: [],
    documents: [],
    ...overrides,
  }
}

const sourceDoc = {
  id: 'doc-1',
  knowledgeBaseId: 'src-kb',
  secretProvenanceVersion: null,
  storageKey: 'kb/source-key',
  fileUrl: '/api/files/serve/kb%2Fsource-key',
  filename: 'report.pdf',
  fileSize: 321,
  mimeType: 'application/pdf',
}

function queueMappedDocumentCopy(
  source: Record<string, unknown> = sourceDoc,
  provenanceRow: Record<string, unknown> = source
): void {
  dbChainMockFns.limit
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([source])
    .mockResolvedValueOnce([provenanceRow])
    .mockResolvedValueOnce([])
}

function mappedDocumentPlan(): ForkContentPlan {
  return basePlan({
    documents: [
      {
        sourceDocId: 'doc-1',
        childDocId: 'child-doc-1',
        childKnowledgeBaseId: 'existing-target-kb',
        storageKey: 'kb/source-key',
        fileUrl: '/api/files/serve/kb%2Fsource-key',
        fileSize: 321,
        filename: 'report.pdf',
        mimeType: 'application/pdf',
      },
    ],
  })
}

describe('copyForkResourceContent', () => {
  beforeEach(() => {
    resetDbChainMock()
    dbChainMockFns.returning.mockResolvedValue([{ id: 'activated-document' }])
    dbChainMockFns.for.mockResolvedValue([{ workspaceId: 'child-ws' }])
    storageServiceMockFns.mockHeadObject.mockResolvedValue(null)
    storageServiceMockFns.mockDownloadFile.mockResolvedValue(Buffer.from('blob-bytes'))
    storageServiceMockFns.mockUploadFile.mockResolvedValue({
      key: 'kb/child-key',
      path: '/api/files/serve/kb/child-key',
    })
    mockResolveStorageBillingContext.mockResolvedValue({
      workspaceId: 'child-ws',
      billedAccountUserId: 'target-payer',
      billingEntity: { type: 'user', id: 'target-payer' },
      plan: 'pro',
      customStorageLimitGB: null,
    })
    mockIncrementStorageUsageInTx.mockResolvedValue(321)
    mockDecrementStorageUsageInTx.mockResolvedValue(undefined)
    mockRecordKnowledgeBaseFileOwnership.mockResolvedValue(undefined)
  })

  it('rewrites in-workspace resource URLs nested in copied table cell data', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        row: {
          id: 'r1',
          tableId: 'src-tbl',
          workspaceId: 'src-ws',
          data: {
            kb: '/workspace/src-ws/knowledge/kb-1',
            nested: { wf: '/workspace/src-ws/w/wf-1' },
            plain: 'no url here',
          },
          secretProvenanceVersion: null,
          updatedAt: new Date('2026-08-05T00:00:00.000Z'),
        },
        provenance: null,
        provenanceIsCurrent: false,
      },
    ])

    const result = await copyForkResourceContent({
      contentPlan: basePlan({ tables: [{ sourceId: 'src-tbl', childId: 'child-tbl' }] }),
      contentRefMaps: {
        workspaceId: { from: 'src-ws', to: 'child-ws' },
        knowledgeBases: new Map([['kb-1', 'kb-2']]),
        workflows: new Map([['wf-1', 'wf-2']]),
      },
      requestId: 'test',
    })

    expect(result.failed).toBe(0)
    // The first insert is the table-rows copy (no KBs/docs/skills in this plan).
    const inserted = dbChainMockFns.values.mock.calls[0][0] as Array<{
      data: { kb: string; nested: { wf: string }; plain: string }
    }>
    expect(inserted[0].data.kb).toBe('/workspace/child-ws/knowledge/kb-2')
    expect(inserted[0].data.nested.wf).toBe('/workspace/child-ws/w/wf-2')
    expect(inserted[0].data.plain).toBe('no url here')
    expect(inserted[0]).toEqual(expect.objectContaining({ secretProvenanceVersion: null }))
  })

  it('turns stale tracked table provenance into unknown instead of laundering it', async () => {
    const rowUpdatedAt = new Date('2026-08-05T00:00:00.000Z')
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        row: {
          id: 'r1',
          tableId: 'src-tbl',
          workspaceId: 'src-ws',
          data: { value: 'stored value' },
          secretProvenanceVersion: 1,
          updatedAt: rowUpdatedAt,
        },
        provenance: {
          rowId: 'r1',
          contentUpdatedAt: new Date('2026-08-04T00:00:00.000Z'),
          status: 'exact',
          entries: [],
          updatedAt: rowUpdatedAt,
        },
        provenanceIsCurrent: false,
      },
    ])

    const result = await copyForkResourceContent({
      contentPlan: basePlan({ tables: [{ sourceId: 'src-tbl', childId: 'child-tbl' }] }),
      requestId: 'test',
    })

    expect(result.failed).toBe(0)
    expect(dbChainMockFns.values.mock.calls[0][0]).toEqual([
      expect.objectContaining({ secretProvenanceVersion: 1 }),
    ])
    expect(dbChainMockFns.values.mock.calls[1][0]).toEqual([
      expect.objectContaining({
        contentUpdatedAt: rowUpdatedAt,
        status: 'unknown',
        entries: [],
      }),
    ])
  })

  it('#1 binds a copied KB document blob to the CHILD workspace + initiating user', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([sourceDoc])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([sourceDoc])

    const result = await copyForkResourceContent({
      contentPlan: basePlan({
        knowledgeBases: [{ sourceId: 'src-kb', childId: 'child-kb', documentIdMap: {} }],
      }),
      requestId: 'test',
    })

    expect(result.failed).toBe(0)
    expect(result.copied).toBe(1)
    expect(storageServiceMockFns.mockUploadFile).toHaveBeenCalledTimes(1)
    const uploadArg = storageServiceMockFns.mockUploadFile.mock.calls[0][0]
    expect(uploadArg.context).toBe('knowledge-base')
    expect(uploadArg.preserveKey).toBe(true)
    expect(uploadArg.metadata).toEqual({
      userId: 'user-1',
      workspaceId: 'child-ws',
      originalName: 'report.pdf',
    })
    expect(mockRecordKnowledgeBaseFileOwnership).toHaveBeenNthCalledWith(1, {
      key: uploadArg.customKey,
      userId: 'user-1',
      workspaceId: 'child-ws',
      originalName: 'report.pdf',
      contentType: 'application/pdf',
      size: 321,
    })
    expect(mockRecordKnowledgeBaseFileOwnership).toHaveBeenCalledWith(
      {
        key: uploadArg.customKey,
        userId: 'user-1',
        workspaceId: 'child-ws',
        originalName: 'report.pdf',
        contentType: 'application/pdf',
        size: 321,
      },
      expect.anything()
    )
    expect(mockRecordKnowledgeBaseFileOwnership.mock.invocationCallOrder[0]).toBeLessThan(
      storageServiceMockFns.mockUploadFile.mock.invocationCallOrder[0]
    )
    expect(mockRecordKnowledgeBaseFileOwnership.mock.invocationCallOrder[0]).toBeLessThan(
      mockIncrementStorageUsageInTx.mock.invocationCallOrder[0]
    )
    // Compatibility with a content-copy job queued before document mapping context existed.
    expect(mockPersistCopiedResourceMappings).not.toHaveBeenCalled()
  })

  it('never copies a connector-managed document out of the source knowledge base', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([])

    const result = await copyForkResourceContent({
      contentPlan: basePlan({
        knowledgeBases: [{ sourceId: 'src-kb', childId: 'child-kb', documentIdMap: {} }],
      }),
      requestId: 'test',
    })

    expect(result).toEqual({ copied: 1, failed: 0, failures: [] })
    // The row queue returns whatever is enqueued regardless of the predicate, so the exclusion
    // is only observable in the condition tree. Pinned to the column so the assertion keeps its
    // meaning if another nullable filter joins the same clause.
    const pageWhere = dbChainMockFns.where.mock.calls.at(-1)?.[0]
    expect(
      flattenMockConditions(pageWhere).some(
        (node) => node.type === 'isNull' && node.column === schemaMock.document.connectorId
      )
    ).toBe(true)
  })

  it('keeps a copied KB alive when the stale-plan probe fails', async () => {
    // The probe runs on every KB with referenced documents, but the state it repairs only exists
    // inside a rollout window. Letting it reach the KB catch would delete a complete copy and
    // clear every reference to it over a transient SELECT.
    dbChainMockFns.where.mockImplementationOnce(() => ({
      then: (resolve: (rows: unknown[]) => unknown) => resolve([{ total: 0 }]),
    }))
    dbChainMockFns.where.mockImplementationOnce(() => {
      throw new Error('stale-plan probe failed')
    })
    dbChainMockFns.limit.mockResolvedValueOnce([])

    const result = await copyForkResourceContent({
      contentPlan: basePlan({
        knowledgeBases: [
          { sourceId: 'src-kb', childId: 'child-kb', documentIdMap: { 'doc-1': 'child-doc-1' } },
        ],
      }),
      requestId: 'test',
    })

    expect(result).toEqual({ copied: 1, failed: 0, failures: [] })
  })

  it('uses the blob content digest so a retry cannot adopt an older failed snapshot', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([sourceDoc])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([sourceDoc])
    const body = Buffer.from('new-source-bytes')
    storageServiceMockFns.mockDownloadFile.mockResolvedValueOnce(body)
    storageServiceMockFns.mockHeadObject.mockImplementationOnce(async (key: string) =>
      key === 'kb/fork-child-doc-1' ? { size: 321 } : null
    )

    const result = await copyForkResourceContent({
      contentPlan: basePlan({
        knowledgeBases: [
          {
            sourceId: 'src-kb',
            childId: 'child-kb',
            documentIdMap: { 'doc-1': 'child-doc-1' },
          },
        ],
      }),
      requestId: 'test',
    })

    const expectedKey = `kb/fork-child-doc-1-${sha256Hex(body)}`
    expect(result).toEqual({ copied: 1, failed: 0, failures: [] })
    expect(storageServiceMockFns.mockHeadObject).toHaveBeenCalledWith(expectedKey, 'knowledge-base')
    expect(storageServiceMockFns.mockUploadFile).toHaveBeenCalledWith(
      expect.objectContaining({ customKey: expectedKey })
    )
    expect(mockRecordKnowledgeBaseFileOwnership).toHaveBeenCalledWith(
      expect.objectContaining({ key: expectedKey }),
      expect.anything()
    )
  })

  it('keeps the KB all-or-nothing when its document mapping page cannot be persisted', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([sourceDoc])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([sourceDoc])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'copied-doc-target' }])
    storageServiceMockFns.mockHeadObject.mockResolvedValueOnce({})
    mockPersistCopiedResourceMappings.mockRejectedValueOnce(new Error('mapping write failed'))

    const result = await copyForkResourceContent({
      contentPlan: basePlan({
        knowledgeBases: [{ sourceId: 'src-kb', childId: 'child-kb', documentIdMap: {} }],
        documentMappingContext: {
          edgeChildWorkspaceId: 'edge-child-ws',
          sourceIsParent: true,
        },
      }),
      requestId: 'test',
    })

    expect(result).toEqual({
      copied: 0,
      failed: 1,
      failures: [{ kind: 'knowledge-base', childId: 'child-kb', documentChildIds: [] }],
    })
    expect(mockDecrementStorageUsageInTx).toHaveBeenCalled()
    expect(mockDeleteCopiedResourceMappingsByTargets).toHaveBeenCalledWith({
      executor: expect.anything(),
      edgeChildWorkspaceId: 'edge-child-ws',
      sourceIsParent: true,
      targets: [{ resourceType: 'knowledge_document', resourceId: 'copied-doc-target' }],
    })
    expect(dbChainMockFns.set).toHaveBeenCalledWith({ deletedAt: expect.any(Date) })
    expect(storageServiceMockFns.mockUploadFile).not.toHaveBeenCalled()
    expect(storageServiceMockFns.mockDeleteFile).not.toHaveBeenCalled()
  })

  it('refuses to pair a stale document snapshot with newer provenance', async () => {
    const newerSource = { ...sourceDoc, filename: 'newer-report.pdf' }
    dbChainMockFns.limit
      .mockResolvedValueOnce([sourceDoc])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([newerSource])

    const result = await copyForkResourceContent({
      contentPlan: basePlan({
        knowledgeBases: [{ sourceId: 'src-kb', childId: 'child-kb', documentIdMap: {} }],
      }),
      requestId: 'test',
    })

    expect(result).toEqual({
      copied: 0,
      failed: 1,
      failures: [{ kind: 'knowledge-base', childId: 'child-kb', documentChildIds: [] }],
    })
    expect(storageServiceMockFns.mockDownloadFile).not.toHaveBeenCalled()
    expect(storageServiceMockFns.mockUploadFile).not.toHaveBeenCalled()
    expect(mockRecordKnowledgeBaseFileOwnership).not.toHaveBeenCalled()
    expect(mockIncrementStorageUsageInTx).not.toHaveBeenCalled()
  })

  it('charges each copied KB blob by exact document bytes in the metadata activation transaction', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([sourceDoc])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([sourceDoc])

    const result = await copyForkResourceContent({
      contentPlan: basePlan({
        knowledgeBases: [{ sourceId: 'src-kb', childId: 'child-kb', documentIdMap: {} }],
      }),
      requestId: 'test',
    })

    expect(result.copied).toBe(1)
    expect(storageServiceMockFns.mockUploadFile).toHaveBeenCalledTimes(1)
    expect(storageServiceMockFns.mockUploadFile).toHaveBeenCalledWith(
      expect.objectContaining({ persistMetadata: false })
    )
    expect(mockResolveStorageBillingContext).toHaveBeenCalledWith('child-ws')
    expect(mockIncrementStorageUsageInTx).toHaveBeenCalledTimes(1)
    expect(mockIncrementStorageUsageInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        workspaceId: 'child-ws',
        billedAccountUserId: 'target-payer',
      }),
      321
    )
    expect(storageServiceMockFns.mockUploadFile.mock.invocationCallOrder[0]).toBeLessThan(
      mockIncrementStorageUsageInTx.mock.invocationCallOrder[0]
    )
  })

  it('leaves a discoverable ownership reservation when a copied KB upload fails', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([sourceDoc])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([sourceDoc])
    storageServiceMockFns.mockUploadFile.mockRejectedValueOnce(new Error('upload failed'))

    const result = await copyForkResourceContent({
      contentPlan: basePlan({
        knowledgeBases: [
          {
            sourceId: 'src-kb',
            childId: 'child-kb',
            documentIdMap: { 'doc-1': 'child-doc-1' },
          },
        ],
      }),
      requestId: 'test',
    })

    const targetKey = `kb/fork-child-doc-1-${sha256Hex(Buffer.from('blob-bytes'))}`
    expect(result.failed).toBe(1)
    expect(mockRecordKnowledgeBaseFileOwnership).toHaveBeenCalledWith({
      key: targetKey,
      userId: 'user-1',
      workspaceId: 'child-ws',
      originalName: 'report.pdf',
      contentType: 'application/pdf',
      size: 321,
    })
    expect(mockRecordKnowledgeBaseFileOwnership.mock.invocationCallOrder[0]).toBeLessThan(
      storageServiceMockFns.mockUploadFile.mock.invocationCallOrder[0]
    )
    expect(storageServiceMockFns.mockDeleteFile).not.toHaveBeenCalled()
  })

  it('adopts a finalized content-addressed document from a prior attempt', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([sourceDoc]).mockResolvedValueOnce([
      {
        id: 'child-doc-1',
        knowledgeBaseId: 'child-kb',
        storageKey: `kb/fork-child-doc-1-${'a'.repeat(64)}`,
        archivedAt: null,
        deletedAt: null,
      },
    ])

    const result = await copyForkResourceContent({
      contentPlan: basePlan({
        knowledgeBases: [
          {
            sourceId: 'src-kb',
            childId: 'child-kb',
            documentIdMap: { 'doc-1': 'child-doc-1' },
          },
        ],
      }),
      requestId: 'test',
    })

    expect(result).toEqual({ copied: 1, failed: 0, failures: [] })
    expect(storageServiceMockFns.mockDownloadFile).not.toHaveBeenCalled()
    expect(storageServiceMockFns.mockUploadFile).not.toHaveBeenCalled()
  })

  it('rejects an active full-KB target with conflicting ownership before external I/O', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([sourceDoc]).mockResolvedValueOnce([
      {
        id: 'child-doc-1',
        knowledgeBaseId: 'other-kb',
        storageKey: 'kb/fork-child-doc-1',
        archivedAt: null,
        deletedAt: null,
      },
    ])

    const result = await copyForkResourceContent({
      contentPlan: basePlan({
        knowledgeBases: [
          {
            sourceId: 'src-kb',
            childId: 'child-kb',
            documentIdMap: { 'doc-1': 'child-doc-1' },
          },
        ],
      }),
      requestId: 'test',
    })

    expect(result).toEqual({
      copied: 0,
      failed: 1,
      failures: [
        { kind: 'knowledge-base', childId: 'child-kb', documentChildIds: ['child-doc-1'] },
      ],
    })
    expect(storageServiceMockFns.mockDownloadFile).not.toHaveBeenCalled()
    expect(storageServiceMockFns.mockUploadFile).not.toHaveBeenCalled()
    expect(mockPersistCopiedResourceMappings).not.toHaveBeenCalled()
  })

  it('keeps finalization authoritative when another attempt activates after the page replay guard', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([sourceDoc])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([sourceDoc])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'child-doc-1',
          knowledgeBaseId: 'child-kb',
          storageKey: 'kb/fork-child-doc-1',
          filename: 'winner.pdf',
          mimeType: 'application/pdf',
          fileSize: 456,
          uploadedBy: 'winner-user',
          archivedAt: null,
          deletedAt: null,
        },
      ])
    dbChainMockFns.returning.mockResolvedValueOnce([])

    const result = await copyForkResourceContent({
      contentPlan: basePlan({
        knowledgeBases: [
          {
            sourceId: 'src-kb',
            childId: 'child-kb',
            documentIdMap: { 'doc-1': 'child-doc-1' },
          },
        ],
      }),
      requestId: 'test',
    })

    expect(result).toEqual({ copied: 1, failed: 0, failures: [] })
    expect(storageServiceMockFns.mockUploadFile).toHaveBeenCalledTimes(1)
    expect(mockResolveStorageBillingContext).toHaveBeenCalledTimes(1)
    expect(mockRecordKnowledgeBaseFileOwnership).toHaveBeenCalledWith(
      {
        key: 'kb/fork-child-doc-1',
        userId: 'winner-user',
        workspaceId: 'child-ws',
        originalName: 'winner.pdf',
        contentType: 'application/pdf',
        size: 456,
      },
      expect.anything()
    )
    expect(mockIncrementStorageUsageInTx).not.toHaveBeenCalled()
    expect(storageServiceMockFns.mockDeleteFile).toHaveBeenCalledWith({
      key: `kb/fork-child-doc-1-${sha256Hex(Buffer.from('blob-bytes'))}`,
      context: 'knowledge-base',
    })
  })

  it('#4 re-reads a copied skill body post-commit and rewrites it via db.update (never from payload)', async () => {
    // The body is no longer carried in the plan - the content phase keyset-re-reads the child row.
    dbChainMockFns.limit.mockResolvedValueOnce([
      { id: 'child-skill-1', content: 'see [K](sim:knowledge/src-kb)' },
    ])

    const result = await copyForkResourceContent({
      contentPlan: basePlan({ skills: [{ childId: 'child-skill-1' }] }),
      contentRefMaps: { knowledgeBases: new Map([['src-kb', 'child-kb']]) },
      requestId: 'test',
    })

    expect(result.failed).toBe(0)
    expect(dbChainMockFns.update).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.set).toHaveBeenCalledWith({
      content: 'see [K](sim:knowledge/child-kb)',
    })
  })

  it('#3 fails the whole KB (all-or-nothing) when one document copy throws', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([sourceDoc])
    // The document row insert throws; the blob copy is best-effort (never throws) so the
    // failure must come from the persisted copy, marking the entire KB failed for cleanup.
    dbChainMockFns.values.mockImplementationOnce(() => {
      throw new Error('insert failed')
    })

    const result = await copyForkResourceContent({
      contentPlan: basePlan({
        knowledgeBases: [{ sourceId: 'src-kb', childId: 'child-kb', documentIdMap: {} }],
      }),
      requestId: 'test',
    })

    expect(result.copied).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.failures).toEqual([
      { kind: 'knowledge-base', childId: 'child-kb', documentChildIds: [] },
    ])
  })

  it('drains in-flight document copies before yielding a knowledge base continuation', async () => {
    const secondSource = { ...sourceDoc, id: 'doc-2', storageKey: 'kb/second-source' }
    dbChainMockFns.limit
      .mockResolvedValueOnce([sourceDoc, secondSource])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([sourceDoc])
      .mockResolvedValueOnce([secondSource])
      .mockResolvedValueOnce([])
    let releaseCopy = () => {}
    let reportInterrupted = () => {}
    const copying = new Promise<void>((resolve) => {
      releaseCopy = resolve
    })
    const interrupted = new Promise<void>((resolve) => {
      reportInterrupted = resolve
    })
    const continuation = new ForkCopyContinuation('resume the next attempt')
    storageServiceMockFns.mockDownloadFile.mockImplementation(async ({ key }: { key: string }) => {
      if (key === 'kb/second-source') {
        reportInterrupted()
        throw continuation
      }
      await copying
      return Buffer.from('blob-bytes')
    })
    let settled = false
    const outcome = copyForkResourceContent({
      contentPlan: basePlan({
        knowledgeBases: [{ sourceId: 'src-kb', childId: 'child-kb', documentIdMap: {} }],
      }),
    }).then(
      (result) => {
        settled = true
        return result
      },
      (error: unknown) => {
        settled = true
        return error
      }
    )
    await interrupted
    await sleep(1)
    try {
      expect(settled).toBe(false)
      expect(mockDecrementStorageUsageInTx).not.toHaveBeenCalled()
    } finally {
      releaseCopy()
    }
    expect(await outcome).toBe(continuation)
    expect(mockIncrementStorageUsageInTx).toHaveBeenCalledTimes(1)
    expect(mockDecrementStorageUsageInTx).not.toHaveBeenCalled()
  })

  it('refuses to resume retained embeddings after the source is reprocessed', async () => {
    const source = { ...sourceDoc, processingQueueToken: 'generation-1' }
    dbChainMockFns.limit
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([source])
      .mockResolvedValueOnce([source])
      .mockResolvedValueOnce([
        {
          id: 'embedding-1',
          documentId: 'doc-1',
          content: 'old content',
          secretProvenanceVersion: null,
        },
      ])
    const progress: ForkCopyProgress = { completed: [], tables: {}, embeddings: {} }
    const control = {
      progress,
      checkpoint: vi.fn(async () => {
        if (progress.embeddings['child-doc-1']?.afterId) {
          throw new ForkCopyContinuation('continue after first page')
        }
      }),
    }
    await expect(
      copyForkResourceContent({ contentPlan: mappedDocumentPlan(), control })
    ).rejects.toBeInstanceOf(ForkCopyContinuation)
    expect(progress.embeddings['child-doc-1']).toMatchObject({
      afterId: 'embedding-1',
      knowledgeBaseId: 'existing-target-kb',
      sourceRevision: expect.any(String),
    })
    const prior = structuredClone(progress)
    const copiedWrites = dbChainMockFns.values.mock.calls.length
    queueMappedDocumentCopy({ ...source, processingQueueToken: 'generation-2' })
    const result = await copyForkResourceContent({ contentPlan: mappedDocumentPlan(), control })
    expect(result).toEqual({
      copied: 0,
      failed: 1,
      failures: [{ kind: 'knowledge-document', childId: 'child-doc-1' }],
    })
    expect(progress).toEqual(prior)
    expect(dbChainMockFns.values.mock.calls).toHaveLength(copiedWrites)
    expect(mockIncrementStorageUsageInTx).not.toHaveBeenCalled()
    expect(storageServiceMockFns.mockDownloadFile).toHaveBeenCalledTimes(1)
  })

  it('does not activate a document after its lease expires while waiting for the knowledge base lock', async () => {
    queueMappedDocumentCopy()
    const controller = new AbortController()
    dbChainMockFns.for.mockImplementationOnce(async () => {
      controller.abort(new Error('lease expired while waiting for lock'))
      return [{ workspaceId: 'child-ws' }]
    })
    await expect(
      copyForkResourceContent({
        contentPlan: mappedDocumentPlan(),
        control: { signal: controller.signal },
      })
    ).rejects.toThrow('lease expired while waiting for lock')
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(mockIncrementStorageUsageInTx).not.toHaveBeenCalled()
  })

  it('U-docs: preserves tracked unknown provenance instead of laundering it as legacy', async () => {
    const source = {
      ...sourceDoc,
      ...createKnowledgeDocumentSourceValue(sourceDoc),
      secretProvenanceVersion: 1,
    }
    queueMappedDocumentCopy(source, {
      ...source,
      provenanceSourceHash: null,
      status: null,
      entries: null,
    })

    const result = await copyForkResourceContent({
      contentPlan: mappedDocumentPlan(),
      requestId: 'test',
    })

    expect(result).toEqual({ copied: 1, failed: 0, failures: [] })
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ secretProvenanceVersion: 1 })
    )
    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'child-doc-1',
        status: 'unknown',
        entries: [],
      })
    )
  })

  it('U-docs: refuses to charge when the target knowledge base moved workspaces', async () => {
    queueMappedDocumentCopy()
    dbChainMockFns.for.mockResolvedValueOnce([{ workspaceId: 'other-workspace' }])

    const result = await copyForkResourceContent({
      contentPlan: mappedDocumentPlan(),
      requestId: 'test',
    })

    expect(result.failures).toEqual([{ kind: 'knowledge-document', childId: 'child-doc-1' }])
    expect(mockIncrementStorageUsageInTx).not.toHaveBeenCalled()
  })
})

describe('copyForkResourceContainers custom-tool code env rewrite', () => {
  function makeContainerTx(rows: Array<Record<string, unknown>>) {
    const inserted: Array<Record<string, unknown>> = []
    const tx = {
      select: () => ({ from: () => ({ where: () => Promise.resolve(rows) }) }),
      insert: () => ({
        values: (values: Array<Record<string, unknown>>) => {
          inserted.push(...values)
          return Promise.resolve()
        },
      }),
    }
    return { tx: tx as unknown as DbOrTx, inserted }
  }

  const customToolSelection = {
    customTools: ['ct-1'],
    skills: [],
    mcpServers: [],
    workflowMcpServers: [],
    tables: [],
    knowledgeBases: [],
  }

  it('rewrites {{ENV}} refs in copied custom-tool code when a sync renames the env var', async () => {
    const { tx, inserted } = makeContainerTx([
      { id: 'ct-1', title: 'Tool', code: 'fetch("{{SLACK_API_KEY}}", "{{KEEP}}")' },
    ])
    await copyForkResourceContainers({
      tx,
      sourceWorkspaceId: 'src-ws',
      childWorkspaceId: 'child-ws',
      userId: 'user-1',
      now: new Date(),
      selection: customToolSelection,
      workflowIdMap: new Map(),
      documentMappingContext: { edgeChildWorkspaceId: 'child-ws', sourceIsParent: true },
      resolveEnvName: (key) => (key === 'SLACK_API_KEY' ? 'SLACK_API_KEY_TEST' : key),
    })
    expect(inserted).toHaveLength(1)
    // The renamed key is rewritten; the same-name key is left verbatim.
    expect(inserted[0].code).toBe('fetch("{{SLACK_API_KEY_TEST}}", "{{KEEP}}")')
    expect(inserted[0].workspaceId).toBe('child-ws')
  })
})

describe('copyForkResourceContainers external MCP server copy', () => {
  function makeServerTx(rows: Array<Record<string, unknown>>) {
    const inserted: Array<Record<string, unknown>> = []
    const tx = {
      select: () => ({ from: () => ({ where: () => Promise.resolve(rows) }) }),
      insert: () => ({
        values: (values: Array<Record<string, unknown>>) => {
          inserted.push(...values)
          return Promise.resolve()
        },
      }),
    }
    return { tx: tx as unknown as DbOrTx, inserted }
  }

  it('copies the config row with runtime status reset, records the mapping, and never copies tokens', async () => {
    const { tx, inserted } = makeServerTx([
      {
        id: 'mcp-1',
        workspaceId: 'src-ws',
        createdBy: 'src-user',
        name: 'Linear MCP',
        transport: 'streamable-http',
        url: 'https://mcp.linear.app/mcp',
        authType: 'headers',
        headers: { Authorization: 'Bearer {{LINEAR_KEY}}' },
        connectionStatus: 'connected',
        lastConnected: new Date(),
        lastError: 'old error',
        statusConfig: { consecutiveFailures: 2, lastSuccessfulDiscovery: 'x' },
        toolCount: 12,
        lastToolsRefresh: new Date(),
        totalRequests: 99,
        lastUsed: new Date(),
        deletedAt: null,
      },
    ])

    const result = await copyForkResourceContainers({
      tx,
      sourceWorkspaceId: 'src-ws',
      childWorkspaceId: 'child-ws',
      userId: 'user-1',
      now: new Date(),
      selection: {
        customTools: [],
        skills: [],
        mcpServers: ['mcp-1'],
        workflowMcpServers: [],
        tables: [],
        knowledgeBases: [],
      },
      workflowIdMap: new Map(),
      documentMappingContext: { edgeChildWorkspaceId: 'child-ws', sourceIsParent: true },
    })

    expect(inserted).toHaveLength(1)
    const child = inserted[0]
    expect(child.id).not.toBe('mcp-1')
    expect(child.workspaceId).toBe('child-ws')
    expect(child.createdBy).toBe('user-1')
    // Config copies verbatim - url/headers ({{ENV}} refs resolve against the child's env).
    expect(child.url).toBe('https://mcp.linear.app/mcp')
    expect(child.headers).toEqual({ Authorization: 'Bearer {{LINEAR_KEY}}' })
    // Runtime status resets: tools re-discover on first use in the child (cache is
    // workspace-keyed), and no `mcp_server_oauth` row is ever inserted (re-auth required).
    expect(child.connectionStatus).toBe('disconnected')
    expect(child.lastConnected).toBeNull()
    expect(child.lastError).toBeNull()
    expect(child.toolCount).toBe(0)
    expect(child.lastToolsRefresh).toBeNull()
    // The id map + mapping rows record the copy so subblock references remap onto it.
    expect(result.idMap.get('mcp_server')?.get('mcp-1')).toBe(child.id)
    expect(result.mappingEntries).toContainEqual({
      resourceType: 'mcp_server',
      parentResourceId: 'mcp-1',
      childResourceId: child.id,
    })
    expect(result.names.mcpServers).toEqual(['Linear MCP'])
  })
})

describe('copyForkResourceContainers skill copy', () => {
  /** Sequential tx mock: each select resolves the next queued row set (skill rows, then member rows). */
  function makeSkillTx(selects: Array<Array<Record<string, unknown>>>) {
    let call = 0
    const inserted: Array<Record<string, unknown>> = []
    const tx = {
      select: () => {
        const result = Promise.resolve(selects[call++] ?? [])
        const chain = {
          from: () => chain,
          innerJoin: () => chain,
          where: () => result,
        }
        return chain
      },
      insert: () => ({
        values: (values: Array<Record<string, unknown>>) => {
          inserted.push(...values)
          return Object.assign(Promise.resolve(), {
            onConflictDoNothing: () => Promise.resolve(),
          })
        },
      }),
    }
    return { tx: tx as unknown as DbOrTx, inserted }
  }

  const skillSelection = {
    customTools: [],
    skills: ['sk-1'],
    mcpServers: [],
    workflowMcpServers: [],
    tables: [],
    knowledgeBases: [],
  }

  const sourceSkillRow = {
    id: 'sk-1',
    name: 'My Skill',
    description: 'desc',
    workspaceId: 'src-ws',
    userId: 'src-user',
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  it('copies editor grants onto the child skill for users in the target roster', async () => {
    // The editor query joins the child-workspace permissions in-DB, so the
    // mock's second row set already represents source editors ∩ target roster.
    const { tx, inserted } = makeSkillTx([
      [sourceSkillRow],
      [
        { skillId: 'sk-1', userId: 'editor-1' },
        { skillId: 'sk-1', userId: 'editor-2' },
      ],
    ])

    await copyForkResourceContainers({
      tx,
      sourceWorkspaceId: 'src-ws',
      childWorkspaceId: 'child-ws',
      userId: 'user-1',
      now: new Date(),
      selection: skillSelection,
      workflowIdMap: new Map(),
      documentMappingContext: { edgeChildWorkspaceId: 'child-ws', sourceIsParent: true },
    })

    const childSkill = inserted[0]
    const firstGrant = inserted[1]
    expect(firstGrant.skillId).toBe(childSkill.id)
    expect(firstGrant.userId).toBe('editor-1')

    const secondGrant = inserted[2]
    expect(secondGrant.skillId).toBe(childSkill.id)
    expect(secondGrant.userId).toBe('editor-2')
  })
})

describe('copyForkResourceContainers knowledge-base tag definitions', () => {
  /** Sequential tx mock: each select resolves the next queued row set; inserts are captured per call. */
  /**
   * Sequential tx mock over the KB-copy selects, with the folder-mirroring reads served
   * separately: the copy resolves the source KB folder subtree before inserting, and dispatching
   * on the queried table keeps the queue positional over the KB selects alone instead of
   * silently shifting whenever that mapping issues a query.
   */
  function makeKbTx(
    selects: Array<Array<Record<string, unknown>>>,
    sourceFolders: Array<Record<string, unknown>> = []
  ) {
    let call = 0
    // The mapper reads the source tree first, then the target's; serving the same rows to both
    // would make every source folder look already-present and suppress the mirroring.
    let folderCall = 0
    const inserts: Array<Array<Record<string, unknown>>> = []
    const wheres: Array<{ table: unknown; condition: unknown }> = []
    const tx = {
      select: () => ({
        from: (table: unknown) => ({
          where: (condition: unknown) => {
            wheres.push({ table, condition })
            if (table === folderTable) {
              return Promise.resolve(folderCall++ === 0 ? sourceFolders : [])
            }
            return Promise.resolve(selects[call++] ?? [])
          },
        }),
      }),
      insert: () => ({
        values: (rows: Array<Record<string, unknown>>) => {
          inserts.push(rows)
          return Promise.resolve()
        },
      }),
    }
    return { tx: tx as unknown as DbOrTx, inserts, wheres }
  }

  const kbSelection = {
    customTools: [],
    skills: [],
    mcpServers: [],
    workflowMcpServers: [],
    tables: [],
    knowledgeBases: ['kb-1'],
  }

  const sourceBase = { id: 'kb-1', name: 'Docs KB', workspaceId: 'src-ws', deletedAt: null }

  it('copies the source KB tag definitions to the child KB with fresh ids (other columns verbatim)', async () => {
    const { tx, inserts } = makeKbTx([
      [sourceBase],
      [
        {
          id: 'tag-1',
          knowledgeBaseId: 'kb-1',
          tagSlot: 'tag1',
          displayName: 'Category',
          fieldType: 'text',
        },
        {
          id: 'tag-2',
          knowledgeBaseId: 'kb-1',
          tagSlot: 'boolean1',
          displayName: 'Reviewed',
          fieldType: 'boolean',
        },
      ],
    ])

    const result = await copyForkResourceContainers({
      tx,
      sourceWorkspaceId: 'src-ws',
      childWorkspaceId: 'child-ws',
      userId: 'user-1',
      now: new Date(),
      selection: kbSelection,
      workflowIdMap: new Map(),
      documentMappingContext: { edgeChildWorkspaceId: 'child-ws', sourceIsParent: true },
    })

    const childKbId = result.idMap.get('knowledge_base')?.get('kb-1')
    expect(childKbId).toBeTruthy()
    // insert #0 is the KB row; insert #1 is the tag-definition batch.
    expect(inserts).toHaveLength(2)
    const tagRows = inserts[1]
    expect(tagRows).toHaveLength(2)
    for (const row of tagRows) {
      expect(row.knowledgeBaseId).toBe(childKbId)
      expect(row.id).not.toBe('tag-1')
      expect(row.id).not.toBe('tag-2')
    }
    expect(tagRows.map((row) => [row.tagSlot, row.displayName, row.fieldType])).toEqual([
      ['tag1', 'Category', 'text'],
      ['boolean1', 'Reviewed', 'boolean'],
    ])
  })
})

describe('planForkMappedKbDocumentCopies', () => {
  const now = new Date('2026-08-07T00:00:00.000Z')
  const copiedId = (sourceId: string) =>
    `fork_document_${sha256Hex(`document:target-kb:${sourceId}`).slice(0, 40)}`
  const sourceRow = (id: string, knowledgeBaseId: string) => ({
    id,
    knowledgeBaseId,
    storageKey: `kb/${id}`,
    fileUrl: `/api/files/serve/kb%2F${id}`,
    fileSize: 123,
    filename: `${id}.pdf`,
    mimeType: 'application/pdf',
    // Hand-uploaded: connector-managed documents are filtered out by the candidate query and
    // can never reach the placeholder insert.
    connectorId: null,
    deletedAt: null,
    archivedAt: null,
  })

  function makeTx(
    docs: ReturnType<typeof sourceRow>[],
    existingTargets: Array<{
      id: string
      knowledgeBaseId: string
      storageKey: string | null
      archivedAt: Date | null
      deletedAt: Date | null
    }> = []
  ) {
    const inserted: Array<Record<string, unknown>> = []
    const wheres: unknown[] = []
    let selectCalls = 0
    const tx = {
      select: () => {
        const rows = selectCalls++ === 0 ? docs : existingTargets
        return {
          from: () => ({
            where: (condition: unknown) => {
              wheres.push(condition)
              return Promise.resolve(rows)
            },
          }),
        }
      },
      insert: () => ({
        values: (rows: Array<Record<string, unknown>>) => {
          inserted.push(...rows)
          return Promise.resolve()
        },
      }),
    }
    return { tx: tx as unknown as DbOrTx, inserted, wheres, selectCalls: () => selectCalls }
  }

  const mappedKbResolver: ForkReferenceResolver = (kind, id) =>
    kind === 'knowledge-base' && id === 'src-kb' ? 'target-kb' : null

  it('places a referenced doc into its already-mapped existing KB and returns the maps', async () => {
    const { tx, inserted } = makeTx([sourceRow('doc-1', 'src-kb')])
    const result = await planForkMappedKbDocumentCopies({
      tx,
      resolver: mappedKbResolver,
      referencedDocumentIds: ['doc-1'],
      alreadyCopiedSourceDocIds: new Set(),
      now,
    })

    const childId = result.docIdMap.get('doc-1')
    expect(childId).toBeTruthy()
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({
      id: childId,
      knowledgeBaseId: 'target-kb',
      connectorId: null,
      deletedAt: null,
      archivedAt: expect.any(Date),
      storageKey: null,
      fileSize: 0,
    })
    expect(result.mappingEntries).toEqual([
      { resourceType: 'knowledge_document', parentResourceId: 'doc-1', childResourceId: childId },
    ])
    expect(result.documents).toEqual([
      {
        sourceDocId: 'doc-1',
        childDocId: childId,
        childKnowledgeBaseId: 'target-kb',
        storageKey: 'kb/doc-1',
        fileUrl: '/api/files/serve/kb%2Fdoc-1',
        fileSize: 123,
        filename: 'doc-1.pdf',
        mimeType: 'application/pdf',
      },
    ])
  })

  it('never considers a connector-managed doc as a candidate for the mapped target KB', async () => {
    const { tx, wheres } = makeTx([])
    await planForkMappedKbDocumentCopies({
      tx,
      resolver: mappedKbResolver,
      referencedDocumentIds: ['doc-1'],
      alreadyCopiedSourceDocIds: new Set(),
      now,
    })

    // The tx mock returns its rows regardless of the predicate, so the exclusion is only
    // observable in the condition tree.
    expect(
      flattenMockConditions(wheres[0]).some(
        (node) => node.type === 'isNull' && node.column === schemaMock.document.connectorId
      )
    ).toBe(true)
  })

  it('skips a referenced doc whose parent KB is not mapped (reference is left to be cleared)', async () => {
    const { tx, inserted } = makeTx([sourceRow('doc-1', 'unmapped-kb')])
    const result = await planForkMappedKbDocumentCopies({
      tx,
      resolver: mappedKbResolver,
      referencedDocumentIds: ['doc-1'],
      alreadyCopiedSourceDocIds: new Set(),
      now,
    })
    expect(inserted).toHaveLength(0)
    expect(result.docIdMap.size).toBe(0)
    expect(result.documents).toHaveLength(0)
  })

  it('adopts a legacy active target without a blob after the source gains stored content', async () => {
    const childDocId = copiedId('doc-1')
    const { tx, inserted } = makeTx(
      [sourceRow('doc-1', 'src-kb')],
      [
        {
          id: childDocId,
          knowledgeBaseId: 'target-kb',
          storageKey: null,
          archivedAt: null,
          deletedAt: null,
        },
      ]
    )

    const result = await planForkMappedKbDocumentCopies({
      tx,
      resolver: mappedKbResolver,
      referencedDocumentIds: ['doc-1'],
      alreadyCopiedSourceDocIds: new Set(),
      now,
    })

    expect(inserted).toHaveLength(0)
    expect(result.documents).toHaveLength(0)
    expect(result.docIdMap.get('doc-1')).toBe(childDocId)
  })

  it('adopts an archived deterministic placeholder and schedules its bounded content fill', async () => {
    const childDocId = copiedId('doc-1')
    const { tx, inserted } = makeTx(
      [sourceRow('doc-1', 'src-kb')],
      [
        {
          id: childDocId,
          knowledgeBaseId: 'target-kb',
          storageKey: null,
          archivedAt: new Date('2026-08-06T00:00:00.000Z'),
          deletedAt: null,
        },
      ]
    )

    const result = await planForkMappedKbDocumentCopies({
      tx,
      resolver: mappedKbResolver,
      referencedDocumentIds: ['doc-1'],
      alreadyCopiedSourceDocIds: new Set(),
      now,
    })

    expect(inserted).toHaveLength(0)
    expect(result.documents).toEqual([
      expect.objectContaining({ sourceDocId: 'doc-1', childDocId }),
    ])
    expect(result.mappingEntries).toHaveLength(1)
  })

  it('rejects a deterministic target identity owned by another knowledge base', async () => {
    const childDocId = copiedId('doc-1')
    const { tx } = makeTx(
      [sourceRow('doc-1', 'src-kb')],
      [
        {
          id: childDocId,
          knowledgeBaseId: 'other-kb',
          storageKey: `kb/fork-${childDocId}`,
          archivedAt: null,
          deletedAt: null,
        },
      ]
    )

    await expect(
      planForkMappedKbDocumentCopies({
        tx,
        resolver: mappedKbResolver,
        referencedDocumentIds: ['doc-1'],
        alreadyCopiedSourceDocIds: new Set(),
        now,
      })
    ).rejects.toThrow(`Copied document ${childDocId} has conflicting storage identity`)
  })
})
