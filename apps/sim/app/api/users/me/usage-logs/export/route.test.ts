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

import { GET } from '@/app/api/users/me/usage-logs/export/route'

describe('GET /api/users/me/usage-logs/export', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
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
    expect(header).toBe('Date,Type,Credits')
    expect(row).toBe('2026-07-01T00:00:00.000Z,Chat,100')
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
      expect.objectContaining({ cursor: 'log-1' })
    )
    expect(csv.split('\n')).toHaveLength(3)
  })

  it('stops at exactly the row cap without an extra wasted page fetch', async () => {
    mockGetUserUsageLogs.mockResolvedValueOnce({
      logs: Array.from({ length: 5000 }, (_, i) => ({
        id: `log-${i}`,
        createdAt: '2026-07-01T00:00:00.000Z',
        source: 'copilot',
        cost: 0.1,
      })),
      summary: { totalCost: 0, bySource: {} },
      pagination: { hasMore: true, nextCursor: 'log-4999' },
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
