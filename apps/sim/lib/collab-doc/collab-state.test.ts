/** @vitest-environment node */
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { lte } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadCollabDocState } from '@/lib/collab-doc/collab-state'

vi.mock('@sim/db/schema', () => ({
  workspaceFileCollabState: {
    fileId: 'file_id',
    docState: 'doc_state',
    sourceHash: 'source_hash',
  },
}))

describe('loadCollabDocState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('bounds the binary in SQL before returning a recovery snapshot', async () => {
    const docState = Buffer.from([0, 0])
    dbChainMockFns.limit.mockResolvedValueOnce([{ docState, sourceHash: 'source-hash' }])

    await expect(loadCollabDocState('file-1', { maxBytes: 1024 })).resolves.toEqual({
      docState: new Uint8Array(docState),
      sourceHash: 'source-hash',
    })
    expect(lte).toHaveBeenCalledWith(
      expect.objectContaining({ strings: ['octet_length(', ')'] }),
      1024
    )
    expect(dbChainMockFns.where).toHaveBeenCalledWith(
      expect.objectContaining({
        conditions: expect.arrayContaining([expect.objectContaining({ type: 'lte', right: 1024 })]),
      })
    )
    expect(dbChainMockFns.limit).toHaveBeenCalledWith(1)
  })

  it('returns null when no snapshot satisfies the recovery byte cap', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([])
    await expect(loadCollabDocState('file-1', { maxBytes: 1024 })).resolves.toBeNull()
  })

  it('preserves cold-seed loading when no recovery cap is requested', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([])
    await expect(loadCollabDocState('file-1')).resolves.toBeNull()
    expect(lte).not.toHaveBeenCalled()
    expect(dbChainMockFns.limit).toHaveBeenCalledWith(1)
  })
})
