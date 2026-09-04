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
        innerJoin: () => ({ where: () => ({ orderBy: () => mockConnectorRows() }) }),
      }),
    }),
  },
}))

import { GET } from '@/app/api/knowledge/connectors/directory-sync/route'

function connector(overrides: Record<string, unknown> = {}) {
  return {
    id: 'connector-1',
    connectorType: 'google_drive',
    workspaceId: 'ws-1',
    ...overrides,
  }
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

  it('dispatches one refresh per directory an admin-mode connector mirrors', async () => {
    mockConnectorRows.mockResolvedValue([
      connector(),
      connector({ id: 'connector-2', workspaceId: 'ws-2' }),
    ])

    await expect(run()).resolves.toMatchObject({
      considered: 2,
      directories: 2,
      dispatched: 2,
      failed: 0,
    })
    expect(mockDispatch).toHaveBeenCalledTimes(2)
  })

  /**
   * Two connectors of one type in one workspace mirror one directory; walking
   * it twice per tick would double the Admin SDK cost for nothing.
   */
  it('dispatches once for connectors that share a directory', async () => {
    mockConnectorRows.mockResolvedValue([connector(), connector({ id: 'connector-2' })])

    await expect(run()).resolves.toMatchObject({ considered: 2, directories: 1, dispatched: 1 })
    expect(mockDispatch).toHaveBeenCalledTimes(1)
    expect(mockDispatch).toHaveBeenCalledWith('connector-1', expect.anything())
  })

  it('contains a dispatch failure to the directory that caused it', async () => {
    mockConnectorRows.mockResolvedValue([
      connector(),
      connector({ id: 'connector-2', workspaceId: 'ws-2' }),
    ])
    mockDispatch.mockRejectedValueOnce(new Error('queue unreachable'))

    await expect(run()).resolves.toMatchObject({ dispatched: 1, failed: 1 })
  })

  it('skips a connector whose knowledge base has no workspace', async () => {
    mockConnectorRows.mockResolvedValue([connector({ workspaceId: null })])

    await expect(run()).resolves.toMatchObject({ directories: 0, dispatched: 0 })
    expect(mockDispatch).not.toHaveBeenCalled()
  })

  it('refuses an unauthenticated tick', async () => {
    mockVerifyCronAuth.mockReturnValue(new Response('nope', { status: 401 }))

    const response = await GET(createMockRequest('GET'))

    expect(response.status).toBe(401)
    expect(mockConnectorRows).not.toHaveBeenCalled()
  })
})
