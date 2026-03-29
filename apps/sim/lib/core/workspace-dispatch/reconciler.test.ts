/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetBullMQQueueByName,
  mockHasActiveWorkspace,
  mockEnsureWorkspaceActive,
  mockHasWorkspaceLease,
  mockListDispatchJobsByStatuses,
  mockMarkDispatchJobAdmitted,
  mockMarkDispatchJobCompleted,
  mockMarkDispatchJobFailed,
  mockRefreshWorkspaceLease,
  mockReleaseWorkspaceLease,
  mockRemoveWorkspaceJobFromLane,
  mockRestoreWorkspaceDispatchJob,
  mockWakeWorkspaceDispatcher,
} = vi.hoisted(() => ({
  mockGetBullMQQueueByName: vi.fn(),
  mockHasActiveWorkspace: vi.fn(),
  mockEnsureWorkspaceActive: vi.fn(),
  mockHasWorkspaceLease: vi.fn(),
  mockListDispatchJobsByStatuses: vi.fn(),
  mockMarkDispatchJobAdmitted: vi.fn(),
  mockMarkDispatchJobCompleted: vi.fn(),
  mockMarkDispatchJobFailed: vi.fn(),
  mockRefreshWorkspaceLease: vi.fn(),
  mockReleaseWorkspaceLease: vi.fn(),
  mockRemoveWorkspaceJobFromLane: vi.fn(),
  mockRestoreWorkspaceDispatchJob: vi.fn(),
  mockWakeWorkspaceDispatcher: vi.fn(),
}))

vi.mock('@sim/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('@/lib/core/bullmq', () => ({
  getBullMQQueueByName: mockGetBullMQQueueByName,
}))

vi.mock('@/lib/core/workspace-dispatch/store', () => ({
  ensureWorkspaceActive: mockEnsureWorkspaceActive,
  hasActiveWorkspace: mockHasActiveWorkspace,
  hasWorkspaceLease: mockHasWorkspaceLease,
  listDispatchJobsByStatuses: mockListDispatchJobsByStatuses,
  markDispatchJobAdmitted: mockMarkDispatchJobAdmitted,
  markDispatchJobCompleted: mockMarkDispatchJobCompleted,
  markDispatchJobFailed: mockMarkDispatchJobFailed,
  reconcileGlobalQueueDepth: vi.fn().mockResolvedValue(undefined),
  refreshWorkspaceLease: mockRefreshWorkspaceLease,
  releaseWorkspaceLease: mockReleaseWorkspaceLease,
  removeWorkspaceJobFromLane: mockRemoveWorkspaceJobFromLane,
  restoreWorkspaceDispatchJob: mockRestoreWorkspaceDispatchJob,
}))

vi.mock('@/lib/core/workspace-dispatch/dispatcher', () => ({
  wakeWorkspaceDispatcher: mockWakeWorkspaceDispatcher,
}))

import { reconcileWorkspaceDispatchState } from '@/lib/core/workspace-dispatch/reconciler'

