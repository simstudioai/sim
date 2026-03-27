/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockMarkDispatchJobCompleted,
  mockMarkDispatchJobFailed,
  mockMarkDispatchJobRunning,
  mockReleaseWorkspaceLease,
  mockWakeWorkspaceDispatcher,
} = vi.hoisted(() => ({
  mockMarkDispatchJobCompleted: vi.fn(),
  mockMarkDispatchJobFailed: vi.fn(),
  mockMarkDispatchJobRunning: vi.fn(),
  mockReleaseWorkspaceLease: vi.fn(),
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

vi.mock('@/lib/core/workspace-dispatch', () => ({
  markDispatchJobCompleted: mockMarkDispatchJobCompleted,
  markDispatchJobFailed: mockMarkDispatchJobFailed,
  markDispatchJobRunning: mockMarkDispatchJobRunning,
  releaseWorkspaceLease: mockReleaseWorkspaceLease,
  wakeWorkspaceDispatcher: mockWakeWorkspaceDispatcher,
}))

import { getDispatchRuntimeMetadata, runDispatchedJob } from '@/lib/core/workspace-dispatch/worker'

describe('workspace dispatch worker lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null for missing metadata', () => {
    expect(getDispatchRuntimeMetadata(undefined)).toBeNull()
  })

  it('extracts dispatch runtime metadata when all fields are present', () => {
    expect(
      getDispatchRuntimeMetadata({
        dispatchJobId: 'dispatch-1',
        dispatchWorkspaceId: 'workspace-1',
        dispatchLeaseId: 'lease-1',
      })
    ).toEqual({
      dispatchJobId: 'dispatch-1',
      dispatchWorkspaceId: 'workspace-1',
      dispatchLeaseId: 'lease-1',
    })
  })

  it('marks running, completed, releases lease, and wakes dispatcher on success', async () => {
    const result = await runDispatchedJob(
      {
        dispatchJobId: 'dispatch-1',
        dispatchWorkspaceId: 'workspace-1',
        dispatchLeaseId: 'lease-1',
      },
      async () => ({ success: true })
    )

    expect(result).toEqual({ success: true })
    expect(mockMarkDispatchJobRunning).toHaveBeenCalledWith('dispatch-1')
    expect(mockMarkDispatchJobCompleted).toHaveBeenCalledWith('dispatch-1', { success: true })
    expect(mockReleaseWorkspaceLease).toHaveBeenCalledWith('workspace-1', 'lease-1')
    expect(mockWakeWorkspaceDispatcher).toHaveBeenCalled()
  })

  it('marks failed and still releases lease on error', async () => {
    await expect(
      runDispatchedJob(
        {
          dispatchJobId: 'dispatch-2',
          dispatchWorkspaceId: 'workspace-2',
          dispatchLeaseId: 'lease-2',
        },
        async () => {
          throw new Error('boom')
        }
      )
    ).rejects.toThrow('boom')

    expect(mockMarkDispatchJobRunning).toHaveBeenCalledWith('dispatch-2')
    expect(mockMarkDispatchJobFailed).toHaveBeenCalledWith('dispatch-2', 'boom')
    expect(mockReleaseWorkspaceLease).toHaveBeenCalledWith('workspace-2', 'lease-2')
    expect(mockWakeWorkspaceDispatcher).toHaveBeenCalled()
  })
})
