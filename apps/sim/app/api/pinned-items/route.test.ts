/**
 * Tests for the pinned-items list/create API route.
 */
import {
  authMockFns,
  createMockRequest,
  permissionsMock,
  permissionsMockFns,
  schemaMock,
} from '@sim/testing'
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
  mockDb: { select: vi.fn(), insert: vi.fn() },
}))

const mockGetUserEntityPermissions = permissionsMockFns.mockGetUserEntityPermissions

vi.mock('@sim/logger', () => ({
  createLogger: vi.fn().mockReturnValue(mockLogger),
  runWithRequestContext: <T>(_ctx: unknown, fn: () => T): T => fn(),
  getRequestContext: () => undefined,
  setRequestAuth: vi.fn(),
}))
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
// The route and `lib/pinned-items/resources` import both the db client AND the table
// schema objects from `@sim/db`; the global database mock only covers the client, so
// `schemaMock`'s table shapes are merged in here.
vi.mock('@sim/db', () => ({ db: mockDb, ...schemaMock }))

import { GET, POST } from '@/app/api/pinned-items/route'

const mockUser = { id: 'user-123', email: 'test@example.com', name: 'Test User' }

const pinnedWorkflowRow = {
  id: 'pinned-1',
  userId: 'user-123',
  workspaceId: 'workspace-123',
  resourceType: 'workflow',
  resourceId: 'workflow-1',
  pinnedAt: new Date('2024-01-01T00:00:00.000Z'),
}

const pinnedTableRow = {
  id: 'pinned-2',
  userId: 'user-123',
  workspaceId: 'workspace-123',
  resourceType: 'table',
  resourceId: 'table-1',
  pinnedAt: new Date('2024-01-02T00:00:00.000Z'),
}

const LIST_URL = 'http://localhost:3000/api/pinned-items?workspaceId=workspace-123'

describe('Pinned Items API', () => {
  const mockFrom = vi.fn()
  const mockWhere = vi.fn()
  const mockLimit = vi.fn()
  const mockValues = vi.fn()
  const mockReturning = vi.fn()

  beforeEach(() => {
    mockDb.select.mockReturnValue({ from: mockFrom })
    mockFrom.mockReturnValue({ where: mockWhere })
    // `.where()` resolves to rows directly for list queries, but the existence check
    // chains `.limit()` onto it — so the default result is an array carrying `limit`.
    const whereResult = [] as Array<Record<string, unknown>> & { limit: typeof mockLimit }
    whereResult.limit = mockLimit
    mockWhere.mockReturnValue(whereResult)
    mockLimit.mockReturnValue([{ id: 'resource-1' }])

    mockDb.insert.mockReturnValue({ values: mockValues })
    mockValues.mockReturnValue({ returning: mockReturning })
    mockReturning.mockReturnValue([pinnedWorkflowRow])

    authMockFns.mockGetSession.mockResolvedValue({ user: mockUser })
    mockGetUserEntityPermissions.mockResolvedValue('write')
  })

  describe('GET', () => {
    it('omits a pin whose resource has since been deleted', async () => {
      // The pin row survives, but the workflow existence check comes back empty.
      mockWhere
        .mockReturnValueOnce([pinnedWorkflowRow, pinnedTableRow])
        .mockReturnValueOnce([])
        .mockReturnValueOnce([{ id: 'table-1' }])

      const response = await GET(createMockRequest('GET', undefined, {}, LIST_URL))

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.pinnedItems).toEqual([expect.objectContaining({ resourceId: 'table-1' })])
    })
  })

  describe('POST', () => {
    const body = {
      workspaceId: 'workspace-123',
      resourceType: 'workflow' as const,
      resourceId: 'workflow-1',
    }

    it('returns 403 without workspace access, before touching the resource', async () => {
      mockGetUserEntityPermissions.mockResolvedValue(null)

      const response = await POST(createMockRequest('POST', body))

      expect(response.status).toBe(403)
      expect(mockDb.insert).not.toHaveBeenCalled()
    })
  })
})
