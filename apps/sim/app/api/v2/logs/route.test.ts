/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckRateLimit,
  mockResolveWorkspaceAccess,
  mockListPublicWorkflowLogs,
  mockMaterializeExecutionData,
} = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockResolveWorkspaceAccess: vi.fn(),
  mockListPublicWorkflowLogs: vi.fn(),
  mockMaterializeExecutionData: vi.fn(),
}))

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: mockCheckRateLimit,
  resolveWorkspaceAccess: mockResolveWorkspaceAccess,
}))

vi.mock('@/app/api/v2/lib/gate', () => ({
  v2ApiGateError: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/logs/public-queries', () => ({
  decodePublicLogCursor: vi.fn(),
  listPublicWorkflowLogs: mockListPublicWorkflowLogs,
}))

vi.mock('@/lib/logs/execution/trace-store', () => ({
  materializeExecutionData: mockMaterializeExecutionData,
}))

import { GET } from '@/app/api/v2/logs/route'

const WORKSPACE_ID = '6fc7631d-88cd-46f8-9f0a-d4764daef7f8'
const RATE_LIMIT_OK = {
  allowed: true,
  userId: 'user-1',
  keyType: 'workspace',
  limit: 100,
  remaining: 99,
  resetAt: new Date('2026-08-06T01:00:00.000Z'),
}
const LOG_ROW = {
  executionId: 'execution-1',
  workflowId: 'workflow-1',
  workspaceId: WORKSPACE_ID,
  deploymentVersionId: null,
  status: 'completed',
  level: 'info',
  trigger: 'api',
  startedAt: new Date('2026-08-06T00:00:00.000Z'),
  endedAt: new Date('2026-08-06T00:00:01.000Z'),
  totalDurationMs: 1000,
  costTotal: null,
  files: null,
  executionData: { stored: true },
  workflowName: 'Support Agent',
  workflowDescription: null,
  workflowArchivedAt: null,
}

function callLogs(query: string) {
  return GET(
    new NextRequest(`http://localhost:3000/api/v2/logs?workspaceId=${WORKSPACE_ID}&${query}`)
  )
}

describe('GET /api/v2/logs materialized fields', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockResolveWorkspaceAccess.mockResolvedValue(null)
    mockListPublicWorkflowLogs.mockResolvedValue({ data: [LOG_ROW], nextCursor: null })
  })

  it.each([false, 0, ''])('preserves a requested falsy final output: %j', async (finalOutput) => {
    mockMaterializeExecutionData.mockResolvedValue({ finalOutput })

    const response = await callLogs('includeFinalOutput=true')
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data[0].finalOutput).toBe(finalOutput)
    expect(body.data[0].workflow).toMatchObject({ name: 'Support Agent' })
    expect(mockListPublicWorkflowLogs).toHaveBeenCalledWith(
      expect.objectContaining({ includeExecutionData: true })
    )
  })

  it('makes includeTraceSpans imply full detail', async () => {
    const traceSpans = [{ id: 'span-1', name: 'Agent', type: 'agent' }]
    mockMaterializeExecutionData.mockResolvedValue({ traceSpans })

    const response = await callLogs('includeTraceSpans=true')
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data[0].traceSpans).toEqual(traceSpans)
    expect(body.data[0].workflow).toMatchObject({ name: 'Support Agent' })
    expect(mockListPublicWorkflowLogs).toHaveBeenCalledWith(
      expect.objectContaining({ includeExecutionData: true })
    )
  })
})
