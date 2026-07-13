/**
 * @vitest-environment node
 */
import { db } from '@sim/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockChangeWorkspaceStoragePayerInTx } = vi.hoisted(() => ({
  mockChangeWorkspaceStoragePayerInTx: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: { select: vi.fn(), transaction: vi.fn() },
}))

vi.mock('@/lib/billing/storage/payer-transfer', () => ({
  changeWorkspaceStoragePayerInTx: mockChangeWorkspaceStoragePayerInTx,
}))

import {
  listAccessibleWorkspaceRowsForUser,
  reassignBilledAccountForUser,
  reassignWorkflowOwnershipForWorkspaceMemberRemovalTx,
} from '@/lib/workspaces/utils'

const mockDb = db as unknown as {
  select: ReturnType<typeof vi.fn>
  transaction: ReturnType<typeof vi.fn>
}

function createMockChain(finalResult: unknown) {
  const chain: any = {}
  chain.then = vi.fn().mockImplementation((resolve: any) => resolve(finalResult))
  chain.from = vi.fn().mockReturnValue(chain)
  chain.where = vi.fn().mockReturnValue(chain)
  chain.innerJoin = vi.fn().mockReturnValue(chain)
  chain.limit = vi.fn().mockReturnValue(chain)
  chain.orderBy = vi.fn().mockReturnValue(chain)
  return chain
}

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

describe('reassignBilledAccountForUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('routes each resolved workspace through the payer helper in its own transaction', async () => {
    const updateChain = createUpdateChain([])
    const tx = {
      update: vi.fn().mockReturnValue(updateChain),
    }
    mockDb.select.mockReturnValueOnce(
      createMockChain([
        { id: 'workspace-personal', ownerId: 'owner-1', organizationId: null },
        { id: 'workspace-org', ownerId: 'owner-2', organizationId: 'org-1' },
      ])
    )
    mockDb.transaction.mockImplementation(
      async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)
    )

    const result = await reassignBilledAccountForUser('departing-user')

    expect(mockDb.transaction).toHaveBeenCalledTimes(2)
    expect(mockChangeWorkspaceStoragePayerInTx).toHaveBeenNthCalledWith(1, tx, {
      workspaceId: 'workspace-personal',
      organizationId: null,
      billedAccountUserId: 'owner-1',
      expectedCurrentPayer: {
        organizationId: null,
        billedAccountUserId: 'departing-user',
      },
    })
    expect(mockChangeWorkspaceStoragePayerInTx).toHaveBeenNthCalledWith(2, tx, {
      workspaceId: 'workspace-org',
      organizationId: 'org-1',
      billedAccountUserId: 'owner-2',
      expectedCurrentPayer: {
        organizationId: 'org-1',
        billedAccountUserId: 'departing-user',
      },
    })
    expect(updateChain.set).toHaveBeenCalledTimes(2)
    expect(updateChain.set).toHaveBeenCalledWith({ updatedAt: expect.any(Date) })
    expect(result).toEqual({
      reassigned: [
        { workspaceId: 'workspace-personal', newBilledAccountUserId: 'owner-1' },
        { workspaceId: 'workspace-org', newBilledAccountUserId: 'owner-2' },
      ],
      unresolved: [],
    })
  })

  it('preserves the admin fallback and unresolved behavior', async () => {
    const updateChain = createUpdateChain([])
    const tx = {
      update: vi.fn().mockReturnValue(updateChain),
    }
    mockDb.select
      .mockReturnValueOnce(
        createMockChain([
          { id: 'workspace-admin', ownerId: 'departing-user', organizationId: null },
          { id: 'workspace-unresolved', ownerId: 'departing-user', organizationId: null },
        ])
      )
      .mockReturnValueOnce(createMockChain([{ userId: 'admin-1' }]))
      .mockReturnValueOnce(createMockChain([]))
    mockDb.transaction.mockImplementation(
      async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)
    )

    const result = await reassignBilledAccountForUser('departing-user')

    expect(mockChangeWorkspaceStoragePayerInTx).toHaveBeenCalledTimes(1)
    expect(mockChangeWorkspaceStoragePayerInTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        workspaceId: 'workspace-admin',
        billedAccountUserId: 'admin-1',
      })
    )
    expect(result).toEqual({
      reassigned: [{ workspaceId: 'workspace-admin', newBilledAccountUserId: 'admin-1' }],
      unresolved: ['workspace-unresolved'],
    })
  })

  it('stops the loop and propagates payer-transfer errors', async () => {
    const updateChain = createUpdateChain([])
    const tx = {
      update: vi.fn().mockReturnValue(updateChain),
    }
    mockDb.select.mockReturnValueOnce(
      createMockChain([
        { id: 'workspace-1', ownerId: 'owner-1', organizationId: null },
        { id: 'workspace-2', ownerId: 'owner-2', organizationId: null },
      ])
    )
    mockDb.transaction.mockImplementation(
      async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)
    )
    mockChangeWorkspaceStoragePayerInTx.mockRejectedValueOnce(new Error('payer transfer failed'))

    await expect(reassignBilledAccountForUser('departing-user')).rejects.toThrow(
      'payer transfer failed'
    )

    expect(mockDb.transaction).toHaveBeenCalledTimes(1)
    expect(mockChangeWorkspaceStoragePayerInTx).toHaveBeenCalledTimes(1)
    expect(tx.update).not.toHaveBeenCalled()
  })
})

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

describe('listAccessibleWorkspaceRowsForUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('elevates an org admin to admin on an org workspace where they hold a lower explicit grant', async () => {
    const orgWorkspace = { id: 'ws-1', name: 'Shared', ownerId: 'owner-x', organizationId: 'org-1' }

    mockDb.select
      .mockReturnValueOnce(createMockChain([{ workspace: orgWorkspace, permissionType: 'write' }]))
      .mockReturnValueOnce(createMockChain([{ organizationId: 'org-1', role: 'admin' }]))
      .mockReturnValueOnce(createMockChain([orgWorkspace]))

    const rows = await listAccessibleWorkspaceRowsForUser('user-1', 'active')

    expect(rows).toEqual([{ workspace: orgWorkspace, permissionType: 'admin' }])
  })

  it('keeps a lower explicit grant on a workspace owned by a different organization', async () => {
    const externalWorkspace = {
      id: 'ws-ext',
      name: 'External',
      ownerId: 'owner-y',
      organizationId: 'org-2',
    }
    const orgWorkspace = { id: 'ws-1', name: 'Shared', ownerId: 'owner-x', organizationId: 'org-1' }

    mockDb.select
      .mockReturnValueOnce(
        createMockChain([{ workspace: externalWorkspace, permissionType: 'write' }])
      )
      .mockReturnValueOnce(createMockChain([{ organizationId: 'org-1', role: 'admin' }]))
      .mockReturnValueOnce(createMockChain([orgWorkspace]))

    const rows = await listAccessibleWorkspaceRowsForUser('user-1', 'active')

    expect(rows).toEqual([
      { workspace: externalWorkspace, permissionType: 'write' },
      { workspace: orgWorkspace, permissionType: 'admin' },
    ])
  })
})
