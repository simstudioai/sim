/** @vitest-environment node */
import { db } from '@sim/db'
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OutboxEventContext } from '@/lib/core/outbox/service'

const { mockDeleteFile, mockDeleteMetadata, mockGetBindings } = vi.hoisted(() => ({
  mockDeleteFile: vi.fn(),
  mockDeleteMetadata: vi.fn(),
  mockGetBindings: vi.fn(),
}))
vi.mock('@/lib/uploads/core/storage-service', () => ({ deleteFile: mockDeleteFile }))
vi.mock('@/lib/uploads/server/metadata', () => ({
  deleteFileMetadataByIdentity: mockDeleteMetadata,
  getFileMetadataByKeys: mockGetBindings,
}))

import {
  cleanupKnowledgeStorage,
  enqueueKnowledgeStorageCleanup,
  KNOWLEDGE_STORAGE_CLEANUP_EVENT,
} from '@/lib/knowledge/documents/storage-cleanup'

const version = new Date('2026-09-08T00:00:00.123Z')
const binding = {
  id: 'file-1',
  key: 'kb/file-1.txt',
  contentUpdatedAt: version,
  workspaceId: 'workspace-1',
  organizationId: null,
  context: 'knowledge-base',
  deletedAt: null,
  userId: 'owner-1',
}
const payload = {
  version: 1,
  documentId: 'document-1',
  fileId: binding.id,
  key: binding.key,
  contentUpdatedAt: version.toISOString(),
  workspaceId: binding.workspaceId,
  organizationId: null,
}
function context(): OutboxEventContext {
  return {
    eventId: 'cleanup-1',
    eventType: KNOWLEDGE_STORAGE_CLEANUP_EVENT,
    attempts: 0,
    maxAttempts: 48,
    signal: new AbortController().signal,
    checkpointPayload: vi.fn(),
  }
}

