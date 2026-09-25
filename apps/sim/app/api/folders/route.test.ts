/**
 * Tests for folders API route
 */
import {
  auditMock,
  authMockFns,
  createMockRequest,
  permissionsMock,
  permissionsMockFns,
  workflowAuthzMockFns,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockLogger } = vi.hoisted(() => {
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
  }
})

const mockGetUserEntityPermissions = permissionsMockFns.mockGetUserEntityPermissions

vi.mock('@sim/audit', () => auditMock)
vi.mock('@sim/logger', () => ({
  createLogger: vi.fn().mockReturnValue(mockLogger),
  runWithRequestContext: <T>(_ctx: unknown, fn: () => T): T => fn(),
  getRequestContext: () => undefined,
  setRequestAuth: vi.fn(),
}))
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

import { db } from '@sim/db'
import { GET, POST } from '@/app/api/folders/route'

const mockDb = db as any

interface CapturedFolderValues {
  name?: string
  color?: string
  parentId?: string | null
  isExpanded?: boolean
  sortOrder?: number
  updatedAt?: Date
}

function createMockTransaction(mockData: {
  selectResults?: Array<Array<{ [key: string]: unknown }>>
  insertResult?: Array<{ id: string; [key: string]: unknown }>
  insertError?: Error
  onInsertValues?: (values: CapturedFolderValues) => void
}) {
  const { selectResults = [[], []], insertResult = [], insertError, onInsertValues } = mockData
  return async (callback: (tx: unknown) => Promise<unknown>) => {
    const where = vi.fn()
    for (const result of selectResults) {
      const withLimit = result as typeof result & { limit: ReturnType<typeof vi.fn> }
      withLimit.limit = vi.fn().mockReturnValue(result)
      where.mockReturnValueOnce(withLimit)
    }
    where.mockReturnValue([])

    const tx = {
      execute: vi.fn(),
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where,
        }),
      }),
      insert: vi.fn().mockImplementation(() => {
        if (insertError) throw insertError
        return {
          values: vi.fn().mockImplementation((values: CapturedFolderValues) => {
            onInsertValues?.(values)
            return {
              returning: vi.fn().mockReturnValue(insertResult),
            }
          }),
        }
      }),
    }
    return await callback(tx)
  }
}

const defaultMockUser = {
  id: 'user-123',
  email: 'test@example.com',
  name: 'Test User',
}

