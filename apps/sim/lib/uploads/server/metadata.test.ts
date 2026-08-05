/**
 * @vitest-environment node
 */
import { workspaceFiles } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { insertFileMetadata } from '@/lib/uploads/server/metadata'

describe('insertFileMetadata content versions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('advances the content version when a replacement upload restores a deleted row', async () => {
    const deleted = {
      id: 'file-1',
      key: 'workspace/workspace-1/file.txt',
      deletedAt: new Date('2026-08-03T00:00:00.000Z'),
      contentUpdatedAt: new Date('2026-08-03T00:00:00.000Z'),
    }
    const restored = {
      ...deleted,
      deletedAt: null,
      contentUpdatedAt: new Date('2026-08-04T00:00:00.000Z'),
    }
    queueTableRows(workspaceFiles, [deleted])
    dbChainMockFns.returning.mockResolvedValueOnce([restored])

    await expect(
      insertFileMetadata({
        key: deleted.key,
        userId: 'user-1',
        workspaceId: 'workspace-1',
        context: 'workspace',
        originalName: 'file.txt',
        contentType: 'text/plain',
        size: 12,
      })
    ).resolves.toEqual(restored)

    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ contentUpdatedAt: expect.anything() })
    )
  })
})