describe('durable knowledge storage cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockGetBindings.mockResolvedValue([binding])
    mockDeleteFile.mockResolvedValue(undefined)
    mockDeleteMetadata.mockResolvedValue(true)
  })

  it('caps every binding read and outbox insert while processing a large deletion batch', async () => {
    mockGetBindings.mockImplementation(async (keys: string[]) =>
      keys.map((key) => ({ ...binding, id: key, key }))
    )
    await enqueueKnowledgeStorageCleanup(
      db,
      Array.from({ length: 251 }, (_, id) => ({
        id: `document-${id}`,
        workspaceId: binding.workspaceId,
        fileUrl: `/api/files/serve/${encodeURIComponent(`kb/file-${id}.txt`)}`,
      })),
      'request-1'
    )
    expect(mockGetBindings.mock.calls.map(([keys]) => keys.length)).toEqual([100, 100, 51])
    expect(dbChainMockFns.values.mock.calls.map(([rows]) => rows.length)).toEqual([100, 100, 51])
  })

  it('uses a separate identity for an unattached upload so later release can still be queued', async () => {
    const documents = [
      {
        id: 'document-1',
        workspaceId: binding.workspaceId,
        fileUrl: `/api/files/serve/${encodeURIComponent(binding.key)}`,
      },
    ]
    await enqueueKnowledgeStorageCleanup(db, documents, 'request-1', {
      reason: 'uncommitted-upload',
    })
    await enqueueKnowledgeStorageCleanup(db, documents, 'request-1')
    const rows = dbChainMockFns.values.mock.calls.map(([value]) => value[0])
    expect(rows[0].id).not.toBe(rows[1].id)
    expect(rows[0].payload).toEqual(rows[1].payload)
  })

  it('propagates persistence failures before the parent transaction can commit', async () => {
    dbChainMockFns.returning.mockRejectedValueOnce(new Error('Database unavailable'))
    await expect(
      enqueueKnowledgeStorageCleanup(
        db,
        [
          {
            id: 'document-1',
            workspaceId: binding.workspaceId,
            fileUrl: `/api/files/serve/${encodeURIComponent(binding.key)}`,
          },
        ],
        'request-1'
      )
    ).rejects.toThrow('Database unavailable')
    expect(mockDeleteFile).not.toHaveBeenCalled()
  })

  it('leaves metadata active when storage deletion fails', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([binding]).mockResolvedValueOnce([])
    mockDeleteFile.mockRejectedValueOnce(new Error('Storage temporarily unavailable'))
    await expect(cleanupKnowledgeStorage(payload, context())).rejects.toThrow(
      'Storage temporarily unavailable'
    )
    expect(mockDeleteMetadata).not.toHaveBeenCalled()
  })

  it('binds legacy personal cleanup to the canonical document owner', async () => {
    const personalBinding = { ...binding, workspaceId: null }
    mockGetBindings.mockResolvedValueOnce([personalBinding])
    await enqueueKnowledgeStorageCleanup(
      db,
      [
        {
          id: payload.documentId,
          fileUrl: `/api/files/serve/${encodeURIComponent(binding.key)}`,
          userId: 'owner-1',
        },
      ],
      'personal-cleanup'
    )
    const queued = dbChainMockFns.values.mock.calls[0][0][0]
    expect(queued.payload).toMatchObject({
      userId: 'owner-1',
      workspaceId: null,
      organizationId: null,
    })
    dbChainMockFns.limit.mockResolvedValueOnce([personalBinding]).mockResolvedValueOnce([])
    await cleanupKnowledgeStorage(queued.payload, context())
    expect(mockDeleteFile).toHaveBeenCalledOnce()
  })

  it.each([undefined, 'another-user'])(
    'rejects missing or mismatched personal ownership: %s',
    async (userId) => {
      mockGetBindings.mockResolvedValueOnce([{ ...binding, workspaceId: null }])
      await expect(
        enqueueKnowledgeStorageCleanup(
          db,
          [
            {
              id: payload.documentId,
              fileUrl: `/api/files/serve/${encodeURIComponent(binding.key)}`,
              userId,
            },
          ],
          'personal-cleanup'
        )
      ).rejects.toThrow()
      expect(dbChainMockFns.values).not.toHaveBeenCalled()
      expect(mockDeleteFile).not.toHaveBeenCalled()
    }
  )

  it('retains a personal file if ownership changed after its cleanup was queued', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      { ...binding, workspaceId: null, userId: 'another-user' },
    ])
    await cleanupKnowledgeStorage({ ...payload, workspaceId: null, userId: 'owner-1' }, context())
    expect(mockDeleteFile).not.toHaveBeenCalled()
  })

  it('creates a fresh intent for a later release of the same document and file identity', async () => {
    const documents = [
      {
        id: payload.documentId,
        workspaceId: binding.workspaceId,
        fileUrl: `/api/files/serve/${encodeURIComponent(binding.key)}`,
      },
    ]
    await enqueueKnowledgeStorageCleanup(db, documents, 'first-release')
    await enqueueKnowledgeStorageCleanup(db, documents, 'second-release')
    const rows = dbChainMockFns.values.mock.calls.map(([value]) => value[0])
    expect(rows[0].id).not.toBe(rows[1].id)
    expect(rows[0].payload).toEqual(rows[1].payload)
  })

  it('retries safely after an object was deleted but the transaction did not commit', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([binding]).mockResolvedValueOnce([])
    mockDeleteFile.mockRejectedValueOnce(Object.assign(new Error('Missing'), { code: 'ENOENT' }))
    await cleanupKnowledgeStorage(payload, context())
    expect(mockDeleteMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ id: binding.id, contentUpdatedAt: version }),
      expect.anything()
    )
    expect(mockDeleteFile.mock.invocationCallOrder[0]).toBeLessThan(
      mockDeleteMetadata.mock.invocationCallOrder[0]
    )
  })

  it.each([
    { contentUpdatedAt: new Date(version.getTime() + 1) },
    { workspaceId: 'different-workspace' },
    { context: 'workspace' },
  ])('preserves a replacement ownership binding: %j', async (replacement) => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ ...binding, ...replacement }])
    await cleanupKnowledgeStorage(payload, context())
    expect(mockDeleteFile).not.toHaveBeenCalled()
    expect(mockDeleteMetadata).not.toHaveBeenCalled()
  })

  it('preserves a backing object while any document still references it', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([binding])
      .mockResolvedValueOnce([{ id: 'other-document' }])
    await cleanupKnowledgeStorage(payload, context())
    expect(mockDeleteFile).not.toHaveBeenCalled()
  })

  it('rejects workspace source keys and honors an aborted lease before any side effect', async () => {
    await expect(
      cleanupKnowledgeStorage({ ...payload, key: 'workspace/file' }, context())
    ).rejects.toThrow('knowledge-base key')
    await expect(
      cleanupKnowledgeStorage(payload, {
        ...context(),
        signal: AbortSignal.abort(new Error('lease expired')),
      })
    ).rejects.toThrow('lease expired')
    expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
    expect(mockDeleteFile).not.toHaveBeenCalled()
  })
})
