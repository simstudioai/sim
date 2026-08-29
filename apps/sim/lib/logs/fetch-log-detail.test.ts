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

import { workflowLogDetailSchema } from '@/lib/api/contracts/logs'
import { readLogDetail } from '@/lib/logs/fetch-log-detail'

function queueWorkflowLogRow(overrides: Record<string, unknown> = {}): void {
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
      costTotal: '1.25',
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
      ...overrides,
    },
  ])
}

const SPEND_BEARING_EXECUTION_DATA = {
  traceSpans: [
    {
      id: 'span-1',
      name: 'Agent 1',
      type: 'agent',
      duration: 5,
      startTime: '2026-01-01T00:00:00.000Z',
      endTime: '2026-01-01T00:00:00.005Z',
      cost: { total: 0.75 },
      tokens: { total: 900 },
      children: [
        {
          id: 'span-2',
          name: 'Model',
          type: 'model',
          cost: { total: 0.5 },
          tokens: { total: 400 },
        },
      ],
    },
  ],
  blockExecutions: [
    {
      id: 'block-exec-1',
      blockId: 'block-1',
      blockName: 'Agent 1',
      blockType: 'agent',
      startedAt: '2026-01-01T00:00:00.000Z',
      endedAt: '2026-01-01T00:00:00.005Z',
      durationMs: 5,
      status: 'success',
      inputData: {},
      outputData: {},
      cost: { total: 0.75 },
    },
  ],
}

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

  describe("when the viewer's permission group withholds cost", () => {
    beforeEach(() => {
      queueTableRows(usageLog, [])
      mocks.materializeExecutionData.mockResolvedValue(
        structuredClone(SPEND_BEARING_EXECUTION_DATA)
      )
    })

    it('still returns a log the contract accepts, with every spend figure gone', async () => {
      queueWorkflowLogRow()

      const result = await readLogDetail({
        viewerUserId: 'user-1',
        workspaceId: 'workspace-1',
        lookupColumn: 'id',
        lookupValue: 'log-1',
        hideCostInfo: true,
      })

      // The projection must stay inside the wire contract: a withheld log is
      // still a log, and a client parsing the response cannot be made to fail.
      expect(() => workflowLogDetailSchema.parse(result)).not.toThrow()

      expect(result?.cost).toBeNull()
      expect(result).not.toHaveProperty('costLedger')

      const [span] = result?.executionData.traceSpans ?? []
      expect(span).not.toHaveProperty('cost')
      expect(span).not.toHaveProperty('tokens')
      // Nested spans carry their own figures; summing children would otherwise
      // reconstruct exactly the total that was withheld.
      expect(span?.children?.[0]).not.toHaveProperty('cost')
      expect(result?.executionData.blockExecutions?.[0]).not.toHaveProperty('cost')

      // Everything the restriction does not cover is untouched.
      expect(result).toMatchObject({ id: 'log-1', status: 'completed' })
      expect(span).toMatchObject({ id: 'span-1', name: 'Agent 1' })
    })

    it('reports the run total when the group does not withhold it', async () => {
      queueWorkflowLogRow()

      const result = await readLogDetail({
        viewerUserId: 'user-1',
        workspaceId: 'workspace-1',
        lookupColumn: 'id',
        lookupValue: 'log-1',
      })

      expect(result?.cost).toEqual({ total: 1.25 })
      expect(result?.executionData.traceSpans?.[0]).toHaveProperty('cost')
    })
  })
})
