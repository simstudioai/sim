/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockResolveForkEdge,
  mockAcquireTargetLock,
  mockAcquireEdgeLock,
  mockGetLatestRun,
  mockDeleteAllRuns,
  mockReactivate,
  mockUndeploy,
  mockDeleteIdentity,
  mockEnqueueUndeploy,
  mockProcessOutbox,
  mockNotify,
} = vi.hoisted(() => ({
  mockResolveForkEdge: vi.fn(),
  mockAcquireTargetLock: vi.fn(),
  mockAcquireEdgeLock: vi.fn(),
  mockGetLatestRun: vi.fn(),
  mockDeleteAllRuns: vi.fn(),
  mockReactivate: vi.fn(),
  mockUndeploy: vi.fn(),
  mockDeleteIdentity: vi.fn(),
  mockEnqueueUndeploy: vi.fn(),
  mockProcessOutbox: vi.fn(),
  mockNotify: vi.fn(),
}))

vi.mock('@/ee/workspace-forking/lib/lineage/lineage', () => ({
  resolveForkEdge: mockResolveForkEdge,
  acquireForkTargetLock: mockAcquireTargetLock,
  acquireForkEdgeLock: mockAcquireEdgeLock,
  setForkLockTimeout: vi.fn(),
}))

vi.mock('@/ee/workspace-forking/lib/promote/promote-run-store', () => ({
  getLatestPromoteRunForTarget: mockGetLatestRun,
  deleteAllPromoteRunsForTarget: mockDeleteAllRuns,
}))

vi.mock('@/ee/workspace-forking/lib/promote/reactivate-in-tx', () => ({
  reactivateDeployedVersionInTx: mockReactivate,
}))

vi.mock('@/lib/workflows/persistence/utils', () => ({
  undeployWorkflow: mockUndeploy,
}))

vi.mock('@/ee/workspace-forking/lib/mapping/mapping-store', () => ({
  deleteWorkflowIdentityByIds: mockDeleteIdentity,
}))

vi.mock('@/lib/workflows/deployment-outbox', () => ({
  enqueueWorkflowUndeploySideEffects: mockEnqueueUndeploy,
  processWorkflowDeploymentOutboxEvent: mockProcessOutbox,
}))

vi.mock('@/ee/workspace-forking/lib/socket', () => ({
  notifyForkWorkflowChanged: mockNotify,
}))

import { db } from '@sim/db'
import { rollbackFork } from '@/ee/workspace-forking/lib/promote/rollback'

const EDGE = { childWorkspaceId: 'child-ws', parentWorkspaceId: 'parent-ws' }

/** A fake transaction whose existence query returns the given undeploy ids. */
function makeTx(existingUndeployIds: string[] = []) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve(existingUndeployIds.map((id) => ({ id })))),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve(undefined)) })),
    })),
  }
}

function setTx(existingUndeployIds: string[] = []) {
  vi.mocked(db.transaction).mockImplementation(
    async (cb: (tx: unknown) => unknown) => cb(makeTx(existingUndeployIds)) as never
  )
}

function makeRun(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'run-1',
    childWorkspaceId: EDGE.childWorkspaceId,
    direction: 'push' as const,
    snapshot: { updated: [], created: [], archived: [] },
    ...overrides,
  }
}

