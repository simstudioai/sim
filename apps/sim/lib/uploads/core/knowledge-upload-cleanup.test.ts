/**
 * @vitest-environment node
 */
import { document, workspaceFiles } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockHead, mockDeleteVersion } = vi.hoisted(() => ({
  mockHead: vi.fn(),
  mockDeleteVersion: vi.fn(),
}))

vi.mock('@/lib/uploads/upload-session/provider', () => ({
  uploadStorageProvider: () => 's3',
  headProviderObject: mockHead,
  deleteProviderObjectVersion: mockDeleteVersion,
}))

import { cleanupUnboundKnowledgeUpload } from '@/lib/uploads/core/knowledge-upload-cleanup'

const KEY = 'kb/new.txt'
const UPLOAD_ID = 'attempt-1'

describe('cleanupUnboundKnowledgeUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockHead.mockResolvedValue({ uploadId: UPLOAD_ID, version: 'etag-1' })
    mockDeleteVersion.mockResolvedValue(undefined)
  })

  afterAll(resetDbChainMock)

  it('conditionally deletes only the version created by this attempt', async () => {
    await cleanupUnboundKnowledgeUpload(KEY, UPLOAD_ID)

    expect(mockHead).toHaveBeenCalledExactlyOnceWith({
      provider: 's3',
      key: KEY,
      context: 'knowledge-base',
    })
    expect(mockDeleteVersion).toHaveBeenCalledExactlyOnceWith({
      provider: 's3',
      key: KEY,
      context: 'knowledge-base',
      version: 'etag-1',
    })
    expect(dbChainMockFns.where.mock.calls).toEqual([
      [{ type: 'eq', left: workspaceFiles.key, right: KEY }],
      [{ type: 'eq', left: document.storageKey, right: KEY }],
    ])
    expect(dbChainMockFns.limit.mock.calls).toEqual([[1], [1]])
  })

  it.each([workspaceFiles, document])(
    'preserves any surviving or rebound canonical reference',
    async (table) => {
      queueTableRows(table, [{ id: 'survivor' }])

      await cleanupUnboundKnowledgeUpload(KEY, UPLOAD_ID)

      expect(mockHead).not.toHaveBeenCalled()
      expect(mockDeleteVersion).not.toHaveBeenCalled()
    }
  )

  it('preserves an object now owned by a different upload attempt', async () => {
    mockHead.mockResolvedValueOnce({ uploadId: 'different-attempt', version: 'etag-2' })

    await cleanupUnboundKnowledgeUpload(KEY, UPLOAD_ID)

    expect(mockDeleteVersion).not.toHaveBeenCalled()
  })

  it('accepts an object already removed by organization cleanup', async () => {
    mockHead.mockResolvedValueOnce(null)

    await expect(cleanupUnboundKnowledgeUpload(KEY, UPLOAD_ID)).resolves.toBeUndefined()

    expect(mockDeleteVersion).not.toHaveBeenCalled()
  })

  it('does not delete when canonical binding lookup is unavailable', async () => {
    dbChainMockFns.limit.mockRejectedValueOnce(new Error('database unavailable'))

    await expect(cleanupUnboundKnowledgeUpload(KEY, UPLOAD_ID)).rejects.toThrow(
      'database unavailable'
    )

    expect(mockHead).not.toHaveBeenCalled()
    expect(mockDeleteVersion).not.toHaveBeenCalled()
  })

  it('propagates a version conflict without falling back to unconditional deletion', async () => {
    mockDeleteVersion.mockRejectedValueOnce(new Error('precondition failed'))

    await expect(cleanupUnboundKnowledgeUpload(KEY, UPLOAD_ID)).rejects.toThrow(
      'precondition failed'
    )

    expect(mockDeleteVersion).toHaveBeenCalledTimes(1)
  })
})
