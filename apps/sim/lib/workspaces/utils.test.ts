/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db', () => ({
  db: {},
}))

import { reassignWorkflowOwnershipForWorkspaceMemberRemovalTx } from '@/lib/workspaces/utils'

function createSelectChain(result: unknown) {
  const limit = vi.fn().mockResolvedValue(result)
  const where = vi.fn().mockReturnValue({ limit })
  const from = vi.fn().mockReturnValue({
    where: vi.fn().mockResolvedValue(result),
    limit,
  })

  return { from, where, limit }
}

function createGroupedSelectChain(result: unknown) {
  const groupBy = vi.fn().mockResolvedValue(result)
  const where = vi.fn().mockReturnValue({ groupBy })
  const from = vi.fn().mockReturnValue({ where })

  return { from, where, groupBy }
}

function createUpdateChain(result: unknown) {
  const returning = vi.fn().mockResolvedValue(result)
  const where = vi.fn().mockReturnValue({ returning })
  const set = vi.fn().mockReturnValue({ where })

  return { set, where, returning }
}

describe('reassignWorkflowOwnershipForWorkspaceMemberRemovalTx', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reassigns departing member workflows to the workspace billed account', async () => {
    const workspaceSelect = createSelectChain([
      { id: 'workspace-1', billedAccountUserId: 'billed-1' },
    ])
    const workflowCountSelect = createGroupedSelectChain([
      { workspaceId: 'workspace-1', workflowCount: 2 },
    ])
    const workflowUpdate = createUpdateChain([])
    const tx = {
      select: vi.fn().mockReturnValueOnce(workspaceSelect).mockReturnValueOnce(workflowCountSelect),
      update: vi.fn().mockReturnValue(workflowUpdate),
    }

    const result = await reassignWorkflowOwnershipForWorkspaceMemberRemovalTx({
      tx: tx as any,
      workspaceIds: ['workspace-1'],
      departingUserId: 'departing-1',
    })

    expect(tx.update).toHaveBeenCalledTimes(1)
    expect(workflowUpdate.set).toHaveBeenCalledWith(
      expect.objectContaining({ updatedAt: expect.any(Date) })
    )
    expect(result).toEqual({
      reassigned: [{ workspaceId: 'workspace-1', newWorkflowUserId: 'billed-1', workflowCount: 2 }],
      unresolved: [],
    })
  })

  it('marks a workspace unresolved when the departing member is the billed account', async () => {
    const workspaceSelect = createSelectChain([
      { id: 'workspace-1', billedAccountUserId: 'departing-1' },
    ])
    const workflowCountSelect = createGroupedSelectChain([
      { workspaceId: 'workspace-1', workflowCount: 1 },
    ])
    const tx = {
      select: vi.fn().mockReturnValueOnce(workspaceSelect).mockReturnValueOnce(workflowCountSelect),
      update: vi.fn(),
    }

    const result = await reassignWorkflowOwnershipForWorkspaceMemberRemovalTx({
      tx: tx as any,
      workspaceIds: ['workspace-1'],
      departingUserId: 'departing-1',
    })

    expect(tx.update).not.toHaveBeenCalled()
    expect(result).toEqual({ reassigned: [], unresolved: ['workspace-1'] })
  })

  it('does not mark a workspace unresolved when the departing billing account owns no workflows', async () => {
    const workspaceSelect = createSelectChain([
      { id: 'workspace-1', billedAccountUserId: 'departing-1' },
    ])
    const workflowCountSelect = createGroupedSelectChain([])
    const tx = {
      select: vi.fn().mockReturnValueOnce(workspaceSelect).mockReturnValueOnce(workflowCountSelect),
      update: vi.fn(),
    }

    const result = await reassignWorkflowOwnershipForWorkspaceMemberRemovalTx({
      tx: tx as any,
      workspaceIds: ['workspace-1'],
      departingUserId: 'departing-1',
    })

    expect(tx.update).not.toHaveBeenCalled()
    expect(result).toEqual({ reassigned: [], unresolved: [] })
  })

  it('marks a workspace unresolved when no billed account is configured', async () => {
    const workspaceSelect = createSelectChain([{ id: 'workspace-1', billedAccountUserId: null }])
    const workflowCountSelect = createGroupedSelectChain([
      { workspaceId: 'workspace-1', workflowCount: 1 },
    ])
    const tx = {
      select: vi.fn().mockReturnValueOnce(workspaceSelect).mockReturnValueOnce(workflowCountSelect),
      update: vi.fn(),
    }

    const result = await reassignWorkflowOwnershipForWorkspaceMemberRemovalTx({
      tx: tx as any,
      workspaceIds: ['workspace-1'],
      departingUserId: 'departing-1',
    })

    expect(tx.update).not.toHaveBeenCalled()
    expect(result).toEqual({ reassigned: [], unresolved: ['workspace-1'] })
  })
})
