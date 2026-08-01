/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockTask,
  mockGetPausedExecutionById,
  mockStartResumeExecution,
  mockFindCellContextByExecutionId,
  mockSnapshotFromJson,
} = vi.hoisted(() => ({
  mockTask: vi.fn((config) => config),
  mockGetPausedExecutionById: vi.fn(),
  mockStartResumeExecution: vi.fn(),
  mockFindCellContextByExecutionId: vi.fn(),
  mockSnapshotFromJson: vi.fn(),
}))

vi.mock('@trigger.dev/sdk', () => ({ task: mockTask }))

vi.mock('@/lib/billing/core/billing-attribution', () => ({
  assertBillingAttributionSnapshot: vi.fn((value) => value),
}))

vi.mock('@/lib/table/cascade-lock', () => ({ withCascadeLock: vi.fn() }))
vi.mock('@/lib/table/deps', () => ({ isExecCancelled: vi.fn(() => false) }))

vi.mock('@/lib/table/workflow-columns', () => ({
  findCellContextByExecutionId: mockFindCellContextByExecutionId,
}))

vi.mock('@/lib/workflows/executor/human-in-the-loop-manager', () => ({
  PauseResumeManager: {
    getPausedExecutionById: mockGetPausedExecutionById,
    startResumeExecution: mockStartResumeExecution,
  },
}))

vi.mock('@/executor/execution/snapshot', () => ({
  ExecutionSnapshot: { fromJSON: mockSnapshotFromJson },
}))

import { executeResumeJob, type ResumeExecutionPayload } from '@/background/resume-execution'

const payload: ResumeExecutionPayload = {
  resumeEntryId: 'resume-entry-1',
  resumeExecutionId: 'resume-execution-1',
  pausedExecutionId: 'paused-execution-1',
  contextId: 'context-1',
  resumeInput: {},
  userId: 'user-1',
  workflowId: 'workflow-1',
  parentExecutionId: 'parent-execution-1',
}

describe('executeResumeJob terminal errors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetPausedExecutionById.mockResolvedValue({
      executionSnapshot: { snapshot: {} },
    })
    mockSnapshotFromJson.mockReturnValue({
      metadata: {
        billingAttribution: {
          actorUserId: 'user-1',
          workspaceId: 'workspace-1',
        },
      },
    })
    mockFindCellContextByExecutionId.mockResolvedValue(null)
  })

  it('rethrows the original core-finalized resume error', async () => {
    const rawError = Object.assign(new Error('Agent tool exposed activated-secret-value'), {
      executionResult: {
        success: false,
        output: { error: 'Agent tool failed' },
        logs: [],
      },
    })
    mockStartResumeExecution.mockRejectedValue(rawError)

    await expect(executeResumeJob(payload)).rejects.toBe(rawError)
  })

  it('rethrows the original genuine resume fault', async () => {
    const rawError = new Error('MCP setup exposed activated-secret-value')
    mockStartResumeExecution.mockRejectedValue(rawError)

    await expect(executeResumeJob(payload)).rejects.toBe(rawError)
  })
})
