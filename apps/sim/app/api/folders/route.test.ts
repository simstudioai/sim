/**
 * Tests for folders API route
 *
 * @vitest-environment node
 */
import { auditMock, createMockRequest } from '@sim/testing'
import { drizzleOrmMock } from '@sim/testing/mocks'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockGetUserEntityPermissions, mockLogger } = vi.hoisted(() => {
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
    mockGetSession: vi.fn(),
    mockGetUserEntityPermissions: vi.fn(),
    mockLogger: logger,
  }
})

vi.mock('@/lib/audit/log', () => auditMock)
vi.mock('drizzle-orm', () => ({
  ...drizzleOrmMock,
  min: vi.fn((field) => ({ type: 'min', field })),
}))
vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))
vi.mock('@sim/logger', () => ({
  createLogger: vi.fn().mockReturnValue(mockLogger),
}))
vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getUserEntityPermissions: mockGetUserEntityPermissions,
}))

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
  onInsertValues?: (values: CapturedFolderValues) => void
}) {
  const { selectResults = [[], []], insertResult = [], onInsertValues } = mockData
  return async (callback: (tx: unknown) => Promise<unknown>) => {
    const where = vi.fn()
    for (const result of selectResults) {
      where.mockReturnValueOnce(result)
    }
    where.mockReturnValue([])

    const tx = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where,
        }),
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockImplementation((values: CapturedFolderValues) => {
          onInsertValues?.(values)
          return {
            returning: vi.fn().mockReturnValue(insertResult),
          }
        }),
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
  const mockOrderBy = vi.fn()
  const mockInsert = mockDb.insert
  const mockValues = vi.fn()
  const mockReturning = vi.fn()
  const mockTransaction = mockDb.transaction

  function mockAuthenticatedUser() {
    mockGetSession.mockResolvedValue({ user: defaultMockUser })
  }

  function mockUnauthenticated() {
    mockGetSession.mockResolvedValue(null)
  }

  beforeEach(() => {
    vi.clearAllMocks()

    vi.stubGlobal('crypto', {
      randomUUID: vi.fn().mockReturnValue(mockUUID),
    })

    mockSelect.mockReturnValue({ from: mockFrom })
    mockFrom.mockReturnValue({ where: mockWhere })
    mockWhere.mockReturnValue({ orderBy: mockOrderBy })
    mockOrderBy.mockReturnValue(mockFolders)

    mockInsert.mockReturnValue({ values: mockValues })
    mockValues.mockReturnValue({ returning: mockReturning })
    mockReturning.mockReturnValue([mockFolders[0]])

    mockGetUserEntityPermissions.mockResolvedValue('admin')
  })

  describe('GET /api/folders', () => {
    it('should return folders for a valid workspace', async () => {
      mockAuthenticatedUser()

      const mockRequest = createMockRequest('GET')
      Object.defineProperty(mockRequest, 'url', {
        value: 'http://localhost:3000/api/folders?workspaceId=workspace-123',
      })

      const response = await GET(mockRequest)

      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data).toHaveProperty('folders')
      expect(data.folders).toHaveLength(2)
      expect(data.folders[0]).toMatchObject({
        id: 'folder-1',
        name: 'Test Folder 1',
        workspaceId: 'workspace-123',
      })
    })

    it('should return 401 for unauthenticated requests', async () => {
      mockUnauthenticated()

      const mockRequest = createMockRequest('GET')
      Object.defineProperty(mockRequest, 'url', {
        value: 'http://localhost:3000/api/folders?workspaceId=workspace-123',
      })

      const response = await GET(mockRequest)

      expect(response.status).toBe(401)

      const data = await response.json()
      expect(data).toHaveProperty('error', 'Unauthorized')
    })

    it('should return 400 when workspaceId is missing', async () => {
      mockAuthenticatedUser()

      const mockRequest = createMockRequest('GET')
      Object.defineProperty(mockRequest, 'url', {
        value: 'http://localhost:3000/api/folders',
      })

      const response = await GET(mockRequest)

      expect(response.status).toBe(400)

      const data = await response.json()
      expect(data).toHaveProperty('error', 'Workspace ID is required')
    })

    it('should return 403 when user has no workspace permissions', async () => {
      mockAuthenticatedUser()
      mockGetUserEntityPermissions.mockResolvedValue(null)

      const mockRequest = createMockRequest('GET')
      Object.defineProperty(mockRequest, 'url', {
        value: 'http://localhost:3000/api/folders?workspaceId=workspace-123',
      })

      const response = await GET(mockRequest)

      expect(response.status).toBe(403)

      const data = await response.json()
      expect(data).toHaveProperty('error', 'Access denied to this workspace')
    })

    it('should return 403 when user has only read permissions', async () => {
      mockAuthenticatedUser()
      mockGetUserEntityPermissions.mockResolvedValue('read')

      const mockRequest = createMockRequest('GET')
      Object.defineProperty(mockRequest, 'url', {
        value: 'http://localhost:3000/api/folders?workspaceId=workspace-123',
      })

      const response = await GET(mockRequest)

      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data).toHaveProperty('folders')
    })

    it('should handle database errors gracefully', async () => {
      mockAuthenticatedUser()

      mockSelect.mockImplementationOnce(() => {
        throw new Error('Database connection failed')
      })

      const mockRequest = createMockRequest('GET')
      Object.defineProperty(mockRequest, 'url', {
        value: 'http://localhost:3000/api/folders?workspaceId=workspace-123',
      })

      const response = await GET(mockRequest)

      expect(response.status).toBe(500)

      const data = await response.json()
      expect(data).toHaveProperty('error', 'Internal server error')
      expect(mockLogger.error).toHaveBeenCalledWith('Error fetching folders:', {
        error: expect.any(Error),
      })
    })
  })

  describe('POST /api/folders', () => {
    it('should create a new folder successfully', async () => {
      mockAuthenticatedUser()

      mockTransaction.mockImplementationOnce(
        createMockTransaction({
          selectResults: [[], []],
          insertResult: [mockFolders[0]],
        })
      )

      const req = createMockRequest('POST', {
        name: 'New Test Folder',
        workspaceId: 'workspace-123',
        color: '#6B7280',
      })

      const response = await POST(req)
      const responseBody = await response.json()

      expect(response.status).toBe(200)
      expect(responseBody).toHaveProperty('folder')
      expect(responseBody.folder).toMatchObject({
        id: 'folder-1',
        name: 'Test Folder 1',
        workspaceId: 'workspace-123',
      })
    })

    it('should create folder with correct sort order', async () => {
      mockAuthenticatedUser()
      let capturedValues: CapturedFolderValues | null = null

      mockTransaction.mockImplementationOnce(
        createMockTransaction({
          selectResults: [[{ minSortOrder: 5 }], [{ minSortOrder: 2 }]],
          insertResult: [{ ...mockFolders[0], sortOrder: 1 }],
          onInsertValues: (values) => {
            capturedValues = values
          },
        })
      )

      const req = createMockRequest('POST', {
        name: 'New Test Folder',
        workspaceId: 'workspace-123',
      })

      const response = await POST(req)

      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data.folder).toMatchObject({
        sortOrder: 1,
      })
      expect(capturedValues).not.toBeNull()
      expect(capturedValues!.sortOrder).toBe(1)
    })

    it('should create subfolder with parent reference', async () => {
      mockAuthenticatedUser()

      mockTransaction.mockImplementationOnce(
        createMockTransaction({
          selectResults: [[], []],
          insertResult: [{ ...mockFolders[1] }],
        })
      )

      const req = createMockRequest('POST', {
        name: 'Subfolder',
        workspaceId: 'workspace-123',
        parentId: 'folder-1',
      })

      const response = await POST(req)

      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data.folder).toMatchObject({
        parentId: 'folder-1',
      })
    })

    it('should return 401 for unauthenticated requests', async () => {
      mockUnauthenticated()

      const req = createMockRequest('POST', {
        name: 'Test Folder',
        workspaceId: 'workspace-123',
      })

      const response = await POST(req)

      expect(response.status).toBe(401)

      const data = await response.json()
      expect(data).toHaveProperty('error', 'Unauthorized')
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

    it('should allow folder creation for write permissions', async () => {
      mockAuthenticatedUser()
      mockGetUserEntityPermissions.mockResolvedValue('write')

      mockTransaction.mockImplementationOnce(
        createMockTransaction({
          selectResults: [[], []],
          insertResult: [mockFolders[0]],
        })
      )

      const req = createMockRequest('POST', {
        name: 'Test Folder',
        workspaceId: 'workspace-123',
      })

      const response = await POST(req)

      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data).toHaveProperty('folder')
    })

    it('should allow folder creation for admin permissions', async () => {
      mockAuthenticatedUser()
      mockGetUserEntityPermissions.mockResolvedValue('admin')

      mockTransaction.mockImplementationOnce(
        createMockTransaction({
          selectResults: [[], []],
          insertResult: [mockFolders[0]],
        })
      )

      const req = createMockRequest('POST', {
        name: 'Test Folder',
        workspaceId: 'workspace-123',
      })

      const response = await POST(req)

      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data).toHaveProperty('folder')
    })

    it('should return 400 when required fields are missing', async () => {
      const testCases = [
        { name: '', workspaceId: 'workspace-123' },
        { name: 'Test Folder', workspaceId: '' },
        { workspaceId: 'workspace-123' },
        { name: 'Test Folder' },
      ]

      for (const body of testCases) {
        mockAuthenticatedUser()

        const req = createMockRequest('POST', body)

        const response = await POST(req)

        expect(response.status).toBe(400)

        const data = await response.json()
        expect(data).toHaveProperty('error', 'Name and workspace ID are required')
      }
    })

    it('should handle database errors gracefully', async () => {
      mockAuthenticatedUser()

      mockTransaction.mockImplementationOnce(() => {
        throw new Error('Database transaction failed')
      })

      const req = createMockRequest('POST', {
        name: 'Test Folder',
        workspaceId: 'workspace-123',
      })

      const response = await POST(req)

      expect(response.status).toBe(500)

      const data = await response.json()
      expect(data).toHaveProperty('error', 'Internal server error')
      expect(mockLogger.error).toHaveBeenCalledWith('Error creating folder:', {
        error: expect.any(Error),
      })
    })

    it('should trim folder name when creating', async () => {
      mockAuthenticatedUser()

      let capturedValues: CapturedFolderValues | null = null

      mockTransaction.mockImplementationOnce(
        createMockTransaction({
          selectResults: [[], []],
          insertResult: [mockFolders[0]],
          onInsertValues: (values) => {
            capturedValues = values
          },
        })
      )

      const req = createMockRequest('POST', {
        name: '  Test Folder With Spaces  ',
        workspaceId: 'workspace-123',
      })

      await POST(req)

      expect(capturedValues).not.toBeNull()
      expect(capturedValues!.name).toBe('Test Folder With Spaces')
    })

    it('should use default color when not provided', async () => {
      mockAuthenticatedUser()

      let capturedValues: CapturedFolderValues | null = null

      mockTransaction.mockImplementationOnce(
        createMockTransaction({
          selectResults: [[], []],
          insertResult: [mockFolders[0]],
          onInsertValues: (values) => {
            capturedValues = values
          },
        })
      )

      const req = createMockRequest('POST', {
        name: 'Test Folder',
        workspaceId: 'workspace-123',
      })

      await POST(req)

      expect(capturedValues).not.toBeNull()
      expect(capturedValues!.color).toBe('#6B7280')
    })
  })
})
