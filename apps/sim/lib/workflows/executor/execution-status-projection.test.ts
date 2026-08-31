/**
 * @vitest-environment node
 *
 * `logs.trace_spans` and `logs.cost` are PROJECTIONS, not gates — a group
 * withholds those fields from the response rather than refusing the read.
 *
 * The run-detail family applied none of it: a member whose group hides spend saw
 * `cost` blanked on the log list and then read `cost.total` on the run one click
 * deeper, and a member whose group hides execution detail got `finalOutput` and
 * `blockOutputs` back whole from both the internal executions route and
 * `/api/v2/workflows/{id}/runs/{runId}`. These run the real
 * `getWorkflowExecutionStatus` against the real `resolveLogFieldProjection` — the
 * same helper `readLogDetail` and the v1 routes resolve their flags through — so
 * they fail if this read stops projecting.
 */
import {
  dbChainMockFns,
  permissionGroupScopeMock,
  permissionGroupScopeMockFns,
  queueTableRows,
  resetDbChainMock,
  resetPermissionGroupScopeMock,
  schemaMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetJob, mockMaterializeForDisplayWithBlockOutputs } = vi.hoisted(() => ({
  mockGetJob: vi.fn(),
  mockMaterializeForDisplayWithBlockOutputs: vi.fn(),
}))

vi.mock('@/lib/permission-groups/config-scope.server', () => permissionGroupScopeMock)

vi.mock('@/lib/core/async-jobs', () => ({
  getJobQueue: vi.fn().mockResolvedValue({ getJob: mockGetJob }),
}))

vi.mock('@/lib/logs/execution/trace-store', () => ({
  materializeExecutionDataForDisplayWithBlockOutputs: mockMaterializeForDisplayWithBlockOutputs,
}))

vi.mock('@/lib/workflows/executor/paused-execution-metadata', () => ({
  getAutomaticResumeWaitingMetadata: vi.fn().mockReturnValue(null),
}))

import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'
import { getWorkflowExecutionStatus } from '@/lib/workflows/executor/execution-status'

const BLOCK_ID = 'block-1'

function queueCompletedRun(): void {
  queueTableRows(schemaMock.workflowExecutionLogs, [
    {
      executionId: 'execution-1',
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      status: 'completed',
      level: 'info',
      trigger: 'api',
      startedAt: new Date('2026-08-05T12:00:00.000Z'),
      endedAt: new Date('2026-08-05T12:00:01.000Z'),
      totalDurationMs: 1000,
      executionData: { executionState: {} },
      costTotal: '0.75',
    },
  ])
  queueTableRows(schemaMock.resumeQueue, [])
  queueTableRows(schemaMock.pausedExecutions, [])
  mockMaterializeForDisplayWithBlockOutputs.mockResolvedValueOnce({
    executionData: { finalOutput: { answer: 'a customer address' } },
    blockOutputs: new Map([[BLOCK_ID, { answer: 'a customer address' }]]),
  })
}

function readRun(viewerUserId: string | null | undefined) {
  return getWorkflowExecutionStatus({
    workflowId: 'workflow-1',
    executionId: 'execution-1',
    includeOutput: true,
    selectedOutputs: [BLOCK_ID],
    workspaceId: 'workspace-1',
    workspaceOrganizationId: 'organization-1',
    viewerUserId,
  })
}

describe('run-detail field projection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    resetPermissionGroupScopeMock()
    mockMaterializeForDisplayWithBlockOutputs.mockResolvedValue({
      executionData: {},
      blockOutputs: new Map(),
    })
  })

  it('reads the run whole for a member no group governs', async () => {
    queueCompletedRun()

    const status = await readRun('user-1')

    expect(status?.cost).toEqual({ total: 0.75 })
    expect(status?.finalOutput).toEqual({ answer: 'a customer address' })
    expect(status?.blockOutputs).toEqual({ [BLOCK_ID]: { answer: 'a customer address' } })
  })

  it('withholds the run total from a member whose group hides spend', async () => {
    permissionGroupScopeMockFns.mockResolvePermissionGroupConfig.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      hideCostInfo: true,
    })
    queueCompletedRun()

    const status = await readRun('user-1')

    expect(status?.cost).toBeNull()
    expect(status?.status).toBe('completed')
    expect(status?.finalOutput).toEqual({ answer: 'a customer address' })
  })

  it('withholds the execution payloads from a member whose group hides trace spans', async () => {
    permissionGroupScopeMockFns.mockResolvePermissionGroupConfig.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      hideTraceSpans: true,
    })
    queueCompletedRun()

    const status = await readRun('user-1')

    expect(status?.finalOutput).toBeNull()
    expect(status?.blockOutputs).toBeNull()
    expect(status?.cost).toEqual({ total: 0.75 })
    expect(JSON.stringify(status)).not.toContain('a customer address')
  })

  /**
   * A workspace API key authorizes as the workspace and represents no user, so
   * its caller resolves to no subject. Substituting the key's creator would apply
   * a bystander's group to every caller of a shared credential — which is why
   * this asserts the resolver is never reached, not merely that the run came back
   * whole.
   */
  it('reads whole and resolves no group for a subjectless caller', async () => {
    permissionGroupScopeMockFns.mockResolvePermissionGroupConfig.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      hideCostInfo: true,
      hideTraceSpans: true,
    })
    queueCompletedRun()

    const status = await readRun(undefined)

    expect(status?.cost).toEqual({ total: 0.75 })
    expect(status?.finalOutput).toEqual({ answer: 'a customer address' })
    expect(status?.blockOutputs).toEqual({ [BLOCK_ID]: { answer: 'a customer address' } })
    expect(permissionGroupScopeMockFns.mockResolvePermissionGroupConfig).not.toHaveBeenCalled()
  })

  /** The queue branch answers before any log row exists, and is projected too. */
  it('withholds a queued run output from a member whose group hides trace spans', async () => {
    permissionGroupScopeMockFns.mockResolvePermissionGroupConfig.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      hideTraceSpans: true,
    })
    dbChainMockFns.limit.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    mockGetJob.mockResolvedValue({
      status: 'completed',
      createdAt: new Date('2026-08-05T12:00:00.000Z'),
      completedAt: new Date('2026-08-05T12:00:01.000Z'),
      output: { output: { answer: 'a customer address' } },
      metadata: { workflowId: 'workflow-1', correlation: { triggerType: 'api' } },
    })

    const status = await readRun('user-1')

    expect(status?.status).toBe('completed')
    expect(status?.finalOutput).toBeNull()
  })
})
