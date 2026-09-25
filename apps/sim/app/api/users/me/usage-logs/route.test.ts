import { authMockFns, createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apportionCredits } from '@/lib/billing/credits/conversion'

const { mockGetUserUsageLogs, mockGetUsageCreditsByLogId } = vi.hoisted(() => ({
  mockGetUserUsageLogs: vi.fn(),
  mockGetUsageCreditsByLogId: vi.fn(),
}))

vi.mock('@/lib/billing/core/usage-log', () => ({
  getUserUsageLogs: mockGetUserUsageLogs,
  getUsageCreditsByLogId: mockGetUsageCreditsByLogId,
}))

import { GET } from '@/app/api/users/me/usage-logs/route'

describe('GET /api/users/me/usage-logs', () => {
  beforeEach(() => {
    authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetUserUsageLogs.mockResolvedValue({
      logs: [
        {
          id: 'log-1',
          createdAt: '2026-07-01T00:00:00.000Z',
          category: 'model',
          source: 'workflow',
          description: 'gpt-4o',
          cost: 0.5,
        },
      ],
      summary: { totalCost: 0.5, bySource: { workflow: 0.5 } },
      pagination: { hasMore: false },
    })
    mockGetUsageCreditsByLogId.mockResolvedValue(apportionCredits([{ key: 'log-1', dollars: 0.5 }]))
  })

  it('converts dollar costs to credits in the logs and summary', async () => {
    const response = await GET(createMockRequest('GET'))
    const body = await response.json()

    expect(body.logs).toEqual([
      {
        id: 'log-1',
        createdAt: '2026-07-01T00:00:00.000Z',
        source: 'workflow',
        workflowName: null,
        creditCost: 100,
        hasCost: true,
      },
    ])
    expect(body.summary).toEqual({
      totalCredits: 100,
      bySourceCredits: { workflow: 100 },
    })
  })

  it('presents copilot and workspace-chat usage as one sim-chat source', async () => {
    mockGetUserUsageLogs.mockResolvedValue({
      logs: [
        {
          id: 'log-copilot',
          createdAt: '2026-07-01T00:00:00.000Z',
          category: 'model',
          source: 'copilot',
          description: 'claude-opus',
          cost: 0.4,
        },
        {
          id: 'log-workspace-chat',
          createdAt: '2026-07-01T00:00:00.000Z',
          category: 'model',
          source: 'workspace-chat',
          description: 'claude-opus',
          cost: 0.2,
        },
      ],
      summary: { totalCost: 0.6, bySource: { copilot: 0.4, 'workspace-chat': 0.2 } },
      pagination: { hasMore: false },
    })
    mockGetUsageCreditsByLogId.mockResolvedValue({
      'log-copilot': 80,
      'log-workspace-chat': 40,
    })

    const body = await (await GET(createMockRequest('GET'))).json()

    expect(body.logs.map((log: { source: string }) => log.source)).toEqual(['sim-chat', 'sim-chat'])
    expect(body.summary.bySourceCredits).toEqual({ 'sim-chat': 120 })
  })

  it('apportions row credits so they sum exactly to the page total, instead of rounding each row independently', async () => {
    mockGetUserUsageLogs.mockResolvedValue({
      logs: [
        { id: 'log-a', createdAt: '2026-07-01T00:00:00.000Z', source: 'workflow', cost: 0.002 },
        { id: 'log-b', createdAt: '2026-07-01T00:00:00.000Z', source: 'workflow', cost: 0.002 },
        { id: 'log-c', createdAt: '2026-07-01T00:00:00.000Z', source: 'workflow', cost: 0.002 },
      ].map((log) => ({ ...log, category: 'model', description: 'gpt-4o' })),
      summary: { totalCost: 0.006, bySource: { workflow: 0.006 } },
      pagination: { hasMore: false },
    })
    mockGetUsageCreditsByLogId.mockResolvedValue(
      apportionCredits([
        { key: 'log-a', dollars: 0.002 },
        { key: 'log-b', dollars: 0.002 },
        { key: 'log-c', dollars: 0.002 },
      ])
    )

    const response = await GET(createMockRequest('GET'))
    const body = await response.json()

    const rowCreditSum = body.logs.reduce(
      (sum: number, log: { creditCost: number }) => sum + log.creditCost,
      0
    )
    expect(rowCreditSum).toBe(body.summary.totalCredits)
  })
})