describe('workspace dispatch reconciler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHasActiveWorkspace.mockResolvedValue(true)
    mockRemoveWorkspaceJobFromLane.mockResolvedValue(undefined)
  })

  it('marks dispatch job completed when BullMQ job is completed', async () => {
    mockListDispatchJobsByStatuses.mockResolvedValue([
      {
        id: 'dispatch-1',
        workspaceId: 'workspace-1',
        lane: 'runtime',
        queueName: 'workflow-execution',
        bullmqJobName: 'workflow-execution',
        bullmqPayload: {},
        metadata: {},
        priority: 10,
        status: 'running',
        createdAt: 1,
        lease: {
          workspaceId: 'workspace-1',
          leaseId: 'lease-1',
        },
      },
    ])
    mockGetBullMQQueueByName.mockReturnValue({
      getJob: vi.fn().mockResolvedValue({
        getState: vi.fn().mockResolvedValue('completed'),
        returnvalue: { ok: true },
      }),
    })

    await reconcileWorkspaceDispatchState()

    expect(mockMarkDispatchJobCompleted).toHaveBeenCalledWith('dispatch-1', { ok: true })
    expect(mockReleaseWorkspaceLease).toHaveBeenCalledWith('workspace-1', 'lease-1')
    expect(mockWakeWorkspaceDispatcher).toHaveBeenCalled()
  })

  it('restores admitted jobs to waiting when lease and BullMQ job are gone', async () => {
    mockListDispatchJobsByStatuses.mockResolvedValue([
      {
        id: 'dispatch-2',
        workspaceId: 'workspace-2',
        lane: 'runtime',
        queueName: 'workflow-execution',
        bullmqJobName: 'workflow-execution',
        bullmqPayload: {},
        metadata: {},
        priority: 10,
        status: 'admitted',
        createdAt: 1,
        admittedAt: 2,
        lease: {
          workspaceId: 'workspace-2',
          leaseId: 'lease-2',
        },
      },
    ])
    mockGetBullMQQueueByName.mockReturnValue({
      getJob: vi.fn().mockResolvedValue(null),
    })
    mockHasWorkspaceLease.mockResolvedValue(false)

    await reconcileWorkspaceDispatchState()

    expect(mockRestoreWorkspaceDispatchJob).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'dispatch-2',
        status: 'waiting',
        lease: undefined,
      })
    )
    expect(mockWakeWorkspaceDispatcher).toHaveBeenCalled()
  })

  it('reacquires the lease for a live admitting BullMQ job', async () => {
    mockListDispatchJobsByStatuses.mockResolvedValue([
      {
        id: 'dispatch-3',
        workspaceId: 'workspace-3',
        lane: 'runtime',
        queueName: 'workflow-execution',
        bullmqJobName: 'workflow-execution',
        bullmqPayload: {},
        metadata: {
          dispatchLeaseExpiresAt: 12345,
        },
        priority: 10,
        status: 'admitting',
        createdAt: 1,
        lease: {
          workspaceId: 'workspace-3',
          leaseId: 'lease-3',
        },
      },
    ])
    mockGetBullMQQueueByName.mockReturnValue({
      getJob: vi.fn().mockResolvedValue({
        getState: vi.fn().mockResolvedValue('active'),
      }),
    })
    mockHasWorkspaceLease.mockResolvedValue(false)

    await reconcileWorkspaceDispatchState()

    expect(mockRefreshWorkspaceLease).toHaveBeenCalledWith('workspace-3', 'lease-3', 15 * 60 * 1000)
    expect(mockMarkDispatchJobAdmitted).toHaveBeenCalledWith(
      'dispatch-3',
      'workspace-3',
      'lease-3',
      12345
    )
    expect(mockRemoveWorkspaceJobFromLane).toHaveBeenCalledWith(
      'workspace-3',
      'runtime',
      'dispatch-3'
    )
  })

  it('releases leaked lease and restores waiting when BullMQ job is gone but lease remains', async () => {
    mockListDispatchJobsByStatuses.mockResolvedValue([
      {
        id: 'dispatch-4',
        workspaceId: 'workspace-4',
        lane: 'runtime',
        queueName: 'workflow-execution',
        bullmqJobName: 'workflow-execution',
        bullmqPayload: {},
        metadata: {},
        priority: 10,
        status: 'running',
        createdAt: 1,
        lease: {
          workspaceId: 'workspace-4',
          leaseId: 'lease-4',
        },
      },
    ])
    mockGetBullMQQueueByName.mockReturnValue({
      getJob: vi.fn().mockResolvedValue(null),
    })
    mockHasWorkspaceLease.mockResolvedValue(true)

    await reconcileWorkspaceDispatchState()

    expect(mockReleaseWorkspaceLease).toHaveBeenCalledWith('workspace-4', 'lease-4')
    expect(mockRestoreWorkspaceDispatchJob).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'dispatch-4',
        status: 'waiting',
      })
    )
  })
})
