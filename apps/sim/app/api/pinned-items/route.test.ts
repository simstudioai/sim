/**
 * Tests for pinned-items API route
 *
 * @vitest-environment node
 */
import {
  authMockFns,
  createMockRequest,
  permissionsMock,
  permissionsMockFns,
  schemaMock,
} from '@sim/testing'
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
    mockDb: { select: vi.fn(), insert: vi.fn() },
  }
})

const mockGetUserEntityPermissions = permissionsMockFns.mockGetUserEntityPermissions

vi.mock('@sim/logger', () => ({
  createLogger: vi.fn().mockReturnValue(mockLogger),
  runWithRequestContext: <T>(_ctx: unknown, fn: () => T): T => fn(),
  getRequestContext: () => undefined,
}))
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
// The route imports both the db client AND the table schema objects
// (folder, workflow, knowledgeBase, userTableDefinitions, workspaceFiles,
// pinnedItem) from `@sim/db` — the global `databaseMock` only covers the
// client, so this mock merges in `schemaMock`'s table shapes as well.
vi.mock('@sim/db', () => ({ db: mockDb, ...schemaMock }))

import { GET, POST } from '@/app/api/pinned-items/route'

const defaultMockUser = {
  id: 'user-123',
  email: 'test@example.com',
  name: 'Test User',
}

const mockPinnedWorkflowRow = {
  id: 'pinned-1',
  userId: 'user-123',
  workspaceId: 'workspace-123',
  resourceType: 'workflow',
  resourceId: 'workflow-1',
  pinnedAt: new Date('2024-01-01T00:00:00.000Z'),
}

const mockPinnedFolderRow = {
  id: 'pinned-2',
  userId: 'user-123',
  workspaceId: 'workspace-123',
  resourceType: 'folder',
  resourceId: 'folder-1',
  pinnedAt: new Date('2024-01-02T00:00:00.000Z'),
}

