/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apportionCredits } from '@/lib/billing/credits/conversion'

const { mockCheckRateLimit, mockGetUserUsageLogs, mockGetUsageCreditsByLogId } = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockGetUserUsageLogs: vi.fn(),
  mockGetUsageCreditsByLogId: vi.fn(),
}))

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: mockCheckRateLimit,
}))

vi.mock('@/lib/billing/core/usage-log', () => ({
  getUserUsageLogs: mockGetUserUsageLogs,
  getUsageCreditsByLogId: mockGetUsageCreditsByLogId,
}))

import { GET } from '@/app/api/v2/billing/usage/logs/route'

const RATE_LIMIT_OK = {
  allowed: true,
  userId: 'user-1',
  keyType: 'personal',
  limit: 100,
  remaining: 99,
  resetAt: new Date('2026-01-01T01:00:00Z'),
}

function callLogs(query = '') {
  return GET(new NextRequest(`http://localhost:3000/api/v2/billing/usage/logs${query}`))
}

describe('GET /api/v2/billing/usage/logs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockGetUserUsageLogs.mockResolvedValue({
      logs: [
        {
          id: 'log-1',
          createdAt: '2026-07-01T00:00:00.000Z',
          category: 'model',
          source: 'copilot',
          description: 'claude-sonnet',
          cost: 0.06,
        },
      ],
      summary: { totalCost: 0, bySource: {} },
      pagination: { hasMore: false },
    })
    mockGetUsageCreditsByLogId.mockResolvedValue(
      apportionCredits([{ key: 'log-1', dollars: 0.06 }])
    )
  })

  it('returns credit-denominated rows in the cursor envelope, no dollar costs', async () => {
    const res = await callLogs()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.nextCursor).toBeNull()
    expect(body.data).toEqual([
      {
        id: 'log-1',
        createdAt: '2026-07-01T00:00:00.000Z',
        source: 'copilot',
        workflowName: null,
        creditCost: 12,
      },
    ])
    expect(JSON.stringify(body)).not.toContain('ollarCost')
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

  it('pins a workspace API key to its own workspace', async () => {
    mockCheckRateLimit.mockResolvedValue({
      ...RATE_LIMIT_OK,
      keyType: 'workspace',
      workspaceId: 'ws-1',
    })
    const res = await callLogs()
    expect(res.status).toBe(200)
    expect(mockGetUserUsageLogs).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ workspaceId: 'ws-1' })
    )
  })

  it('403s a workspace API key asking for a different workspace', async () => {
    mockCheckRateLimit.mockResolvedValue({
      ...RATE_LIMIT_OK,
      keyType: 'workspace',
      workspaceId: 'ws-1',
    })
    const res = await callLogs('?workspaceId=ws-2')
    expect(res.status).toBe(403)
    expect(mockGetUserUsageLogs).not.toHaveBeenCalled()
  })

  it('rejects "custom" period without a startDate', async () => {
    const res = await callLogs('?period=custom')
    expect(res.status).toBe(400)
    expect(mockGetUserUsageLogs).not.toHaveBeenCalled()
  })

  it('returns the rate-limit response when denied', async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      limit: 100,
      remaining: 0,
      resetAt: new Date('2026-01-01T01:00:00Z'),
      retryAfterMs: 1000,
    })
    const res = await callLogs()
    expect(res.status).toBe(429)
  })
})
