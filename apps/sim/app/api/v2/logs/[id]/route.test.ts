/**
 * @vitest-environment node
 */

import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckRateLimit,
  mockResolveWorkspaceAccess,
  mockLoadActiveFolderPathIndex,
  mockMaterializeExecutionData,
} = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockResolveWorkspaceAccess: vi.fn(),
  mockLoadActiveFolderPathIndex: vi.fn(),
  mockMaterializeExecutionData: vi.fn(),
}))

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: mockCheckRateLimit,
  resolveWorkspaceAccess: mockResolveWorkspaceAccess,
}))

vi.mock('@/app/api/v2/lib/gate', () => ({
  v2ApiGateError: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/folders/queries', () => ({
  loadActiveFolderPathIndex: mockLoadActiveFolderPathIndex,
}))

vi.mock('@/lib/logs/execution/trace-store', () => ({
  materializeExecutionData: mockMaterializeExecutionData,
}))

import { GET } from '@/app/api/v2/logs/[id]/route'

const RATE_LIMIT_OK = {
  allowed: true,
  userId: 'user-1',
  keyType: 'workspace',
  limit: 100,
  remaining: 99,
  resetAt: new Date('2024-01-01T01:00:00Z'),
}

const LOG_ROW = {
  id: 'log-1',
  workflowId: 'workflow-1',
  workspaceId: 'workspace-1',
  executionId: 'execution-1',
  level: 'info',
  trigger: 'api',
  startedAt: new Date('2024-01-01T00:00:00Z'),
  endedAt: new Date('2024-01-01T00:00:01Z'),
  totalDurationMs: 1000,
  executionData: { stored: true },
  costTotal: '0.01',
  files: null,
  createdAt: new Date('2024-01-01T00:00:00Z'),
  workflowName: 'Support Agent',
  workflowDescription: 'Handles support requests',
  workflowFolderId: null,
  workflowUserId: 'user-1',
  workflowWorkspaceId: 'workspace-1',
  workflowCreatedAt: new Date('2023-12-01T00:00:00Z'),
  workflowUpdatedAt: new Date('2023-12-02T00:00:00Z'),
  workflowArchivedAt: null,
}

const routeContext = () => ({ params: Promise.resolve({ id: 'log-1' }) })

function callGet() {
  return GET(new NextRequest('http://localhost:3000/api/v2/logs/log-1'), routeContext())
}

describe('GET /api/v2/logs/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockResolveWorkspaceAccess.mockResolvedValue(null)
    mockLoadActiveFolderPathIndex.mockResolvedValue({ pathById: new Map() })
    dbChainMockFns.limit.mockResolvedValue([LOG_ROW])
  })

  it('returns materialized trace spans as a first-class log detail field', async () => {
    const traceSpans = [
      {
        id: 'span-1',
        name: 'Agent',
        type: 'agent',
        durationMs: 1000,
        status: 'success',
        output: { answer: 'done' },
      },
    ]
    mockMaterializeExecutionData.mockResolvedValue({
      traceSpans,
      finalOutput: { answer: 'done' },
    })

    const response = await callGet()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.traceSpans).toEqual(traceSpans)
    expect(body.data.executionData.traceSpans).toEqual(traceSpans)
  })

  it('returns an empty trace span array when the execution has no spans', async () => {
    mockMaterializeExecutionData.mockResolvedValue({ finalOutput: { answer: 'done' } })

    const response = await callGet()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.traceSpans).toEqual([])
  })
})
