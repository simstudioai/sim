/**
 * @vitest-environment node
 */
import { dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSetForkLockTimeout, mockAcquireForkEdgeLock } = vi.hoisted(() => ({
  mockSetForkLockTimeout: vi.fn(),
  mockAcquireForkEdgeLock: vi.fn(),
}))

vi.mock('@/ee/workspace-forking/lib/lineage/lineage', () => ({
  setForkLockTimeout: mockSetForkLockTimeout,
  acquireForkEdgeLock: mockAcquireForkEdgeLock,
}))

import { unlinkForkEdge } from '@/ee/workspace-forking/lib/lineage/unlink'

const EDGE = { childWorkspaceId: 'child-ws', parentWorkspaceId: 'parent-ws' }

afterAll(resetDbChainMock)

describe('unlinkForkEdge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('nulls the child pointer and purges all four edge tables under the edge lock', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'child-ws' }])

    const result = await unlinkForkEdge(EDGE, 'req-1')

    expect(result).toEqual({ unlinked: true })
    expect(mockSetForkLockTimeout).toHaveBeenCalledTimes(1)
    expect(mockAcquireForkEdgeLock).toHaveBeenCalledWith(dbChainMock.db, 'child-ws')
    expect(dbChainMockFns.update).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ forkedFromWorkspaceId: null })
    )
    expect(dbChainMockFns.delete).toHaveBeenCalledTimes(4)
  })

  it('is an idempotent no-op when the edge was already dissolved', async () => {
    const result = await unlinkForkEdge(EDGE)

    expect(result).toEqual({ unlinked: false })
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
  })

  it('propagates a transaction failure without swallowing it', async () => {
    dbChainMockFns.transaction.mockRejectedValueOnce(new Error('lock timeout'))
    await expect(unlinkForkEdge(EDGE)).rejects.toThrow('lock timeout')
  })
})
