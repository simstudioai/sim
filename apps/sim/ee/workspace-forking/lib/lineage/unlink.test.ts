import { dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import {
  workspaceForkingLineageMock,
  workspaceForkingLineageMockFns,
} from '@sim/testing/mocks/workspace-forking-lineage.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/ee/workspace-forking/lib/lineage/lineage', () => workspaceForkingLineageMock)

import { unlinkForkEdge } from '@/ee/workspace-forking/lib/lineage/unlink'

const { mockSetForkLockTimeout, mockAcquireForkEdgeLock } = workspaceForkingLineageMockFns

const EDGE = { childWorkspaceId: 'child-ws', parentWorkspaceId: 'parent-ws' }

afterAll(resetDbChainMock)

describe('unlinkForkEdge', () => {
  beforeEach(() => {
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
})
