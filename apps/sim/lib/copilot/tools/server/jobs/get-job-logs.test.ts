/**
 * @vitest-environment node
 */
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { checkWorkspaceAccessMock, materializeExecutionDataForDisplayMock } = vi.hoisted(() => ({
  checkWorkspaceAccessMock: vi.fn(),
  materializeExecutionDataForDisplayMock: vi.fn(),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  checkWorkspaceAccess: checkWorkspaceAccessMock,
}))

vi.mock('@/lib/logs/execution/trace-store', () => ({
  materializeExecutionDataForDisplay: materializeExecutionDataForDisplayMock,
}))

import { getJobLogsServerTool } from './get-job-logs'

const RAW_SECRET = 'sk-job-log-secret'
const MASKED_SECRET = '{{OPENAI_API_KEY}}'
const CONTEXT = { userId: 'user-1', workspaceId: 'workspace-1' }

function jobLogRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'log-1',
    executionId: 'execution-1',
    status: 'success',
    level: 'info',
    trigger: 'schedule',
    startedAt: new Date('2026-07-31T00:00:00.000Z'),
    endedAt: new Date('2026-07-31T00:00:01.000Z'),
    totalDurationMs: 1000,
    executionData: {
      finalOutput: { result: RAW_SECRET },
      traceSpans: [{ id: 'span-1', output: { result: RAW_SECRET } }],
    },
    cost: null,
    ...overrides,
  }
}

describe('getJobLogsServerTool', () => {
  afterAll(resetDbChainMock)

  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    checkWorkspaceAccessMock.mockResolvedValue({ hasAccess: true })
  })

  it('returns the secret-safe log projection instead of raw successful output', async () => {
    const row = jobLogRow()
    dbChainMockFns.limit.mockResolvedValueOnce([row])
    materializeExecutionDataForDisplayMock.mockResolvedValueOnce({
      finalOutput: { result: MASKED_SECRET },
      traceSpans: [
        {
          id: 'span-1',
          name: 'Function 1',
          type: 'function',
          status: 'success',
          duration: 1000,
          startTime: '2026-07-31T00:00:00.000Z',
          endTime: '2026-07-31T00:00:01.000Z',
          output: { result: MASKED_SECRET },
        },
      ],
    })

    const result = await getJobLogsServerTool.execute(
      { jobId: 'schedule-1', includeDetails: true },
      CONTEXT
    )

    expect(result).toEqual([
      expect.objectContaining({
        executionId: 'execution-1',
        output: { result: MASKED_SECRET },
      }),
    ])
    expect(JSON.stringify(result)).not.toContain(RAW_SECRET)
    expect(materializeExecutionDataForDisplayMock).toHaveBeenCalledWith(row.executionData, {
      workspaceId: 'workspace-1',
      workflowId: null,
      executionId: 'execution-1',
      userId: 'user-1',
    })
  })

  it('does not fall back to raw output or errors when provenance is incomplete', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      jobLogRow({
        status: 'error',
        executionData: {
          finalOutput: { error: RAW_SECRET },
          error: RAW_SECRET,
          traceSpans: [{ id: 'span-1', output: { error: RAW_SECRET } }],
        },
      }),
    ])
    materializeExecutionDataForDisplayMock.mockResolvedValueOnce({
      traceSpans: [
        {
          id: 'span-1',
          name: 'Function 1',
          type: 'function',
          status: 'error',
          duration: 1000,
          startTime: '2026-07-31T00:00:00.000Z',
          endTime: '2026-07-31T00:00:01.000Z',
        },
      ],
    })

    const result = await getJobLogsServerTool.execute(
      { jobId: 'schedule-1', includeDetails: true },
      CONTEXT
    )

    expect(result).toEqual([
      expect.not.objectContaining({
        output: expect.anything(),
        error: expect.anything(),
      }),
    ])
    expect(JSON.stringify(result)).not.toContain(RAW_SECRET)
  })
})
