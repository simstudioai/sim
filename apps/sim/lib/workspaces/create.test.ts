/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockTransaction, mockSaveWorkflowToNormalizedTables } = vi.hoisted(() => ({
  mockTransaction: vi.fn(),
  mockSaveWorkflowToNormalizedTables: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {
    transaction: mockTransaction,
  },
}))

vi.mock('@/lib/workflows/defaults', () => ({
  buildDefaultWorkflowArtifacts: () => ({ workflowState: { blocks: {}, edges: [] } }),
}))

vi.mock('@/lib/workflows/persistence/utils', () => ({
  saveWorkflowToNormalizedTables: (...args: unknown[]) =>
    mockSaveWorkflowToNormalizedTables(...args),
}))

vi.mock('@/lib/workspaces/colors', () => ({
  getRandomWorkspaceColor: () => '#123456',
}))

import { createWorkspaceRecord } from './create'

function createInsertOnlyTx() {
  return {
    insert: vi.fn().mockImplementation(() => ({
      values: vi.fn().mockResolvedValue([]),
    })),
  }
}

describe('createWorkspaceRecord', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens its own transaction when no executor is provided', async () => {
    const tx = createInsertOnlyTx()
    mockTransaction.mockImplementation(async (callback: (trx: typeof tx) => Promise<void>) =>
      callback(tx)
    )

    const record = await createWorkspaceRecord({
      userId: 'user-1',
      name: 'My Workspace',
      organizationId: null,
      workspaceMode: 'personal',
      billedAccountUserId: 'user-1',
    })

    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(record.name).toBe('My Workspace')
    expect(record.ownerId).toBe('user-1')
    expect(record.workspaceMode).toBe('personal')
    // workspace insert, permission insert, workflow insert (default workflow not skipped)
    expect(tx.insert).toHaveBeenCalledTimes(3)
    expect(mockSaveWorkflowToNormalizedTables).toHaveBeenCalledTimes(1)
  })

  it('runs directly against a provided executor instead of opening a nested transaction', async () => {
    const tx = createInsertOnlyTx()

    await createWorkspaceRecord({
      userId: 'user-1',
      name: 'My Workspace',
      organizationId: null,
      workspaceMode: 'personal',
      billedAccountUserId: 'user-1',
      executor: tx as never,
    })

    expect(mockTransaction).not.toHaveBeenCalled()
    expect(tx.insert).toHaveBeenCalledTimes(3)
  })

  it('skips the default workflow insert when skipDefaultWorkflow is set', async () => {
    const tx = createInsertOnlyTx()

    await createWorkspaceRecord({
      userId: 'user-1',
      name: 'My Workspace',
      organizationId: null,
      workspaceMode: 'personal',
      billedAccountUserId: 'user-1',
      skipDefaultWorkflow: true,
      executor: tx as never,
    })

    // workspace insert, permission insert — no workflow insert
    expect(tx.insert).toHaveBeenCalledTimes(2)
    expect(mockSaveWorkflowToNormalizedTables).not.toHaveBeenCalled()
  })

  it('adds a second admin permission row for the billed account when it differs from the owner in org mode', async () => {
    const tx = createInsertOnlyTx()

    await createWorkspaceRecord({
      userId: 'user-1',
      name: 'Org Workspace',
      organizationId: 'org-1',
      workspaceMode: 'organization',
      billedAccountUserId: 'user-billing',
      executor: tx as never,
    })

    const permissionValuesCall = tx.insert.mock.results[1].value.values as ReturnType<typeof vi.fn>
    const insertedPermissionRows = permissionValuesCall.mock.calls[0][0]
    expect(insertedPermissionRows).toHaveLength(2)
    expect(insertedPermissionRows.map((row: { userId: string }) => row.userId)).toEqual([
      'user-1',
      'user-billing',
    ])
  })
})
