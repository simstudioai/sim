/**
 * @vitest-environment node
 */
import { authMockFns, createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetUserUsageLogs } = vi.hoisted(() => ({
  mockGetUserUsageLogs: vi.fn(),
}))

vi.mock('@/lib/billing/core/usage-log', () => ({
  getUserUsageLogs: mockGetUserUsageLogs,
}))

import { GET } from '@/app/api/users/me/usage-logs/route'

describe('GET /api/users/me/usage-logs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
  })

  it('returns 401 when unauthenticated', async () => {
    authMockFns.mockGetSession.mockResolvedValue(null)

    const response = await GET(createMockRequest('GET'))

    expect(response.status).toBe(401)
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
        dollarCost: 0.5,
      },
    ])
    expect(body.summary).toEqual({
      totalCredits: 100,
      bySourceCredits: { workflow: 100 },
    })
  })

  it('passes through the workflow name for workflow-sourced rows', async () => {
    mockGetUserUsageLogs.mockResolvedValue({
      logs: [
        {
          id: 'log-1',
          createdAt: '2026-07-01T00:00:00.000Z',
          category: 'fixed',
          source: 'workflow',
          description: 'execution_fee',
          cost: 0.01,
          workflowId: 'wf-1',
          workflowName: 'ITSM_Prod_main',
        },
      ],
      summary: { totalCost: 0.01, bySource: { workflow: 0.01 } },
      pagination: { hasMore: false },
    })

    const response = await GET(createMockRequest('GET'))
    const body = await response.json()

    expect(body.logs[0].workflowName).toBe('ITSM_Prod_main')
  })

  it('rejects "custom" period without a startDate', async () => {
    const response = await GET(
      createMockRequest('GET', undefined, {}, 'http://localhost:3000/api/test?period=custom')
    )

    expect(response.status).toBe(400)
    expect(mockGetUserUsageLogs).not.toHaveBeenCalled()
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

    const response = await GET(createMockRequest('GET'))
    const body = await response.json()

    const rowCreditSum = body.logs.reduce(
      (sum: number, log: { creditCost: number }) => sum + log.creditCost,
      0
    )
    expect(rowCreditSum).toBe(body.summary.totalCredits)
  })

  it('rejects an invalid period', async () => {
    const response = await GET(
      createMockRequest('GET', undefined, {}, 'http://localhost:3000/api/test?period=1y')
    )

    expect(response.status).toBe(400)
    expect(mockGetUserUsageLogs).not.toHaveBeenCalled()
  })

  it('resolves the start date from the period filter', async () => {
    await GET(createMockRequest('GET', undefined, {}, 'http://localhost:3000/api/test?period=7d'))

    expect(mockGetUserUsageLogs).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ startDate: expect.any(Date) })
    )
  })

  it('omits the start date for the "all" period', async () => {
    await GET(createMockRequest('GET', undefined, {}, 'http://localhost:3000/api/test?period=all'))

    expect(mockGetUserUsageLogs).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ startDate: undefined })
    )
  })
})
