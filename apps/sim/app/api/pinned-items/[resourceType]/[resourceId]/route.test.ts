/**
 * Tests for the pinned-item delete route (/api/pinned-items/[resourceType]/[resourceId])
 *
 * @vitest-environment node
 */
import { authMockFns, createMockRequest, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockLogger, mockDb } = vi.hoisted(() => {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  }
  return {
    mockLogger: logger,
    mockDb: { delete: vi.fn() },
  }
})

vi.mock('@sim/logger', () => ({
  createLogger: vi.fn().mockReturnValue(mockLogger),
  runWithRequestContext: <T>(_ctx: unknown, fn: () => T): T => fn(),
  getRequestContext: () => undefined,
}))
// The route imports `pinnedItem` (a table schema object) from `@sim/db`
// alongside `db` — merge in `schemaMock`'s table shapes like the sibling
// pinned-items/route.test.ts does.
vi.mock('@sim/db', () => ({ db: mockDb, ...schemaMock }))

import { DELETE } from '@/app/api/pinned-items/[resourceType]/[resourceId]/route'

const OWNER_USER = { id: 'user-123', email: 'owner@example.com', name: 'Owner User' }
const OTHER_USER = { id: 'user-456', email: 'other@example.com', name: 'Other User' }

/** One pinned row: `resourceType`='workflow', `resourceId`='workflow-1', owned by OWNER_USER. */
const ownerPinnedRow = { id: 'pinned-1' }

function makeParams(resourceType: string, resourceId: string) {
  return Promise.resolve({ resourceType, resourceId })
}

describe('Pinned Item Delete Route', () => {
  const mockDelete = mockDb.delete
  const mockWhere = vi.fn()
  const mockReturning = vi.fn()

  function mockAuthenticatedUser(user: typeof OWNER_USER = OWNER_USER) {
    authMockFns.mockGetSession.mockResolvedValue({ user })
  }

  function mockUnauthenticated() {
    authMockFns.mockGetSession.mockResolvedValue(null)
  }

  beforeEach(() => {
    vi.clearAllMocks()

    mockDelete.mockReturnValue({ where: mockWhere })
    mockWhere.mockReturnValue({ returning: mockReturning })
    mockReturning.mockReturnValue([])
  })

  it('should unpin a resource successfully', async () => {
    mockAuthenticatedUser(OWNER_USER)
    mockReturning.mockReturnValueOnce([ownerPinnedRow])

    const req = createMockRequest('DELETE')
    const response = await DELETE(req, { params: makeParams('workflow', 'workflow-1') })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toHaveProperty('success', true)
    expect(mockLogger.info).toHaveBeenCalledWith('Unpinned resource', {
      resourceType: 'workflow',
      resourceId: 'workflow-1',
      userId: OWNER_USER.id,
    })
  })

  it('should scope the delete by the caller userId, not by workspace, and never delete another user pin of the same resource', async () => {
    // Simulate the query condition by asserting the delete is filtered with the
    // requesting user's id, and that a mismatched-owner deletion yields zero rows.
    mockAuthenticatedUser(OTHER_USER)
    // Because the composite where() is keyed on (userId, resourceType, resourceId),
    // OTHER_USER's delete of OWNER_USER's pin matches nothing -> empty returning().
    mockReturning.mockReturnValueOnce([])

    const req = createMockRequest('DELETE')
    const response = await DELETE(req, { params: makeParams('workflow', 'workflow-1') })

    expect(response.status).toBe(404)
    const data = await response.json()
    expect(data).toHaveProperty('error', 'Pinned item not found')

    // The delete must always be scoped to the authenticated caller's own userId.
    const { eq } = await import('drizzle-orm')
    expect(eq).toHaveBeenCalledWith(expect.anything(), OTHER_USER.id)
    expect(mockLogger.info).not.toHaveBeenCalled()
  })

  it('should return 401 for unauthenticated requests', async () => {
    mockUnauthenticated()

    const req = createMockRequest('DELETE')
    const response = await DELETE(req, { params: makeParams('workflow', 'workflow-1') })

    expect(response.status).toBe(401)
    const data = await response.json()
    expect(data).toHaveProperty('error', 'Unauthorized')
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it('should return 404 when the pin does not exist', async () => {
    mockAuthenticatedUser(OWNER_USER)
    mockReturning.mockReturnValueOnce([])

    const req = createMockRequest('DELETE')
    const response = await DELETE(req, { params: makeParams('workflow', 'workflow-missing') })

    expect(response.status).toBe(404)
    const data = await response.json()
    expect(data).toHaveProperty('error', 'Pinned item not found')
  })

  it('should return 400 for an invalid resourceType path segment', async () => {
    mockAuthenticatedUser(OWNER_USER)

    const req = createMockRequest('DELETE')
    const response = await DELETE(req, { params: makeParams('not-a-real-type', 'workflow-1') })

    expect(response.status).toBe(400)
    expect(mockDelete).not.toHaveBeenCalled()
  })
})