describe('Folders API Route', () => {
  const mockFolders = [
    {
      id: 'folder-1',
      name: 'Test Folder 1',
      userId: 'user-123',
      workspaceId: 'workspace-123',
      parentId: null,
      color: '#6B7280',
      isExpanded: true,
      sortOrder: 0,
      createdAt: new Date('2023-01-01T00:00:00.000Z'),
      updatedAt: new Date('2023-01-01T00:00:00.000Z'),
    },
    {
      id: 'folder-2',
      name: 'Test Folder 2',
      userId: 'user-123',
      workspaceId: 'workspace-123',
      parentId: 'folder-1',
      color: '#EF4444',
      isExpanded: false,
      sortOrder: 1,
      createdAt: new Date('2023-01-02T00:00:00.000Z'),
      updatedAt: new Date('2023-01-02T00:00:00.000Z'),
    },
  ]

  const mockUUID = 'mock-uuid-12345678-90ab-cdef-1234-567890abcdef'

  const mockSelect = mockDb.select
  const mockFrom = vi.fn()
  const mockWhere = vi.fn()
  const mockLimit = vi.fn()
  const mockOrderBy = vi.fn()
  const mockInsert = mockDb.insert
  const mockValues = vi.fn()
  const mockReturning = vi.fn()
  const mockTransaction = mockDb.transaction

  function mockAuthenticatedUser() {
    authMockFns.mockGetSession.mockResolvedValue({ user: defaultMockUser })
  }

  beforeEach(() => {
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn().mockReturnValue(mockUUID),
    })

    mockSelect.mockReturnValue({ from: mockFrom })
    mockFrom.mockReturnValue({ where: mockWhere })
    const defaultWhereResult = [] as Array<Record<string, unknown>> & {
      orderBy: typeof mockOrderBy
      limit: typeof mockLimit
    }
    defaultWhereResult.orderBy = mockOrderBy
    defaultWhereResult.limit = mockLimit
    mockWhere.mockReturnValue(defaultWhereResult)
    mockLimit.mockReturnValue([])
    mockOrderBy.mockReturnValue(mockFolders)

    mockInsert.mockReturnValue({ values: mockValues })
    mockValues.mockReturnValue({ returning: mockReturning })
    mockReturning.mockReturnValue([mockFolders[0]])
    mockTransaction.mockImplementation(createMockTransaction({}))

    mockGetUserEntityPermissions.mockResolvedValue('admin')
  })

  describe('GET /api/folders', () => {
    it('should return 403 when user has no workspace permissions', async () => {
      mockAuthenticatedUser()
      mockGetUserEntityPermissions.mockResolvedValue(null)

      const mockRequest = createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost:3000/api/folders?workspaceId=workspace-123'
      )

      const response = await GET(mockRequest)

      expect(response.status).toBe(403)

      const data = await response.json()
      expect(data).toHaveProperty('error', 'Access denied to this workspace')
    })
  })

  describe('POST /api/folders', () => {
    /**
     * The bounded readers refuse a workspace above `MAX_FOLDERS_PER_WORKSPACE`,
     * so this endpoint must refuse to push one there — and must say so as an
     * actionable 409, not an unexplained 500.
     */
    it('refuses with 409 and an actionable message at the folder ceiling', async () => {
      mockAuthenticatedUser()

      mockTransaction.mockImplementationOnce(
        createMockTransaction({
          selectResults: [[{ total: 10_000 }]],
          // A row the insert would return, so a missing guard shows up as a 200, not a fault.
          insertResult: [mockFolders[0]],
        })
      )

      const response = await POST(
        createMockRequest('POST', { name: 'One More', workspaceId: 'workspace-123' })
      )

      expect(response.status).toBe(409)
      await expect(response.json()).resolves.toEqual({
        error:
          'This workspace has reached its limit of 10,000 workflow folders. Delete folders you no longer need before creating another one.',
      })
    })

    it('should reject creating a subfolder inside a locked parent folder', async () => {
      mockAuthenticatedUser()

      const { FolderLockedError } = await import('@sim/platform-authz/workflow')
      workflowAuthzMockFns.mockAssertFolderMutable.mockRejectedValueOnce(
        new FolderLockedError('Folder is locked')
      )

      const req = createMockRequest('POST', {
        name: 'Subfolder',
        workspaceId: 'workspace-123',
        parentId: 'locked-folder',
      })

      const response = await POST(req)

      expect(response.status).toBe(423)
      expect(mockTransaction).not.toHaveBeenCalled()
    })

    it('should reject a parentId that does not resolve to a folder in the workspace', async () => {
      mockAuthenticatedUser()

      mockLimit.mockReturnValueOnce([])

      const req = createMockRequest('POST', {
        name: 'Subfolder',
        workspaceId: 'workspace-123',
        parentId: 'folder-in-other-workspace',
      })

      const response = await POST(req)

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.error).toBe('Parent folder not found')
    })

    it('should return 403 when user has only read permissions', async () => {
      mockAuthenticatedUser()
      mockGetUserEntityPermissions.mockResolvedValue('read')

      const req = createMockRequest('POST', {
        name: 'Test Folder',
        workspaceId: 'workspace-123',
      })

      const response = await POST(req)

      expect(response.status).toBe(403)

      const data = await response.json()
      expect(data).toHaveProperty('error', 'Write or Admin access required to create folders')
    })
  })
})
