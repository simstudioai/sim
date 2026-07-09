/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockTransaction, mockSaveWorkflowToNormalizedTables, mockWorkspaceCreatedEvent } =
  vi.hoisted(() => ({
    mockTransaction: vi.fn(),
    mockSaveWorkflowToNormalizedTables: vi.fn(),
    mockWorkspaceCreatedEvent: vi.fn(),
  }))

vi.mock('@sim/db', () => ({
  db: {
    transaction: mockTransaction,
  },
}))

vi.mock('@/lib/core/telemetry', () => ({
  PlatformEvents: { workspaceCreated: mockWorkspaceCreatedEvent },
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
    expect(tx.insert).toHaveBeenCalledTimes(3)
    expect(mockSaveWorkflowToNormalizedTables).toHaveBeenCalledTimes(1)
    // Safe to fire immediately: this call committed its own transaction before returning.
    expect(mockWorkspaceCreatedEvent).toHaveBeenCalledWith({
      workspaceId: record.id,
      userId: 'user-1',
      name: 'My Workspace',
    })
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
    // Must NOT fire here: the caller's outer transaction hasn't committed yet and could still
    // roll back, which would make this a phantom event for a workspace that never existed. The
    // caller owns firing this once its own transaction commits.
    expect(mockWorkspaceCreatedEvent).not.toHaveBeenCalled()
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
