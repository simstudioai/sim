/**
 * @vitest-environment node
 */
import { authMockFns, createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ listUsage: vi.fn() }))

vi.mock('@/lib/secrets/application/use-cases', () => ({
  listSecretUsageUseCase: {
    operation: { id: 'secrets.usage' },
    execute: mocks.listUsage,
  },
}))

import { GET } from '@/app/api/secrets/usage/route'

const url =
  'http://localhost/api/secrets/usage?workspaceId=workspace-1&name=API_KEY&scope=workspace'

describe('GET /api/secrets/usage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'admin-1' },
      session: { id: 'session-1' },
    })
  })

  /**
   * The presenter calls `toISOString()` on values the database layer produces. A mocked db
   * returns no rows, so nothing here exercised that until a real query handed back a driver
   * string and the route 500'd on `toISOString is not a function`. This pins the shape the
   * presenter is entitled to assume.
   */
  it('serializes the timestamps an entry carries', async () => {
    mocks.listUsage.mockResolvedValue({
      entries: [
        {
          id: 'usage-1',
          useCount: 4,
          lastUsedAt: new Date('2026-03-14T09:30:00.000Z'),
          source: 'workflow',
          workflowName: 'Nightly sync',
          actorName: 'Ada',
          lastExecutionId: 'execution-1',
          lastExecutionAvailable: true,
          lastTrigger: 'schedule',
        },
      ],
    })

    const response = await GET(createMockRequest('GET', undefined, {}, url))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      entries: [
        expect.objectContaining({
          id: 'usage-1',
          lastUsedAt: '2026-03-14T09:30:00.000Z',
        }),
      ],
    })
  })

  it('returns an empty trail for a secret that has never been used', async () => {
    mocks.listUsage.mockResolvedValue({ entries: [] })

    const response = await GET(createMockRequest('GET', undefined, {}, url))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ entries: [] })
  })
})