describe('rollbackFork', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveForkEdge.mockResolvedValue(EDGE)
    mockReactivate.mockResolvedValue({ deploymentVersionId: 'dv', outboxEventId: 'evt' })
    mockUndeploy.mockResolvedValue({ success: true })
    mockProcessOutbox.mockResolvedValue('completed')
    setTx([])
  })

  it('reactivates updated workflows and processes side-effects after commit', async () => {
    const run = makeRun({
      snapshot: {
        updated: [
          { workflowId: 'wf-b', priorVersion: 5 },
          { workflowId: 'wf-a', priorVersion: 3 },
        ],
        created: [],
        archived: [],
      },
    })
    mockGetLatestRun.mockResolvedValue(run)
    mockReactivate.mockImplementation(async ({ workflowId }: { workflowId: string }) => ({
      deploymentVersionId: `dv-${workflowId}`,
      outboxEventId: `evt-${workflowId}`,
    }))

    const result = await rollbackFork({
      targetWorkspaceId: 'target-ws',
      otherWorkspaceId: 'other-ws',
      userId: 'user-1',
    })

    expect(result).toMatchObject({
      restored: 2,
      archived: 0,
      unarchived: 0,
      skipped: 0,
      skippedIds: [],
    })
    // Deterministic (sorted) order: wf-a before wf-b.
    expect(mockReactivate.mock.calls.map((c) => c[0].workflowId)).toEqual(['wf-a', 'wf-b'])
    expect(mockProcessOutbox).toHaveBeenCalledWith('evt-wf-a')
    expect(mockProcessOutbox).toHaveBeenCalledWith('evt-wf-b')
    expect(mockDeleteAllRuns).toHaveBeenCalledTimes(1)
    expect(mockNotify).toHaveBeenCalledWith('wf-a')
    expect(mockNotify).toHaveBeenCalledWith('wf-b')
  })

  it('un-archives and reactivates an archived orphan (prior version restored)', async () => {
    const run = makeRun({
      snapshot: { updated: [], created: [], archived: [{ workflowId: 'wf-x', priorVersion: 2 }] },
    })
    mockGetLatestRun.mockResolvedValue(run)
    mockReactivate.mockResolvedValue({ deploymentVersionId: 'dv-x', outboxEventId: 'evt-x' })

    const result = await rollbackFork({
      targetWorkspaceId: 'target-ws',
      otherWorkspaceId: 'other-ws',
      userId: 'user-1',
    })

    expect(result.unarchived).toBe(1)
    expect(result.restored).toBe(0)
    expect(result.archived).toBe(0)
    expect(result.skipped).toBe(0)
    expect(mockReactivate).toHaveBeenCalledWith(
      expect.objectContaining({ workflowId: 'wf-x', version: 2 })
    )
    expect(mockProcessOutbox).toHaveBeenCalledWith('evt-x')
    expect(mockNotify).toHaveBeenCalledWith('wf-x')
  })

  it('aborts with 409 and writes nothing when a newer sync supersedes it mid-flight', async () => {
    const run = makeRun({
      snapshot: { updated: [{ workflowId: 'wf-a', priorVersion: 3 }], created: [], archived: [] },
    })
    // Unlocked read returns our run; the in-tx re-check sees a newer run.
    mockGetLatestRun.mockResolvedValueOnce(run).mockResolvedValueOnce(makeRun({ id: 'run-2' }))

    await expect(
      rollbackFork({
        targetWorkspaceId: 'target-ws',
        otherWorkspaceId: 'other-ws',
        userId: 'user-1',
      })
    ).rejects.toMatchObject({ statusCode: 409 })

    // No partial restore: nothing reactivated, no undo point consumed.
    expect(mockReactivate).not.toHaveBeenCalled()
    expect(mockUndeploy).not.toHaveBeenCalled()
    expect(mockDeleteAllRuns).not.toHaveBeenCalled()
    expect(mockProcessOutbox).not.toHaveBeenCalled()
  })

  it('surfaces a skipped reactivation when the version is gone (never silent)', async () => {
    const run = makeRun({
      snapshot: {
        updated: [
          { workflowId: 'wf-a', priorVersion: 3 },
          { workflowId: 'wf-b', priorVersion: 5 },
        ],
        created: [],
        archived: [],
      },
    })
    mockGetLatestRun.mockResolvedValue(run)
    mockReactivate.mockImplementation(async ({ workflowId }: { workflowId: string }) =>
      workflowId === 'wf-b' ? null : { deploymentVersionId: 'dv', outboxEventId: 'evt-wf-a' }
    )

    const result = await rollbackFork({
      targetWorkspaceId: 'target-ws',
      otherWorkspaceId: 'other-ws',
      userId: 'user-1',
    })

    expect(result.restored).toBe(1)
    expect(result.skipped).toBe(1)
    expect(result.skippedIds).toEqual(['wf-b'])
    expect(mockNotify).not.toHaveBeenCalledWith('wf-b')
  })

  it('undeploys + archives created workflows and dissolves their identity rows', async () => {
    setTx(['wf-c'])
    const run = makeRun({
      direction: 'push',
      snapshot: { updated: [], created: ['wf-c'], archived: [] },
    })
    mockGetLatestRun.mockResolvedValue(run)
    mockUndeploy.mockImplementation(
      async ({
        onUndeployTransaction,
      }: {
        onUndeployTransaction?: (
          tx: unknown,
          r: { deploymentVersionIds: string[] }
        ) => Promise<void>
      }) => {
        await onUndeployTransaction?.(makeTx(), { deploymentVersionIds: ['dv-c'] })
        return { success: true }
      }
    )
    mockEnqueueUndeploy.mockResolvedValue('undeploy-evt')

    const result = await rollbackFork({
      targetWorkspaceId: 'target-ws',
      otherWorkspaceId: 'other-ws',
      userId: 'user-1',
    })

    expect(result.archived).toBe(1)
    expect(result.skipped).toBe(0)
    expect(mockUndeploy).toHaveBeenCalledTimes(1)
    expect(mockDeleteIdentity).toHaveBeenCalledWith(
      expect.anything(),
      EDGE.childWorkspaceId,
      'parent',
      ['wf-c']
    )
    expect(mockProcessOutbox).toHaveBeenCalledWith('undeploy-evt')
  })

  it('skips a created workflow that was hard-deleted (not archived, surfaced)', async () => {
    setTx([]) // wf-c no longer exists
    const run = makeRun({ snapshot: { updated: [], created: ['wf-c'], archived: [] } })
    mockGetLatestRun.mockResolvedValue(run)

    const result = await rollbackFork({
      targetWorkspaceId: 'target-ws',
      otherWorkspaceId: 'other-ws',
      userId: 'user-1',
    })

    expect(mockUndeploy).not.toHaveBeenCalled()
    expect(result.skipped).toBe(1)
    expect(result.skippedIds).toEqual(['wf-c'])
    expect(result.archived).toBe(0)
  })
})
