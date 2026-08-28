/**
 * @vitest-environment node
 */

import { usageLog, user, workflowExecutionLogs, workflowExecutionSnapshots } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  materializeExecutionData: vi.fn(),
  hydrateChildTraces: vi.fn(),
}))

vi.mock('@/lib/logs/execution/trace-store', () => ({
  materializeExecutionDataForDisplay: mocks.materializeExecutionData,
}))

vi.mock('@/lib/logs/execution/hydrate-child-traces', () => ({
  hydrateChildTraces: mocks.hydrateChildTraces,
}))

vi.mock('@/lib/logs/execution-origin', () => ({
  workflowExecutionOriginSql: () => ({ as: () => ({}) }),
}))

import { readLogDetail } from '@/lib/logs/fetch-log-detail'

describe('readLogDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.materializeExecutionData.mockResolvedValue({})
    mocks.hydrateChildTraces.mockResolvedValue({ hydrated: 0, dropped: {} })
  })

  afterAll(resetDbChainMock)

  it('loads workflow detail without materializing its execution snapshot', async () => {
    queueTableRows(workflowExecutionLogs, [
      {
        id: 'log-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        deploymentVersionId: null,
        deploymentVersion: null,
        deploymentVersionName: null,
        level: 'info',
        status: 'completed',
        trigger: 'manual',
        startedAt: new Date('2026-01-01T00:00:00.000Z'),
        endedAt: new Date('2026-01-01T00:00:01.000Z'),
        totalDurationMs: 1000,
        executionData: {},
        costTotal: null,
        files: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        workflowName: 'Workflow',
        workflowDescription: null,
        workflowFolderId: null,
        workflowUserId: 'user-1',
        workflowWorkspaceId: 'workspace-1',
        workflowCreatedAt: new Date('2026-01-01T00:00:00.000Z'),
        workflowUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
        pausedStatus: null,
        pausedTotalPauseCount: 0,
        pausedResumedCount: 0,
        executionOrigin: null,
      },
    ])
    queueTableRows(usageLog, [])

    const result = await readLogDetail({
      viewerUserId: 'user-1',
      workspaceId: 'workspace-1',
      lookupColumn: 'id',
      lookupValue: 'log-1',
    })

    expect(result).toMatchObject({ id: 'log-1', executionId: 'execution-1' })

    const workflowSelection = dbChainMockFns.select.mock.calls[0]?.[0] as Record<string, unknown>
    expect(workflowSelection).not.toHaveProperty('workflowState')
    expect(Object.values(workflowSelection)).not.toContain(workflowExecutionSnapshots.stateData)

    const joinedTables = dbChainMockFns.leftJoin.mock.calls.map(([table]) => table)
    expect(joinedTables).not.toContain(workflowExecutionSnapshots)
    expect(joinedTables).not.toContain(user)
  })

  it('reads a log for an actorless run, which has no viewer to attribute to', async () => {
    // A scheduled run inspecting its own execution has no user on its principal.
    // Attribution is the only thing the viewer feeds on this path, so its absence
    // must return the same detail rather than throwing, which is how the Logs tools
    // started answering every scheduled run with an opaque 500.
    queueTableRows(workflowExecutionLogs, [
      {
        id: 'log-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        deploymentVersionId: null,
        deploymentVersion: null,
        deploymentVersionName: null,
        level: 'info',
        status: 'completed',
        trigger: 'manual',
        startedAt: new Date('2026-01-01T00:00:00.000Z'),
        endedAt: new Date('2026-01-01T00:00:01.000Z'),
        totalDurationMs: 1000,
        executionData: {},
        costTotal: null,
        files: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        workflowName: 'Workflow',
        workflowDescription: null,
        workflowFolderId: null,
        workflowUserId: 'user-1',
        workflowWorkspaceId: 'workspace-1',
        workflowCreatedAt: new Date('2026-01-01T00:00:00.000Z'),
        workflowUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
        pausedStatus: null,
        pausedTotalPauseCount: 0,
        pausedResumedCount: 0,
        executionOrigin: null,
      },
    ])
    queueTableRows(usageLog, [])
    mocks.materializeExecutionData.mockResolvedValue({
      traceSpans: [
        {
          id: 'span-1',
          name: 'Agent 1',
          type: 'agent',
          duration: 5,
          startTime: '2026-01-01T00:00:00.000Z',
          endTime: '2026-01-01T00:00:00.005Z',
        },
      ],
    })

    const result = await readLogDetail({
      workspaceId: 'workspace-1',
      lookupColumn: 'id',
      lookupValue: 'log-1',
    })

    expect(result).toMatchObject({ id: 'log-1', executionId: 'execution-1' })
    // Pinned explicitly: both consumers are told there is no owner, rather than
    // being handed a stand-in the run never authorized.
    expect(mocks.materializeExecutionData).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ workspaceId: 'workspace-1', userId: undefined })
    )
    expect(mocks.hydrateChildTraces).toHaveBeenCalledWith(expect.any(Array), {
      viewerUserId: undefined,
    })
  })
})
