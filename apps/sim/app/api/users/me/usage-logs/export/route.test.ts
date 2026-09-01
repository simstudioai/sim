/**
 * @vitest-environment node
 */
import { authMockFns, createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apportionCredits } from '@/lib/billing/credits/conversion'

const { mockGetUserUsageLogs, mockGetUsageCreditsByLogId } = vi.hoisted(() => ({
  mockGetUserUsageLogs: vi.fn(),
  /** Still mocked because the module exports it; the export route must never call it. */
  mockGetUsageCreditsByLogId: vi.fn(),
}))

vi.mock('@/lib/billing/core/usage-log', () => ({
  getUserUsageLogs: mockGetUserUsageLogs,
  getUsageCreditsByLogId: mockGetUsageCreditsByLogId,
}))

import { GET } from '@/app/api/users/me/usage-logs/export/route'

describe('GET /api/users/me/usage-logs/export', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetUsageCreditsByLogId.mockResolvedValue({})
  })

  it('returns 401 when unauthenticated', async () => {
    authMockFns.mockGetSession.mockResolvedValue(null)

    const response = await GET(createMockRequest('GET'))

    expect(response.status).toBe(401)
  })

  it('returns a CSV with the header row and one line per log', async () => {
    mockGetUserUsageLogs.mockResolvedValueOnce({
      logs: [
        {
          id: 'log-1',
          createdAt: '2026-07-01T00:00:00.000Z',
          category: 'model',
          source: 'copilot',
          description: 'claude-opus-4.8',
          cost: 0.5,
        },
      ],
      summary: { totalCost: 0.5, bySource: { copilot: 0.5 } },
      pagination: { hasMore: false },
    })

    const response = await GET(createMockRequest('GET'))
    const csv = await response.text()
    const [header, row] = csv.split('\n')

    expect(response.headers.get('Content-Type')).toBe('text/csv; charset=utf-8')
    expect(response.headers.get('Content-Disposition')).toContain('attachment; filename=')
    expect(response.headers.get('X-Export-Truncated')).toBe('0')
    expect(header).toBe('Date,Type,Credits')
    expect(row).toBe('2026-07-01T00:00:00.000Z,Sim Chat,100')
  })

  it('sets X-Export-Truncated when the safety cap is hit with more data remaining', async () => {
    mockGetUserUsageLogs.mockResolvedValueOnce({
      logs: Array.from({ length: 50000 }, (_, i) => ({
        id: `log-${i}`,
        createdAt: '2026-07-01T00:00:00.000Z',
        source: 'copilot',
        cost: 0.1,
      })),
      summary: { totalCost: 0, bySource: {} },
      pagination: { hasMore: true, nextCursor: 'log-49999' },
    })

    const response = await GET(createMockRequest('GET'))

    expect(response.headers.get('X-Export-Truncated')).toBe('1')
  })

  it('does not request the summary aggregate — the export never reads it', async () => {
    mockGetUserUsageLogs.mockResolvedValueOnce({
      logs: [],
      summary: { totalCost: 0, bySource: {} },
      pagination: { hasMore: false },
    })

    await GET(createMockRequest('GET'))

    expect(mockGetUserUsageLogs).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ includeSummary: false })
    )
  })

  it('filters sim-chat across both internal ledgers', async () => {
    mockGetUserUsageLogs.mockResolvedValueOnce({
      logs: [],
      summary: { totalCost: 0, bySource: {} },
      pagination: { hasMore: false },
    })

    const response = await GET(
      createMockRequest('GET', undefined, {}, 'http://localhost:3000/api/test?source=sim-chat')
    )

    expect(response.status).toBe(200)
    expect(mockGetUserUsageLogs).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ source: ['copilot', 'workspace-chat'] })
    )
  })

  it('names the specific workflow for workflow-sourced rows', async () => {
    mockGetUserUsageLogs.mockResolvedValueOnce({
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
    const csv = await response.text()

    expect(csv).toContain('Workflow: ITSM_Prod_main')
  })

  it('quotes a Type field that contains a comma', async () => {
    mockGetUserUsageLogs.mockResolvedValueOnce({
      logs: [
        {
          id: 'log-1',
          createdAt: '2026-07-01T00:00:00.000Z',
          category: 'fixed',
          source: 'workflow',
          description: 'execution_fee',
          cost: 0.01,
          workflowId: 'wf-1',
          workflowName: 'Prod, main',
        },
      ],
      summary: { totalCost: 0.01, bySource: { workflow: 0.01 } },
      pagination: { hasMore: false },
    })

    const response = await GET(createMockRequest('GET'))
    const csv = await response.text()

    expect(csv).toContain('"Workflow: Prod, main"')
  })

  it('paginates through getUserUsageLogs until hasMore is false', async () => {
    mockGetUserUsageLogs
      .mockResolvedValueOnce({
        logs: [
          {
            id: 'log-1',
            createdAt: '2026-07-01T00:00:00.000Z',
            category: 'model',
            source: 'copilot',
            description: 'claude-opus-4.8',
            cost: 0.1,
          },
        ],
        summary: { totalCost: 0.2, bySource: { copilot: 0.2 } },
        pagination: { hasMore: true, nextCursor: 'log-1' },
      })
      .mockResolvedValueOnce({
        logs: [
          {
            id: 'log-2',
            createdAt: '2026-06-30T00:00:00.000Z',
            category: 'model',
            source: 'copilot',
            description: 'claude-opus-4.8',
            cost: 0.1,
          },
        ],
        summary: { totalCost: 0.2, bySource: { copilot: 0.2 } },
        pagination: { hasMore: false },
      })

    const response = await GET(createMockRequest('GET'))
    const csv = await response.text()

    expect(mockGetUserUsageLogs).toHaveBeenCalledTimes(2)
    expect(mockGetUserUsageLogs).toHaveBeenNthCalledWith(
      2,
      'user-1',
      expect.objectContaining({
        cursor: 'log-1',
        cursorCreatedAt: new Date('2026-07-01T00:00:00.000Z'),
      })
    )
    expect(csv.split('\n')).toHaveLength(3)
  })

  it('apportions across pages so the printed rows reconcile to the printed total', async () => {
    // 0.002 + 0.002 = 0.004 -> 0.8 credits -> 1 credit for the whole file. Rounding each
    // row alone would print 0 and 0; the largest-remainder split prints 1 and 0.
    mockGetUserUsageLogs
      .mockResolvedValueOnce({
        logs: [
          { id: 'log-1', createdAt: '2026-07-01T00:00:00.000Z', source: 'copilot', cost: 0.002 },
        ],
        summary: { totalCost: 0, bySource: {} },
        pagination: { hasMore: true, nextCursor: 'log-1' },
      })
      .mockResolvedValueOnce({
        logs: [
          { id: 'log-2', createdAt: '2026-06-30T00:00:00.000Z', source: 'copilot', cost: 0.002 },
        ],
        summary: { totalCost: 0, bySource: {} },
        pagination: { hasMore: false },
      })

    const csv = await (await GET(createMockRequest('GET'))).text()
    const printed = csv
      .split('\n')
      .slice(1)
      .map((line) => Number(line.split(',')[2]))

    expect(printed.reduce((sum, credits) => sum + credits, 0)).toBe(
      Object.values(
        apportionCredits([
          { key: 'log-1', dollars: 0.002 },
          { key: 'log-2', dollars: 0.002 },
        ])
      ).reduce((sum, credits) => sum + credits, 0)
    )
  })

  it('never issues the whole-filter apportionment read, so the safety cap actually bounds it', async () => {
    // The cap stops the paging loop; a second unbounded read beside it would make that
    // cap meaningless, and with `period=all` it is a full lifetime scan.
    mockGetUserUsageLogs.mockResolvedValueOnce({
      logs: [{ id: 'log-1', createdAt: '2026-07-01T00:00:00.000Z', source: 'copilot', cost: 0.5 }],
      summary: { totalCost: 0, bySource: {} },
      pagination: { hasMore: false },
    })

    await GET(createMockRequest('GET'))

    expect(mockGetUsageCreditsByLogId).not.toHaveBeenCalled()
  })

  it('stops at exactly the safety cap without an extra wasted page fetch', async () => {
    mockGetUserUsageLogs.mockResolvedValueOnce({
      logs: Array.from({ length: 50000 }, (_, i) => ({
        id: `log-${i}`,
        createdAt: '2026-07-01T00:00:00.000Z',
        source: 'copilot',
        cost: 0.1,
      })),
      summary: { totalCost: 0, bySource: {} },
      pagination: { hasMore: true, nextCursor: 'log-49999' },
    })

    await GET(createMockRequest('GET'))

    expect(mockGetUserUsageLogs).toHaveBeenCalledTimes(1)
  })

  it('rejects "custom" period without a startDate', async () => {
    const response = await GET(
      createMockRequest('GET', undefined, {}, 'http://localhost:3000/api/test?period=custom')
    )

    expect(response.status).toBe(400)
    expect(mockGetUserUsageLogs).not.toHaveBeenCalled()
  })
})
