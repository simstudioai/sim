import { dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import {
  workspaceForkingLineageMock,
  workspaceForkingLineageMockFns,
} from '@sim/testing/mocks/workspace-forking-lineage.mock'
import {
  workspaceForkingLineageRootMock,
  workspaceForkingLineageRootMockFns,
} from '@sim/testing/mocks/workspace-forking-lineage-root.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/ee/workspace-forking/lib/lineage/lineage', () => workspaceForkingLineageMock)
vi.mock('@/ee/workspace-forking/lib/lineage/lineage-root', () => workspaceForkingLineageRootMock)

import { unlinkForkEdge } from '@/ee/workspace-forking/lib/lineage/unlink'

const { mockSetForkLockTimeout, mockAcquireForkEdgeLock } = workspaceForkingLineageMockFns
const { mockResolveForkLineageRootId } = workspaceForkingLineageRootMockFns

const EDGE = { childWorkspaceId: 'child-ws', parentWorkspaceId: 'parent-ws' }

afterAll(resetDbChainMock)

describe('unlinkForkEdge', () => {
  beforeEach(() => {
    resetDbChainMock()
    mockResolveForkLineageRootId.mockResolvedValue('root-ws')
  })

  it('detaches the child under its edge lock', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'child-ws' }])

    const result = await unlinkForkEdge(EDGE, 'req-1')

    expect(result).toEqual({ unlinked: true })
    expect(mockSetForkLockTimeout).toHaveBeenCalledTimes(1)
    expect(mockAcquireForkEdgeLock).toHaveBeenCalledWith(dbChainMock.db, 'child-ws')
    expect(dbChainMockFns.update).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ forkedFromWorkspaceId: null })
    )
  })

  /** A root moved by a concurrent unlink higher up means the lock taken no longer covers it. */
  it('refuses when the lineage root moved before the lock was taken', async () => {
    mockResolveForkLineageRootId.mockResolvedValueOnce('root-ws').mockResolvedValueOnce('parent-ws')

    await expect(unlinkForkEdge(EDGE, 'req-1')).rejects.toMatchObject({ statusCode: 409 })
  })

  /** The child being its own root means this very edge is already gone: an idempotent no-op. */
  it('treats an edge dissolved concurrently as already unlinked', async () => {
    mockResolveForkLineageRootId.mockResolvedValueOnce('root-ws').mockResolvedValueOnce('child-ws')
    dbChainMockFns.returning.mockResolvedValueOnce([])

    await expect(unlinkForkEdge(EDGE, 'req-1')).resolves.toEqual({ unlinked: false })
  })
})
