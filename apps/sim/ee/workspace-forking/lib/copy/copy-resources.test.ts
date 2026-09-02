/**
 * @vitest-environment node
 */

import { folder as folderTable, tableViews, userTableDefinitions } from '@sim/db/schema'
import { sha256Hex } from '@sim/security/hash'
import {
  dbChainMockFns,
  flattenMockConditions,
  resetDbChainMock,
  schemaMock,
  storageServiceMock,
  storageServiceMockFns,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_FORK_RESOURCE_IDS_PER_TYPE } from '@/lib/api/contracts/workspace-fork'
import { hashDurableSecretProvenanceValue } from '@/lib/execution/durable-secret-provenance'
import {
  bindKnowledgeDocumentFieldSecretProvenance,
  createKnowledgeDocumentSourceValue,
} from '@/lib/knowledge/secret-provenance'

const {
  mockIncrementStorageUsageInTx,
  mockDecrementStorageUsageInTx,
  mockResolveStorageBillingContext,
  mockRecordKnowledgeBaseFileOwnership,
  mockPersistCopiedResourceMappings,
  mockDeleteCopiedResourceMappingsByTargets,
} = vi.hoisted(() => ({
  mockIncrementStorageUsageInTx: vi.fn(),
  mockDecrementStorageUsageInTx: vi.fn(),
  mockResolveStorageBillingContext: vi.fn(),
  mockRecordKnowledgeBaseFileOwnership: vi.fn(),
  mockPersistCopiedResourceMappings: vi.fn(),
  mockDeleteCopiedResourceMappingsByTargets: vi.fn(),
}))

vi.mock('@/lib/uploads/core/storage-service', () => storageServiceMock)
vi.mock('@/lib/billing/storage', () => ({
  decrementStorageUsageForBillingContextInTx: mockDecrementStorageUsageInTx,
  incrementStorageUsageForBillingContextInTx: mockIncrementStorageUsageInTx,
  resolveStorageBillingContext: mockResolveStorageBillingContext,
}))
vi.mock('@/lib/uploads/server/metadata', () => ({
  recordKnowledgeBaseFileOwnership: mockRecordKnowledgeBaseFileOwnership,
}))
vi.mock('@/ee/workspace-forking/lib/mapping/mapping-store', () => ({
  persistCopiedResourceMappings: mockPersistCopiedResourceMappings,
  deleteCopiedResourceMappingsByTargets: mockDeleteCopiedResourceMappingsByTargets,
}))

