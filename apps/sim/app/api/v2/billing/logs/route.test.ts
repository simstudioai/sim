/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apportionCredits } from '@/lib/billing/credits/conversion'

const {
  mockCheckRateLimit,
  mockResolveWorkspaceAccess,
  mockGetUserUsageLogs,
  mockGetUsageCreditsByLogId,
} = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockResolveWorkspaceAccess: vi.fn(),
  mockGetUserUsageLogs: vi.fn(),
  mockGetUsageCreditsByLogId: vi.fn(),
}))

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: mockCheckRateLimit,
  resolveWorkspaceAccess: mockResolveWorkspaceAccess,
}))

vi.mock('@/lib/billing/core/usage-log', () => ({
  getUserUsageLogs: mockGetUserUsageLogs,
  getUsageCreditsByLogId: mockGetUsageCreditsByLogId,
}))

vi.mock('@/app/api/v2/lib/gate', () => ({
  v2ApiGateError: vi.fn().mockResolvedValue(null),
}))

import { GET } from '@/app/api/v2/billing/logs/route'

const RATE_LIMIT_OK = {
  allowed: true,
  userId: 'user-1',
  keyType: 'personal',
  limit: 100,
  remaining: 99,
  resetAt: new Date('2026-01-01T01:00:00Z'),
}

function callLogs(query = '') {
  return GET(new NextRequest(`http://localhost:3000/api/v2/billing/logs${query}`))
}

describe('GET /api/v2/billing/logs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockResolveWorkspaceAccess.mockResolvedValue(null)
    mockGetUserUsageLogs.mockResolvedValue({
      logs: [
        {
          id: 'log-1',
          createdAt: '2026-07-01T00:00:00.000Z',
          category: 'model',
          source: 'workflow',
          description: 'claude-sonnet',
          cost: 0.06,
          workspaceId: 'ws-1',
          workflowId: 'workflow-1',
          workflowName: 'Support Agent',
          executionId: 'execution-1',
        },
      ],
      summary: { totalCost: 0, bySource: {} },
      pagination: { hasMore: false },
    })
    mockGetUsageCreditsByLogId.mockResolvedValue(
      apportionCredits([{ key: 'log-1', dollars: 0.06 }])
    )
  })

  it('returns ledger rows without embedding billing status', async () => {
    const response = await callLogs()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      data: [
        {
          id: 'log-1',
          createdAt: '2026-07-01T00:00:00.000Z',
          source: 'workflow',
          workspaceId: 'ws-1',
          workflow: { id: 'workflow-1', name: 'Support Agent' },
          executionId: 'execution-1',
          creditCost: 12,
        },
      ],
      nextCursor: null,
    })
    expect(body).not.toHaveProperty('status')
  })

  it('normalizes both internal chat sources to sim-chat', async () => {
    const response = await callLogs('?source=sim-chat')

    expect(response.status).toBe(200)
    expect(mockGetUserUsageLogs).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ source: ['copilot', 'workspace-chat'] })
    )
  })

  it('forwards the cursor when more rows remain', async () => {
    mockGetUserUsageLogs.mockResolvedValue({
      logs: [],
      summary: { totalCost: 0, bySource: {} },
      pagination: { hasMore: true, nextCursor: 'log-42' },
    })
    mockGetUsageCreditsByLogId.mockResolvedValue({})

    const body = await (await callLogs()).json()

    expect(body.nextCursor).toBe('log-42')
  })

  it('rejects custom periods without a start date', async () => {
    const response = await callLogs('?period=custom')

    expect(response.status).toBe(400)
    expect(mockGetUserUsageLogs).not.toHaveBeenCalled()
  })

  it('authorizes a personal key before reading a workspace ledger', async () => {
    mockResolveWorkspaceAccess.mockResolvedValue({
      status: 403,
      code: 'FORBIDDEN',
      message: 'Access denied',
    })

    const response = await callLogs('?workspaceId=ws-2')

    expect(response.status).toBe(403)
    expect(mockGetUserUsageLogs).not.toHaveBeenCalled()
  })
})
