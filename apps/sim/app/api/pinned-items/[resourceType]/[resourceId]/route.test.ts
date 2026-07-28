/**
 * Tests for the unpin API route.
 *
 * @vitest-environment node
 */
import { authMockFns, createMockRequest, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockLogger, mockDb } = vi.hoisted(() => ({
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  },
  mockDb: { delete: vi.fn() },
}))

vi.mock('@sim/logger', () => ({
  createLogger: vi.fn().mockReturnValue(mockLogger),
  runWithRequestContext: <T>(_ctx: unknown, fn: () => T): T => fn(),
  getRequestContext: () => undefined,
}))
vi.mock('@sim/db', () => ({ db: mockDb, ...schemaMock }))

import { DELETE } from '@/app/api/pinned-items/[resourceType]/[resourceId]/route'

const mockUser = { id: 'user-123', email: 'test@example.com', name: 'Test User' }

function routeContext(resourceType: string, resourceId: string) {
  return { params: Promise.resolve({ resourceType, resourceId }) }
}

describe('Unpin API', () => {
  const mockWhere = vi.fn()
  const mockReturning = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()

    mockDb.delete.mockReturnValue({ where: mockWhere })
    mockWhere.mockReturnValue({ returning: mockReturning })
    mockReturning.mockReturnValue([{ id: 'pinned-1' }])

    authMockFns.mockGetSession.mockResolvedValue({ user: mockUser })
  })

  it('unpins a resource', async () => {
    const response = await DELETE(
      createMockRequest('DELETE'),
      routeContext('workflow', 'workflow-1')
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true })
    expect(mockDb.delete).toHaveBeenCalled()
  })

  it('returns 404 when no matching pin exists', async () => {
    mockReturning.mockReturnValue([])

    const response = await DELETE(
      createMockRequest('DELETE'),
      routeContext('workflow', 'workflow-1')
    )

    expect(response.status).toBe(404)
  })

  it('rejects an unknown resourceType at the contract boundary', async () => {
    const response = await DELETE(createMockRequest('DELETE'), routeContext('nope', 'resource-1'))

    expect(response.status).toBe(400)
    expect(mockDb.delete).not.toHaveBeenCalled()
  })

  it('returns 401 when unauthenticated', async () => {
    authMockFns.mockGetSession.mockResolvedValue(null)

    const response = await DELETE(
      createMockRequest('DELETE'),
      routeContext('workflow', 'workflow-1')
    )

    expect(response.status).toBe(401)
    expect(mockDb.delete).not.toHaveBeenCalled()
  })
})