describe('Pinned Items API Route', () => {
  const mockSelect = mockDb.select
  const mockFrom = vi.fn()
  const mockWhere = vi.fn()
  const mockLimit = vi.fn()
  const mockInsert = mockDb.insert
  const mockValues = vi.fn()
  const mockReturning = vi.fn()

  function mockAuthenticatedUser() {
    authMockFns.mockGetSession.mockResolvedValue({ user: defaultMockUser })
  }

  function mockUnauthenticated() {
    authMockFns.mockGetSession.mockResolvedValue(null)
  }

  /** Configures the resourceExistsInWorkspace() lookup chain to resolve `exists`. */
  function mockResourceExists(exists: boolean) {
    mockLimit.mockReturnValueOnce(exists ? [{ id: 'resource-1' }] : [])
  }

  beforeEach(() => {
    vi.clearAllMocks()

    mockSelect.mockReturnValue({ from: mockFrom })
    mockFrom.mockReturnValue({ where: mockWhere })
    const defaultWhereResult = [] as Array<Record<string, unknown>> & {
      limit: typeof mockLimit
    }
    defaultWhereResult.limit = mockLimit
    mockWhere.mockReturnValue(defaultWhereResult)
    mockLimit.mockReturnValue([{ id: 'resource-1' }])

    mockInsert.mockReturnValue({ values: mockValues })
    mockValues.mockReturnValue({ returning: mockReturning })
    mockReturning.mockReturnValue([mockPinnedWorkflowRow])

    mockGetUserEntityPermissions.mockResolvedValue('write')
  })

  describe('GET /api/pinned-items', () => {
    it('should list pinned items for a workspace', async () => {
      mockAuthenticatedUser()
      // 1st .where(): the pinned_item list query. 2nd/3rd: the per-resourceType
      // active-resource existence check filterActivePinnedItems() batches (one
      // per distinct type present — workflow, then folder, in row order).
      mockWhere
        .mockReturnValueOnce([mockPinnedWorkflowRow, mockPinnedFolderRow])
        .mockReturnValueOnce([{ id: 'workflow-1' }])
        .mockReturnValueOnce([{ id: 'folder-1' }])

      const req = createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost:3000/api/pinned-items?workspaceId=workspace-123'
      )

      const response = await GET(req)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.pinnedItems).toHaveLength(2)
      expect(data.pinnedItems[0]).toMatchObject({
        id: 'pinned-1',
        resourceType: 'workflow',
        resourceId: 'workflow-1',
        pinnedAt: '2024-01-01T00:00:00.000Z',
      })
    })

    it('should filter by resourceType when provided', async () => {
      mockAuthenticatedUser()
      // 1st .where(): the pinned_item list query (folder-only). 2nd: the
      // filterActivePinnedItems() existence check for the single type present.
      mockWhere.mockReturnValueOnce([mockPinnedFolderRow]).mockReturnValueOnce([{ id: 'folder-1' }])

      const req = createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost:3000/api/pinned-items?workspaceId=workspace-123&resourceType=folder'
      )

      const response = await GET(req)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.pinnedItems).toHaveLength(1)
      expect(data.pinnedItems[0]).toMatchObject({ resourceType: 'folder', resourceId: 'folder-1' })
    })

    it('excludes a pin whose underlying resource has since been deleted/archived', async () => {
      mockAuthenticatedUser()
      // The pinned_item row for the workflow pin still exists, but the
      // workflow itself is gone (empty existence-check result) — the stale
      // pin must not be returned. The folder pin's resource is still active.
      mockWhere
        .mockReturnValueOnce([mockPinnedWorkflowRow, mockPinnedFolderRow])
        .mockReturnValueOnce([])
        .mockReturnValueOnce([{ id: 'folder-1' }])

      const req = createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost:3000/api/pinned-items?workspaceId=workspace-123'
      )

      const response = await GET(req)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.pinnedItems).toHaveLength(1)
      expect(data.pinnedItems[0]).toMatchObject({ resourceType: 'folder', resourceId: 'folder-1' })
    })

    it('should return 401 for unauthenticated requests', async () => {
      mockUnauthenticated()

      const req = createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost:3000/api/pinned-items?workspaceId=workspace-123'
      )

      const response = await GET(req)

      expect(response.status).toBe(401)
      const data = await response.json()
      expect(data).toHaveProperty('error', 'Unauthorized')
    })

    it('should return 400 when workspaceId is missing', async () => {
      mockAuthenticatedUser()

      const req = createMockRequest('GET', undefined, {}, 'http://localhost:3000/api/pinned-items')

      const response = await GET(req)

      expect(response.status).toBe(400)
    })

    it('should return 403 when user has no workspace permissions', async () => {
      mockAuthenticatedUser()
      mockGetUserEntityPermissions.mockResolvedValue(null)

      const req = createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost:3000/api/pinned-items?workspaceId=workspace-123'
      )

      const response = await GET(req)

      expect(response.status).toBe(403)
      const data = await response.json()
      expect(data).toHaveProperty('error', 'Access denied to this workspace')
    })
  })

  describe('POST /api/pinned-items', () => {
    it('should pin a workflow successfully', async () => {
      mockAuthenticatedUser()
      mockResourceExists(true)
      mockReturning.mockReturnValueOnce([mockPinnedWorkflowRow])

      const req = createMockRequest('POST', {
        workspaceId: 'workspace-123',
        resourceType: 'workflow',
        resourceId: 'workflow-1',
      })

      const response = await POST(req)

      expect(response.status).toBe(201)
      const data = await response.json()
      expect(data.pinnedItem).toMatchObject({
        id: 'pinned-1',
        resourceType: 'workflow',
        resourceId: 'workflow-1',
      })
    })

    it('should pin a folder successfully', async () => {
      mockAuthenticatedUser()
      mockResourceExists(true)
      mockReturning.mockReturnValueOnce([mockPinnedFolderRow])

      const req = createMockRequest('POST', {
        workspaceId: 'workspace-123',
        resourceType: 'folder',
        resourceId: 'folder-1',
      })

      const response = await POST(req)

      expect(response.status).toBe(201)
      const data = await response.json()
      expect(data.pinnedItem).toMatchObject({
        id: 'pinned-2',
        resourceType: 'folder',
        resourceId: 'folder-1',
      })
    })

    it('should return 401 for unauthenticated requests', async () => {
      mockUnauthenticated()

      const req = createMockRequest('POST', {
        workspaceId: 'workspace-123',
        resourceType: 'workflow',
        resourceId: 'workflow-1',
      })

      const response = await POST(req)

      expect(response.status).toBe(401)
      const data = await response.json()
      expect(data).toHaveProperty('error', 'Unauthorized')
    })

    it('should return 403 when user has no workspace permissions', async () => {
      mockAuthenticatedUser()
      mockGetUserEntityPermissions.mockResolvedValue(null)

      const req = createMockRequest('POST', {
        workspaceId: 'workspace-123',
        resourceType: 'workflow',
        resourceId: 'workflow-1',
      })

      const response = await POST(req)

      expect(response.status).toBe(403)
      const data = await response.json()
      expect(data).toHaveProperty('error', 'Access denied to this workspace')
    })

    it('should return 404 when the resource does not exist in the target workspace', async () => {
      mockAuthenticatedUser()
      mockResourceExists(false)

      const req = createMockRequest('POST', {
        workspaceId: 'workspace-123',
        resourceType: 'workflow',
        resourceId: 'workflow-in-other-workspace',
      })

      const response = await POST(req)

      expect(response.status).toBe(404)
      const data = await response.json()
      expect(data).toHaveProperty('error', 'Resource not found in this workspace')
      expect(mockInsert).not.toHaveBeenCalled()
    })

    it('should return 409 when the resource is already pinned by this user', async () => {
      mockAuthenticatedUser()
      mockResourceExists(true)

      const conflictError = Object.assign(new Error('duplicate key value'), { code: '23505' })
      mockValues.mockImplementationOnce(() => {
        throw conflictError
      })

      const req = createMockRequest('POST', {
        workspaceId: 'workspace-123',
        resourceType: 'workflow',
        resourceId: 'workflow-1',
      })

      const response = await POST(req)

      expect(response.status).toBe(409)
      const data = await response.json()
      expect(data).toHaveProperty('error', 'This item is already pinned')
    })

    it('should return 500 and log on an unexpected database error', async () => {
      mockAuthenticatedUser()
      mockResourceExists(true)

      const dbError = new Error('connection lost')
      mockValues.mockImplementationOnce(() => {
        throw dbError
      })

      const req = createMockRequest('POST', {
        workspaceId: 'workspace-123',
        resourceType: 'workflow',
        resourceId: 'workflow-1',
      })

      const response = await POST(req)

      expect(response.status).toBe(500)
      const data = await response.json()
      expect(data).toHaveProperty('error', 'Internal server error')
      expect(mockLogger.error).toHaveBeenCalledWith('Error creating pinned item', {
        error: dbError,
      })
    })

    it('should return 400 when required fields are missing', async () => {
      const testCases = [
        { workspaceId: 'workspace-123', resourceType: 'workflow', resourceId: '' },
        { workspaceId: '', resourceType: 'workflow', resourceId: 'workflow-1' },
        { workspaceId: 'workspace-123', resourceId: 'workflow-1' },
        { workspaceId: 'workspace-123', resourceType: 'not-a-real-type', resourceId: 'workflow-1' },
      ]

      for (const body of testCases) {
        mockAuthenticatedUser()

        const req = createMockRequest('POST', body)

        const response = await POST(req)

        expect(response.status).toBe(400)
        const data = await response.json()
        expect(data).toHaveProperty('error', 'Validation error')
      }
    })
  })
})