import type { DbOrTx } from '@/lib/db/types'
import {
  copyForkResourceContainers,
  copyForkResourceContent,
  type ForkContentPlan,
  planForkMappedKbDocumentCopies,
} from '@/ee/workspace-forking/lib/copy/copy-resources'
import type { ForkReferenceResolver } from '@/ee/workspace-forking/lib/remap/remap-references'

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
    vi.clearAllMocks()
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

  it('rewrites reference cells to the copied referenced-row identity', async () => {
    const updatedAt = new Date('2026-08-05T00:00:00.000Z')
    dbChainMockFns.limit
      .mockResolvedValueOnce([
        {
          row: {
            id: 'row-order-1',
            tableId: 'src-orders',
            workspaceId: 'src-ws',
            data: { 'col-account': 'row-account-1' },
            secretProvenanceVersion: null,
            updatedAt,
          },
          provenance: null,
          provenanceIsCurrent: false,
        },
      ])
      .mockResolvedValueOnce([
        {
          row: {
            id: 'row-account-1',
            tableId: 'src-accounts',
            workspaceId: 'src-ws',
            data: { 'col-name': 'Acme' },
            secretProvenanceVersion: null,
            updatedAt,
          },
          provenance: null,
          provenanceIsCurrent: false,
        },
      ])

    const result = await copyForkResourceContent({
      contentPlan: basePlan({
        tables: [
          {
            sourceId: 'src-orders',
            childId: 'child-orders',
            dependsOnChildIds: ['child-accounts'],
            referenceColumnTargetTableIds: { 'col-account': 'child-accounts' },
          },
          { sourceId: 'src-accounts', childId: 'child-accounts' },
        ],
      }),
      requestId: 'test',
    })

    expect(result.failed).toBe(0)
    const copiedOrderRows = dbChainMockFns.values.mock.calls[0][0] as Array<{
      data: Record<string, unknown>
    }>
    const copiedAccountRows = dbChainMockFns.values.mock.calls[1][0] as Array<{ id: string }>
    expect(copiedOrderRows[0].data['col-account']).toBe(copiedAccountRows[0].id)
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

  it('copies exact current table provenance and binds it to the copied row timestamp', async () => {
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
          contentUpdatedAt: rowUpdatedAt,
          status: 'exact',
          entries: [{ columnId: 'value', encryptedValue: 'encrypted-value', name: 'VALUE' }],
          updatedAt: rowUpdatedAt,
        },
        provenanceIsCurrent: true,
      },
    ])

    const result = await copyForkResourceContent({
      contentPlan: basePlan({ tables: [{ sourceId: 'src-tbl', childId: 'child-tbl' }] }),
      requestId: 'test',
    })

    expect(result.failed).toBe(0)
    const copiedRows = dbChainMockFns.values.mock.calls[0][0] as Array<{
      id: string
      updatedAt: Date
      secretProvenanceVersion: number
    }>
    expect(dbChainMockFns.values.mock.calls[1][0]).toEqual([
      expect.objectContaining({
        rowId: copiedRows[0].id,
        contentUpdatedAt: copiedRows[0].updatedAt,
        status: 'exact',
        entries: [{ columnId: 'value', encryptedValue: 'encrypted-value', name: 'VALUE' }],
      }),
    ])
  })

  it('fails copied tables whose referenced-table dependency failed to copy', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([
        {
          row: {
            id: 'row-order-1',
            tableId: 'src-orders',
            workspaceId: 'src-ws',
            data: { 'col-account': 'row-account-1' },
            secretProvenanceVersion: null,
            updatedAt: new Date('2026-08-05T00:00:00.000Z'),
          },
          provenance: null,
          provenanceIsCurrent: false,
        },
      ])
      .mockRejectedValueOnce(new Error('copy failed'))

    const result = await copyForkResourceContent({
      contentPlan: basePlan({
        tables: [
          {
            sourceId: 'src-orders',
            childId: 'child-orders',
            dependsOnChildIds: ['child-accounts'],
          },
          { sourceId: 'src-accounts', childId: 'child-accounts' },
        ],
      }),
      requestId: 'test',
    })

    expect(result).toEqual({
      copied: 0,
      failed: 2,
      failures: [
        { kind: 'table', childId: 'child-accounts' },
        { kind: 'table', childId: 'child-orders' },
      ],
    })
    expect(dbChainMockFns.values).toHaveBeenCalledWith([
      expect.objectContaining({ tableId: 'child-orders' }),
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

  it('drops a full-KB placeholder a pre-change worker planned for a connector-managed doc', async () => {
    // Rolling deploy: the fork tx ran on the old code and planned a placeholder for a
    // connector-managed document, which this worker's page query no longer returns. Nothing
    // would ever fill it, so it must be reported for cleanup rather than left archived behind a
    // live mapping that a remapped document-selector still resolves to.
    dbChainMockFns.where.mockImplementationOnce(() => ({
      // The skipped-document count.
      then: (resolve: (rows: unknown[]) => unknown) => resolve([{ total: 1 }]),
    }))
    dbChainMockFns.where.mockImplementationOnce(() => ({
      // The stale-plan probe: the planned source is connector-managed.
      then: (resolve: (rows: unknown[]) => unknown) => resolve([{ id: 'doc-1' }]),
    }))
    dbChainMockFns.limit.mockResolvedValueOnce([])

    const result = await copyForkResourceContent({
      contentPlan: basePlan({
        knowledgeBases: [
          { sourceId: 'src-kb', childId: 'child-kb', documentIdMap: { 'doc-1': 'child-doc-1' } },
        ],
        documentMappingContext: { edgeChildWorkspaceId: 'edge-child-ws', sourceIsParent: false },
      }),
      requestId: 'test',
    })

    expect(result.failed).toBe(1)
    expect(result.failures).toEqual([{ kind: 'knowledge-document', childId: 'child-doc-1' }])
    // The persisted identity goes too, or a later sync resolves to the row cleanup deletes.
    expect(mockDeleteCopiedResourceMappingsByTargets).toHaveBeenCalledWith({
      executor: expect.anything(),
      edgeChildWorkspaceId: 'edge-child-ws',
      sourceIsParent: false,
      targets: [{ resourceType: 'knowledge_document', resourceId: 'child-doc-1' }],
    })
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

  it('keeps a copied KB alive when the skipped-document count fails', async () => {
    // The count only feeds a log line. Letting it throw into the KB's catch would roll back a
    // perfectly good copy and clear every reference to it over a failed COUNT(*).
    dbChainMockFns.where.mockImplementationOnce(() => {
      throw new Error('count failed')
    })
    dbChainMockFns.limit.mockResolvedValueOnce([])

    const result = await copyForkResourceContent({
      contentPlan: basePlan({
        knowledgeBases: [{ sourceId: 'src-kb', childId: 'child-kb', documentIdMap: {} }],
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

  it('reuses a content-addressed blob only after hashing the current source bytes', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([sourceDoc])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([sourceDoc])
    const body = Buffer.from('same-source-bytes')
    const expectedKey = `kb/fork-child-doc-1-${sha256Hex(body)}`
    storageServiceMockFns.mockDownloadFile.mockResolvedValueOnce(body)
    storageServiceMockFns.mockHeadObject.mockResolvedValueOnce({ size: body.length })

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
    expect(storageServiceMockFns.mockDownloadFile).toHaveBeenCalledTimes(1)
    expect(storageServiceMockFns.mockHeadObject).toHaveBeenCalledWith(expectedKey, 'knowledge-base')
    expect(storageServiceMockFns.mockUploadFile).not.toHaveBeenCalled()
    expect(storageServiceMockFns.mockDeleteFile).not.toHaveBeenCalled()
  })

  it('persists every successfully copied full-KB document identity with bounded page orientation', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([sourceDoc])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([sourceDoc])

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

    expect(result).toEqual({ copied: 1, failed: 0, failures: [] })
    expect(mockPersistCopiedResourceMappings).toHaveBeenCalledWith({
      executor: expect.anything(),
      edgeChildWorkspaceId: 'edge-child-ws',
      userId: 'user-1',
      sourceIsParent: true,
      entries: [
        {
          resourceType: 'knowledge_document',
          parentResourceId: 'doc-1',
          childResourceId: expect.stringMatching(/^fork_document_/),
        },
      ],
    })
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

  it('does not resolve KB billing context for an empty document page', async () => {
    const result = await copyForkResourceContent({
      contentPlan: basePlan({
        knowledgeBases: [{ sourceId: 'src-kb', childId: 'child-kb', documentIdMap: {} }],
      }),
      requestId: 'test',
    })

    expect(result).toEqual({ copied: 1, failed: 0, failures: [] })
    expect(mockResolveStorageBillingContext).not.toHaveBeenCalled()
    expect(storageServiceMockFns.mockHeadObject).not.toHaveBeenCalled()
  })

  it('does not resolve KB billing context when the page is fully finalized from a prior attempt', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([sourceDoc]).mockResolvedValueOnce([
      {
        id: 'child-doc-1',
        knowledgeBaseId: 'child-kb',
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

    expect(result).toEqual({ copied: 1, failed: 0, failures: [] })
    expect(mockResolveStorageBillingContext).not.toHaveBeenCalled()
    expect(storageServiceMockFns.mockHeadObject).not.toHaveBeenCalled()
    expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
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

  it('repairs a missing mapping for a full-KB document finalized by a prior attempt', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([sourceDoc]).mockResolvedValueOnce([
      {
        id: 'child-doc-1',
        knowledgeBaseId: 'child-kb',
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
        documentMappingContext: {
          edgeChildWorkspaceId: 'edge-child-ws',
          sourceIsParent: false,
        },
      }),
      requestId: 'test',
    })

    expect(result).toEqual({ copied: 1, failed: 0, failures: [] })
    expect(mockResolveStorageBillingContext).not.toHaveBeenCalled()
    expect(mockPersistCopiedResourceMappings).toHaveBeenCalledWith({
      executor: expect.anything(),
      edgeChildWorkspaceId: 'edge-child-ws',
      userId: 'user-1',
      sourceIsParent: false,
      entries: [
        {
          resourceType: 'knowledge_document',
          parentResourceId: 'doc-1',
          childResourceId: 'child-doc-1',
        },
      ],
    })
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

  it('rejects an archived full-KB target owned by another knowledge base before external I/O', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([sourceDoc]).mockResolvedValueOnce([
      {
        id: 'child-doc-1',
        knowledgeBaseId: 'other-kb',
        storageKey: null,
        archivedAt: new Date('2026-08-06T00:00:00.000Z'),
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

    expect(result.failed).toBe(1)
    expect(storageServiceMockFns.mockDownloadFile).not.toHaveBeenCalled()
    expect(storageServiceMockFns.mockUploadFile).not.toHaveBeenCalled()
  })

  it('rejects an archived full-KB target with a different storage key before external I/O', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([sourceDoc]).mockResolvedValueOnce([
      {
        id: 'child-doc-1',
        knowledgeBaseId: 'child-kb',
        storageKey: 'kb/unrelated',
        archivedAt: new Date('2026-08-06T00:00:00.000Z'),
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

    expect(result.failed).toBe(1)
    expect(storageServiceMockFns.mockDownloadFile).not.toHaveBeenCalled()
    expect(storageServiceMockFns.mockUploadFile).not.toHaveBeenCalled()
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

  it('#4 leaves a skill untouched when nothing in its re-read body remaps', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      { id: 'child-skill-1', content: 'no references here' },
    ])

    const result = await copyForkResourceContent({
      contentPlan: basePlan({ skills: [{ childId: 'child-skill-1' }] }),
      contentRefMaps: { knowledgeBases: new Map([['src-kb', 'child-kb']]) },
      requestId: 'test',
    })

    expect(result.failed).toBe(0)
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('#4 skips the skill re-read + rewrite entirely when no content maps are supplied', async () => {
    await copyForkResourceContent({
      contentPlan: basePlan({ skills: [{ childId: 'child-skill-1' }] }),
      requestId: 'test',
    })

    // No maps -> the body is neither re-read from the DB nor updated.
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
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

  it('surfaces rollback failure instead of reporting an ordinary KB resource failure', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([sourceDoc])
    dbChainMockFns.values.mockImplementationOnce(() => {
      throw new Error('insert failed')
    })
    mockDecrementStorageUsageInTx.mockRejectedValueOnce(new Error('rollback failed'))

    await expect(
      copyForkResourceContent({
        contentPlan: basePlan({
          knowledgeBases: [{ sourceId: 'src-kb', childId: 'child-kb', documentIdMap: {} }],
        }),
        requestId: 'test',
      })
    ).rejects.toThrow(
      'Copied knowledge base child-kb failed and its storage rollback also failed: rollback failed'
    )
  })

  it('U-docs: fills a document copied into an existing target KB (blob re-key + placeholder update)', async () => {
    queueMappedDocumentCopy()

    const result = await copyForkResourceContent({
      contentPlan: mappedDocumentPlan(),
      requestId: 'test',
    })

    expect(result.failed).toBe(0)
    expect(result.copied).toBe(1)
    // The blob is re-keyed and the pre-created placeholder row's blob fields are updated.
    expect(storageServiceMockFns.mockUploadFile).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.update).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ secretProvenanceVersion: null })
    )
    expect(dbChainMockFns.values).not.toHaveBeenCalledWith(
      expect.objectContaining({ documentId: 'child-doc-1' })
    )
  })

  it('U-docs: rebinds tracked document provenance through the shared document copier', async () => {
    const source = {
      ...sourceDoc,
      ...createKnowledgeDocumentSourceValue(sourceDoc),
      secretProvenanceVersion: 1,
    }
    const sourceValue = createKnowledgeDocumentSourceValue(source)
    const provenance = bindKnowledgeDocumentFieldSecretProvenance(
      {
        status: 'exact',
        entries: [{ name: 'DOCUMENT_NAME', encryptedValue: 'encrypted-name' }],
      },
      'filename',
      source.filename
    )
    queueMappedDocumentCopy(source, {
      ...source,
      provenanceSourceHash: hashDurableSecretProvenanceValue(sourceValue),
      status: 'exact',
      entries: provenance.status === 'exact' ? provenance.entries : [],
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
        status: 'exact',
        entries: [
          expect.objectContaining({
            name: 'DOCUMENT_NAME',
            encryptedValue: 'encrypted-name',
            sourceValueHash: expect.any(String),
          }),
        ],
      })
    )
  })

  it('U-docs: keeps exact-empty provenance tracked instead of turning it into legacy state', async () => {
    const source = {
      ...sourceDoc,
      ...createKnowledgeDocumentSourceValue(sourceDoc),
      secretProvenanceVersion: 1,
    }
    const sourceValue = createKnowledgeDocumentSourceValue(source)
    queueMappedDocumentCopy(source, {
      ...source,
      provenanceSourceHash: hashDurableSecretProvenanceValue(sourceValue),
      status: 'exact',
      entries: [],
    })

    const result = await copyForkResourceContent({
      contentPlan: mappedDocumentPlan(),
      requestId: 'test',
    })

    expect(result).toEqual({ copied: 1, failed: 0, failures: [] })
    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'child-doc-1',
        status: 'exact',
        entries: [],
      })
    )
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

  it('U-docs: a failed document fill is reported as a knowledge-document failure (for cleanup)', async () => {
    queueMappedDocumentCopy()

    // The placeholder blob update throws; the doc fails on its own without touching its KB.
    dbChainMockFns.set.mockImplementationOnce(() => {
      throw new Error('update failed')
    })

    const result = await copyForkResourceContent({
      contentPlan: {
        ...mappedDocumentPlan(),
        documentMappingContext: {
          edgeChildWorkspaceId: 'edge-child-ws',
          sourceIsParent: false,
        },
      },
      requestId: 'test',
    })

    expect(result.copied).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.failures).toEqual([{ kind: 'knowledge-document', childId: 'child-doc-1' }])
    expect(mockDeleteCopiedResourceMappingsByTargets).toHaveBeenCalledWith({
      executor: expect.anything(),
      edgeChildWorkspaceId: 'edge-child-ws',
      sourceIsParent: false,
      targets: [{ resourceType: 'knowledge_document', resourceId: 'child-doc-1' }],
    })
  })

  it('U-docs: refuses a connector-managed source planned before the exclusion existed', async () => {
    // A payload queued by a pre-change worker during a rolling deploy: the planner would no
    // longer emit this entry, so the fill must drop the placeholder rather than detach a copy
    // of a connector-managed document into the existing target KB.
    dbChainMockFns.limit
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ...sourceDoc, connectorId: 'connector-1' }])

    const result = await copyForkResourceContent({
      contentPlan: mappedDocumentPlan(),
      requestId: 'test',
    })

    expect(result.copied).toBe(0)
    expect(result.failures).toEqual([{ kind: 'knowledge-document', childId: 'child-doc-1' }])
    expect(storageServiceMockFns.mockDownloadFile).not.toHaveBeenCalled()
    expect(mockIncrementStorageUsageInTx).not.toHaveBeenCalled()
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

  it('U-docs: rejects an active target owned by another knowledge base', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        id: 'child-doc-1',
        knowledgeBaseId: 'other-kb',
        storageKey: 'kb/fork-child-doc-1',
        archivedAt: null,
        deletedAt: null,
      },
    ])

    const result = await copyForkResourceContent({
      contentPlan: mappedDocumentPlan(),
      requestId: 'test',
    })

    expect(result).toEqual({
      copied: 0,
      failed: 1,
      failures: [{ kind: 'knowledge-document', childId: 'child-doc-1' }],
    })
    expect(storageServiceMockFns.mockDownloadFile).not.toHaveBeenCalled()
    expect(storageServiceMockFns.mockUploadFile).not.toHaveBeenCalled()
  })
})

describe('copyForkResourceContainers table views', () => {
  it('rejects a mapped referenced table when row mappings are unavailable', async () => {
    const now = new Date('2026-08-19T00:00:00.000Z')
    const selectedDefinition = {
      id: 'table-orders',
      workspaceId: 'src-ws',
      folderId: null,
      name: 'Orders',
      description: null,
      schema: {
        columns: [
          {
            id: 'col-account',
            name: 'Account',
            type: 'reference',
            referenceTableId: 'table-accounts',
          },
        ],
      },
      metadata: {},
      maxRows: 10000,
      rowCount: 1,
      rowsVersion: 1,
      schemaLocked: false,
      insertLocked: false,
      updateLocked: false,
      deleteLocked: false,
      archivedAt: null,
      createdBy: 'source-user',
      createdAt: now,
      updatedAt: now,
    }
    const insert = vi.fn()
    const tx = {
      select: () => ({
        from: () => ({ where: () => Promise.resolve([selectedDefinition]) }),
      }),
      insert,
    }

    await expect(
      copyForkResourceContainers({
        tx: tx as unknown as DbOrTx,
        sourceWorkspaceId: 'src-ws',
        childWorkspaceId: 'child-ws',
        userId: 'user-1',
        now,
        selection: {
          customTools: [],
          skills: [],
          mcpServers: [],
          workflowMcpServers: [],
          tables: ['table-orders'],
          knowledgeBases: [],
        },
        workflowIdMap: new Map(),
        resolveMappedTableReference: (sourceTableId) =>
          sourceTableId === 'table-accounts' ? 'target-accounts' : null,
        documentMappingContext: { edgeChildWorkspaceId: 'child-ws', sourceIsParent: true },
      })
    ).rejects.toThrow(
      'Referenced table table-accounts is mapped to target-accounts, but referenced row mappings are unavailable'
    )
    expect(insert).not.toHaveBeenCalled()
  })

  it('rejects an unavailable referenced-table dependency before inserting copies', async () => {
    const now = new Date('2026-08-19T00:00:00.000Z')
    const selectedDefinition = {
      id: 'table-orders',
      workspaceId: 'src-ws',
      folderId: null,
      name: 'Orders',
      description: null,
      schema: {
        columns: [
          {
            id: 'col-account',
            name: 'Account',
            type: 'reference',
            referenceTableId: 'table-accounts',
          },
        ],
      },
      metadata: {},
      maxRows: 10000,
      rowCount: 1,
      rowsVersion: 1,
      schemaLocked: false,
      insertLocked: false,
      updateLocked: false,
      deleteLocked: false,
      archivedAt: null,
      createdBy: 'source-user',
      createdAt: now,
      updatedAt: now,
    }
    const insert = vi.fn()
    let definitionRead = 0
    const tx = {
      select: () => ({
        from: () => ({
          where: () => Promise.resolve(definitionRead++ === 0 ? [selectedDefinition] : []),
        }),
      }),
      insert,
    }

    await expect(
      copyForkResourceContainers({
        tx: tx as unknown as DbOrTx,
        sourceWorkspaceId: 'src-ws',
        childWorkspaceId: 'child-ws',
        userId: 'user-1',
        now,
        selection: {
          customTools: [],
          skills: [],
          mcpServers: [],
          workflowMcpServers: [],
          tables: ['table-orders'],
          knowledgeBases: [],
        },
        workflowIdMap: new Map(),
        documentMappingContext: { edgeChildWorkspaceId: 'child-ws', sourceIsParent: true },
      })
    ).rejects.toThrow('Referenced table table-accounts is unavailable for copy')
    expect(insert).not.toHaveBeenCalled()
  })

  it('bounds the expanded referenced-table dependency set', async () => {
    const tx = { select: vi.fn(), insert: vi.fn() }

    await expect(
      copyForkResourceContainers({
        tx: tx as unknown as DbOrTx,
        sourceWorkspaceId: 'src-ws',
        childWorkspaceId: 'child-ws',
        userId: 'user-1',
        now: new Date('2026-08-19T00:00:00.000Z'),
        selection: {
          customTools: [],
          skills: [],
          mcpServers: [],
          workflowMcpServers: [],
          tables: Array.from(
            { length: MAX_FORK_RESOURCE_IDS_PER_TYPE + 1 },
            (_, index) => `table-${index}`
          ),
          knowledgeBases: [],
        },
        workflowIdMap: new Map(),
        documentMappingContext: { edgeChildWorkspaceId: 'child-ws', sourceIsParent: true },
      })
    ).rejects.toThrow(
      `Cannot copy more than ${MAX_FORK_RESOURCE_IDS_PER_TYPE} tables including referenced dependencies`
    )
    expect(tx.select).not.toHaveBeenCalled()
  })

  it('copies referenced tables transitively and remaps reference columns to their child ids', async () => {
    const now = new Date('2026-08-19T00:00:00.000Z')
    const definitions = [
      {
        id: 'table-orders',
        workspaceId: 'src-ws',
        folderId: null,
        name: 'Orders',
        description: null,
        schema: {
          columns: [
            {
              id: 'col-account',
              name: 'Account',
              type: 'reference',
              referenceTableId: 'table-accounts',
            },
          ],
        },
        metadata: {},
        maxRows: 10000,
        rowCount: 1,
        rowsVersion: 1,
        schemaLocked: false,
        insertLocked: false,
        updateLocked: false,
        deleteLocked: false,
        archivedAt: null,
        createdBy: 'source-user',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'table-accounts',
        workspaceId: 'src-ws',
        folderId: null,
        name: 'Accounts',
        description: null,
        schema: {
          columns: [
            {
              id: 'col-company',
              name: 'Company',
              type: 'reference',
              referenceTableId: 'table-companies',
            },
          ],
        },
        metadata: {},
        maxRows: 10000,
        rowCount: 1,
        rowsVersion: 1,
        schemaLocked: false,
        insertLocked: false,
        updateLocked: false,
        deleteLocked: false,
        archivedAt: null,
        createdBy: 'source-user',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'table-companies',
        workspaceId: 'src-ws',
        folderId: null,
        name: 'Companies',
        description: null,
        schema: { columns: [{ id: 'col-name', name: 'Name', type: 'string' }] },
        metadata: {},
        maxRows: 10000,
        rowCount: 1,
        rowsVersion: 1,
        schemaLocked: false,
        insertLocked: false,
        updateLocked: false,
        deleteLocked: false,
        archivedAt: null,
        createdBy: 'source-user',
        createdAt: now,
        updatedAt: now,
      },
    ]
    const inserted = new Map<unknown, Array<Record<string, unknown>>>()
    let definitionRead = 0
    const tx = {
      select: () => ({
        from: (table: unknown) => ({
          where: () => {
            if (table === tableViews) return Promise.resolve([])
            if (table !== userTableDefinitions) return Promise.resolve([])
            const rows = [definitions[definitionRead]].filter(Boolean)
            definitionRead += 1
            return Promise.resolve(rows)
          },
        }),
      }),
      insert: (table: unknown) => ({
        values: (values: Array<Record<string, unknown>>) => {
          inserted.set(table, values)
          return Promise.resolve()
        },
      }),
    }

    const result = await copyForkResourceContainers({
      tx: tx as unknown as DbOrTx,
      sourceWorkspaceId: 'src-ws',
      childWorkspaceId: 'child-ws',
      userId: 'user-1',
      now,
      selection: {
        customTools: [],
        skills: [],
        mcpServers: [],
        workflowMcpServers: [],
        tables: ['table-orders'],
        knowledgeBases: [],
      },
      workflowIdMap: new Map(),
      documentMappingContext: { edgeChildWorkspaceId: 'child-ws', sourceIsParent: true },
    })

    const tableMap = result.idMap.get('table')
    const childOrdersId = tableMap?.get('table-orders')
    const childAccountsId = tableMap?.get('table-accounts')
    const childCompaniesId = tableMap?.get('table-companies')
    expect(tableMap?.size).toBe(3)
    expect(result.names.tables).toEqual(['Orders', 'Accounts', 'Companies'])
    expect(result.contentPlan.tables).toEqual([
      {
        sourceId: 'table-orders',
        childId: childOrdersId,
        dependsOnChildIds: [childAccountsId],
        referenceColumnTargetTableIds: { 'col-account': childAccountsId },
      },
      {
        sourceId: 'table-accounts',
        childId: childAccountsId,
        dependsOnChildIds: [childCompaniesId],
        referenceColumnTargetTableIds: { 'col-company': childCompaniesId },
      },
      { sourceId: 'table-companies', childId: childCompaniesId },
    ])

    const copiedDefinitions = inserted.get(userTableDefinitions)
    expect(copiedDefinitions).toHaveLength(3)
    expect(
      copiedDefinitions?.find((definition) => definition.id === childOrdersId)?.schema
    ).toMatchObject({ columns: [{ referenceTableId: childAccountsId }] })
    expect(
      copiedDefinitions?.find((definition) => definition.id === childAccountsId)?.schema
    ).toMatchObject({ columns: [{ referenceTableId: childCompaniesId }] })
  })

  it('copies saved views and seeds a default for a legacy table', async () => {
    const now = new Date('2026-08-19T00:00:00.000Z')
    const definitions = [
      {
        id: 'table-with-view',
        workspaceId: 'src-ws',
        folderId: null,
        name: 'Configured table',
        description: null,
        schema: { columns: [{ id: 'col-name', name: 'Name', type: 'string' }] },
        metadata: { columnOrder: ['col-name'] },
        maxRows: 10000,
        rowCount: 1,
        rowsVersion: 1,
        schemaLocked: false,
        insertLocked: false,
        updateLocked: false,
        deleteLocked: false,
        archivedAt: null,
        createdBy: 'source-user',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'legacy-table',
        workspaceId: 'src-ws',
        folderId: null,
        name: 'Legacy table',
        description: null,
        schema: { columns: [{ id: 'col-email', name: 'Email', type: 'string' }] },
        metadata: { columnOrder: ['col-email'] },
        maxRows: 10000,
        rowCount: 0,
        rowsVersion: 0,
        schemaLocked: false,
        insertLocked: false,
        updateLocked: false,
        deleteLocked: false,
        archivedAt: null,
        createdBy: 'source-user',
        createdAt: now,
        updatedAt: now,
      },
    ]
    const sourceViews = [
      {
        id: 'source-view',
        tableId: 'table-with-view',
        workspaceId: 'src-ws',
        name: 'My view',
        config: { hiddenColumns: ['col-name'] },
        isDefault: true,
        createdBy: 'source-user',
        createdAt: now,
        updatedAt: now,
      },
    ]
    const inserted = new Map<unknown, Array<Record<string, unknown>>>()
    const tx = {
      select: () => ({
        from: (table: unknown) => ({
          where: () =>
            Promise.resolve(
              table === userTableDefinitions ? definitions : table === tableViews ? sourceViews : []
            ),
        }),
      }),
      insert: (table: unknown) => ({
        values: (values: Array<Record<string, unknown>>) => {
          inserted.set(table, values)
          return Promise.resolve()
        },
      }),
    }

    const result = await copyForkResourceContainers({
      tx: tx as unknown as DbOrTx,
      sourceWorkspaceId: 'src-ws',
      childWorkspaceId: 'child-ws',
      userId: 'user-1',
      now,
      selection: {
        customTools: [],
        skills: [],
        mcpServers: [],
        workflowMcpServers: [],
        tables: definitions.map((definition) => definition.id),
        knowledgeBases: [],
      },
      workflowIdMap: new Map(),
      documentMappingContext: { edgeChildWorkspaceId: 'child-ws', sourceIsParent: true },
    })

    const copiedTableId = result.idMap.get('table')?.get('table-with-view')
    const legacyTableId = result.idMap.get('table')?.get('legacy-table')
    const copiedViews = inserted.get(tableViews)
    expect(copiedViews).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tableId: copiedTableId,
          workspaceId: 'child-ws',
          name: 'My view',
          config: { hiddenColumns: ['col-name'] },
          isDefault: true,
          createdBy: 'user-1',
        }),
        expect.objectContaining({
          tableId: legacyTableId,
          workspaceId: 'child-ws',
          name: 'Default',
          config: { columnOrder: ['col-email'] },
          isDefault: true,
          createdBy: 'user-1',
        }),
      ])
    )
    expect(copiedViews?.find((view) => view.name === 'My view')?.id).not.toBe('source-view')
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

  it('preserves custom-tool code verbatim when no env resolver is provided (fork-create)', async () => {
    const { tx, inserted } = makeContainerTx([
      { id: 'ct-1', title: 'Tool', code: 'fetch("{{SLACK_API_KEY}}")' },
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
    })
    expect(inserted[0].code).toBe('fetch("{{SLACK_API_KEY}}")')
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

  it('copies the skill body IN-DB and carries only the child id in the content plan', async () => {
    // The source projection deliberately omits `content` (it is copied server-side), so the row
    // fed to the tx mock has none - the body must never be materialized in app memory here.
    const { tx, inserted } = makeSkillTx([[sourceSkillRow], []])

    const result = await copyForkResourceContainers({
      tx,
      sourceWorkspaceId: 'src-ws',
      childWorkspaceId: 'child-ws',
      userId: 'user-1',
      now: new Date(),
      selection: skillSelection,
      workflowIdMap: new Map(),
      documentMappingContext: { edgeChildWorkspaceId: 'child-ws', sourceIsParent: true },
    })

    expect(inserted).toHaveLength(1)
    const childId = inserted[0].id as string
    expect(childId).not.toBe('sk-1')
    expect(inserted[0].workspaceId).toBe('child-ws')
    expect(inserted[0].userId).toBe('user-1')
    // The body is deferred to a correlated subquery (in-DB copy), never a materialized string.
    expect(typeof inserted[0].content).not.toBe('string')
    // The content plan carries ONLY the child id - no skill body text crosses the job payload.
    expect(result.contentPlan.skills).toEqual([{ childId }])
    expect(result.names.skills).toEqual(['My Skill'])
  })

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

  it('no-ops the tag-definition copy for a KB with zero definitions', async () => {
    const { tx, inserts } = makeKbTx([[sourceBase], []])

    await copyForkResourceContainers({
      tx,
      sourceWorkspaceId: 'src-ws',
      childWorkspaceId: 'child-ws',
      userId: 'user-1',
      now: new Date(),
      selection: kbSelection,
      workflowIdMap: new Map(),
      documentMappingContext: { edgeChildWorkspaceId: 'child-ws', sourceIsParent: true },
    })

    // Only the KB row itself is inserted - no empty tag-definition insert.
    expect(inserts).toHaveLength(1)
  })

  it('does not pre-create a placeholder for a referenced connector-managed document', async () => {
    const { tx, wheres } = makeKbTx([[sourceBase], [], []])

    const result = await copyForkResourceContainers({
      tx,
      sourceWorkspaceId: 'src-ws',
      childWorkspaceId: 'child-ws',
      userId: 'user-1',
      now: new Date(),
      selection: kbSelection,
      workflowIdMap: new Map(),
      referencedDocumentIds: ['doc-1'],
      documentMappingContext: { edgeChildWorkspaceId: 'child-ws', sourceIsParent: true },
    })

    // Must agree with the content phase's exclusion: a placeholder with no content copy behind
    // it would stay archived forever while its persisted mapping pointed at it.
    const placeholderWhere = wheres.find(({ table }) => table === schemaMock.document)?.condition
    expect(
      flattenMockConditions(placeholderWhere).some(
        (node) => node.type === 'isNull' && node.column === schemaMock.document.connectorId
      )
    ).toBe(true)
    expect(result.mappingEntries.some((entry) => entry.resourceType === 'knowledge_document')).toBe(
      false
    )
    expect(result.contentPlan.knowledgeBases[0].documentIdMap).toEqual({})
  })

  it('mirrors the source knowledge-base folder and copies the KB into it, not the target root', async () => {
    const foldered = { ...sourceBase, folderId: 'kb-folder' }
    const { tx, inserts } = makeKbTx(
      [[foldered], []],
      [
        {
          id: 'kb-folder',
          name: 'Policies',
          parentId: null,
          workspaceId: 'src-ws',
          resourceType: 'knowledge_base',
          deletedAt: null,
        },
      ]
    )

    await copyForkResourceContainers({
      tx,
      sourceWorkspaceId: 'src-ws',
      childWorkspaceId: 'child-ws',
      userId: 'user-1',
      now: new Date(),
      selection: kbSelection,
      workflowIdMap: new Map(),
      documentMappingContext: { edgeChildWorkspaceId: 'child-ws', sourceIsParent: true },
    })

    // insert #0 is the mirrored folder, #1 the KB row placed inside it.
    const newFolder = inserts[0][0]
    expect(newFolder).toMatchObject({
      name: 'Policies',
      workspaceId: 'child-ws',
      resourceType: 'knowledge_base',
    })
    // A fresh id: reusing the source's would point the child KB at a folder it cannot see.
    expect(newFolder.id).not.toBe('kb-folder')
    expect(inserts[1][0].folderId).toBe(newFolder.id)
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

  it('skips a doc already placed under a copied KB this sync (no duplicate query)', async () => {
    const { tx, selectCalls } = makeTx([sourceRow('doc-1', 'src-kb')])
    const result = await planForkMappedKbDocumentCopies({
      tx,
      resolver: mappedKbResolver,
      referencedDocumentIds: ['doc-1'],
      alreadyCopiedSourceDocIds: new Set(['doc-1']),
      now,
    })
    expect(result.documents).toHaveLength(0)
    expect(selectCalls()).toBe(0)
  })

  it('skips a doc that already resolves (mapped by a prior sync)', async () => {
    const { tx, selectCalls } = makeTx([sourceRow('doc-1', 'src-kb')])
    const result = await planForkMappedKbDocumentCopies({
      tx,
      resolver: (kind, id) =>
        kind === 'knowledge-document' && id === 'doc-1' ? 'existing-child-doc' : null,
      referencedDocumentIds: ['doc-1'],
      alreadyCopiedSourceDocIds: new Set(),
      now,
    })
    expect(result.documents).toHaveLength(0)
    expect(selectCalls()).toBe(0)
  })

  it('adopts an already-active deterministic target without copying its content again', async () => {
    const childDocId = copiedId('doc-1')
    const { tx, inserted } = makeTx(
      [sourceRow('doc-1', 'src-kb')],
      [
        {
          id: childDocId,
          knowledgeBaseId: 'target-kb',
          storageKey: `kb/fork-${childDocId}`,
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
    expect(result.mappingEntries).toEqual([
      {
        resourceType: 'knowledge_document',
        parentResourceId: 'doc-1',
        childResourceId: childDocId,
      },
    ])
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

  it('rejects an active deterministic target with a different storage key', async () => {
    const childDocId = copiedId('doc-1')
    const { tx } = makeTx(
      [sourceRow('doc-1', 'src-kb')],
      [
        {
          id: childDocId,
          knowledgeBaseId: 'target-kb',
          storageKey: 'kb/unrelated',
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
    ).rejects.toThrow(`Copied document ${childDocId} has conflicting storage`)
  })
})
