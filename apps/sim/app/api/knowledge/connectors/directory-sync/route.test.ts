/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockVerifyCronAuth, mockConnectorRows, mockDispatch } = vi.hoisted(() => ({
  mockVerifyCronAuth: vi.fn(() => null),
  mockConnectorRows: vi.fn(),
  mockDispatch: vi.fn(),
}))

vi.mock('@/lib/auth/internal', () => ({ verifyCronAuth: mockVerifyCronAuth }))
vi.mock('@/lib/knowledge/connectors/directory-queue', () => ({
  dispatchDirectorySync: mockDispatch,
}))
vi.mock('@sim/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({ orderBy: () => ({ limit: () => mockConnectorRows() }) }),
        }),
      }),
    }),
  },
}))

import { GET } from '@/app/api/knowledge/connectors/directory-sync/route'

function connector(overrides: Record<string, unknown> = {}) {
  return { id: 'connector-1', ...overrides }
}

async function run() {
  const response = await GET(createMockRequest('GET'))
  return response.json()
}

describe('connector directory sync scheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockVerifyCronAuth.mockReturnValue(null)
    mockDispatch.mockResolvedValue(undefined)
  })

  /**
   * Every eligible connector is offered under one tick time; the tenant-level
   * freshness check in the refresh, not the scheduler, decides which walk.
   */
  it('dispatches a refresh for every admin-mode connector under the same tick', async () => {
    mockConnectorRows.mockResolvedValue([connector(), connector({ id: 'connector-2' })])

    await expect(run()).resolves.toMatchObject({ considered: 2, dispatched: 2, failed: 0 })
    expect(mockDispatch).toHaveBeenCalledTimes(2)
    const [, first] = mockDispatch.mock.calls[0]
    const [, second] = mockDispatch.mock.calls[1]
    expect(first.tickAt).toBe(second.tickAt)
  })

  it('contains a dispatch failure to the connector that caused it', async () => {
    mockConnectorRows.mockResolvedValue([connector(), connector({ id: 'connector-2' })])
    mockDispatch.mockRejectedValueOnce(new Error('queue unreachable'))

    await expect(run()).resolves.toMatchObject({ dispatched: 1, failed: 1 })
  })

  it('refuses an unauthenticated tick', async () => {
    mockVerifyCronAuth.mockReturnValue(new Response('nope', { status: 401 }))

    const response = await GET(createMockRequest('GET'))

    expect(response.status).toBe(401)
    expect(mockConnectorRows).not.toHaveBeenCalled()
  })
})
