/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockTransaction, mockSetForkLockTimeout, mockAcquireForkEdgeLock } = vi.hoisted(() => ({
  mockTransaction: vi.fn(),
  mockSetForkLockTimeout: vi.fn(),
  mockAcquireForkEdgeLock: vi.fn(),
}))

vi.mock('@sim/db', () => ({ db: { transaction: mockTransaction } }))
vi.mock('@/lib/workspaces/fork/lineage/lineage', () => ({
  setForkLockTimeout: mockSetForkLockTimeout,
  acquireForkEdgeLock: mockAcquireForkEdgeLock,
}))

import { unlinkForkEdge } from '@/lib/workspaces/fork/lineage/unlink'

/** A fake tx whose update returns `updatedRows` and whose deletes record their calls. */
function fakeTx(updatedRows: Array<{ id: string }>) {
  const updateWhere = vi.fn(() => ({ returning: vi.fn().mockResolvedValue(updatedRows) }))
  const updateSet = vi.fn(() => ({ where: updateWhere }))
  const update = vi.fn(() => ({ set: updateSet }))
  const deleteWhere = vi.fn().mockResolvedValue(undefined)
  const del = vi.fn(() => ({ where: deleteWhere }))
  return { tx: { update, delete: del }, update, updateSet, del }
}

const EDGE = { childWorkspaceId: 'child-ws', parentWorkspaceId: 'parent-ws' }

describe('unlinkForkEdge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('nulls the child pointer and purges all four edge tables under the edge lock', async () => {
    const { tx, update, updateSet, del } = fakeTx([{ id: 'child-ws' }])
    mockTransaction.mockImplementation(async (cb: (t: unknown) => unknown) => cb(tx))

    const result = await unlinkForkEdge(EDGE, 'req-1')

    expect(result).toEqual({ unlinked: true })
    expect(mockSetForkLockTimeout).toHaveBeenCalledTimes(1)
    expect(mockAcquireForkEdgeLock).toHaveBeenCalledWith(tx, 'child-ws')
    expect(update).toHaveBeenCalledTimes(1)
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ forkedFromWorkspaceId: null }))
    expect(del).toHaveBeenCalledTimes(4)
  })

  it('is an idempotent no-op when the edge was already dissolved', async () => {
    const { tx, del } = fakeTx([])
    mockTransaction.mockImplementation(async (cb: (t: unknown) => unknown) => cb(tx))

    const result = await unlinkForkEdge(EDGE)

    expect(result).toEqual({ unlinked: false })
    expect(del).not.toHaveBeenCalled()
  })

  it('propagates a transaction failure without swallowing it', async () => {
    mockTransaction.mockRejectedValue(new Error('lock timeout'))
    await expect(unlinkForkEdge(EDGE)).rejects.toThrow('lock timeout')
  })
})
