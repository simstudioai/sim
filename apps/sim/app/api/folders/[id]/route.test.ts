/**
 * Tests for individual folder API route (/api/folders/[id])
 *
 * @vitest-environment node
 */
import { auditMock, createMockRequest, type MockUser } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockGetUserEntityPermissions, mockLogger, mockDbRef } = vi.hoisted(() => {
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
    mockDbRef: { current: null as any },
  }
})

vi.mock('@/lib/audit/log', () => auditMock)
vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))
vi.mock('@sim/logger', () => ({
  createLogger: vi.fn().mockReturnValue(mockLogger),
}))
vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getUserEntityPermissions: mockGetUserEntityPermissions,
}))
vi.mock('@sim/db', () => ({
  get db() {
    return mockDbRef.current
  },
}))

import { DELETE, PUT } from '@/app/api/folders/[id]/route'

/** Type for captured folder values in tests */
interface CapturedFolderValues {
  name?: string
  color?: string
  parentId?: string | null
  isExpanded?: boolean
  sortOrder?: number
  updatedAt?: Date
}

interface FolderDbMockOptions {
  folderLookupResult?: any
  updateResult?: any[]
  throwError?: boolean
  circularCheckResults?: any[]
}

const TEST_USER: MockUser = {
  id: 'user-123',
  email: 'test@example.com',
  name: 'Test User',
}

const mockFolder = {
  id: 'folder-1',
  name: 'Test Folder',
  userId: TEST_USER.id,
  workspaceId: 'workspace-123',
  parentId: null,
  color: '#6B7280',
  sortOrder: 1,
  createdAt: new Date('2024-01-01T00:00:00Z'),
  updatedAt: new Date('2024-01-01T00:00:00Z'),
}

function createFolderDbMock(options: FolderDbMockOptions = {}) {
  const {
    folderLookupResult = mockFolder,
    updateResult = [{ ...mockFolder, name: 'Updated Folder' }],
    throwError = false,
    circularCheckResults = [],
  } = options

  let callCount = 0

  const mockSelect = vi.fn().mockImplementation(() => ({
    from: vi.fn().mockImplementation(() => ({
      where: vi.fn().mockImplementation(() => ({
        then: vi.fn().mockImplementation((callback) => {
          if (throwError) {
            throw new Error('Database error')
          }

          callCount++
          if (callCount === 1) {
            const result = folderLookupResult === undefined ? [] : [folderLookupResult]
            return Promise.resolve(callback(result))
          }
          if (callCount > 1 && circularCheckResults.length > 0) {
            const index = callCount - 2
            const result = circularCheckResults[index] ? [circularCheckResults[index]] : []
            return Promise.resolve(callback(result))
          }
          return Promise.resolve(callback([]))
        }),
      })),
    })),
  }))

  const mockUpdate = vi.fn().mockImplementation(() => ({
    set: vi.fn().mockImplementation(() => ({
      where: vi.fn().mockImplementation(() => ({
        returning: vi.fn().mockReturnValue(updateResult),
      })),
    })),
  }))

  const mockDelete = vi.fn().mockImplementation(() => ({
    where: vi.fn().mockImplementation(() => Promise.resolve()),
  }))

  return {
    select: mockSelect,
    update: mockUpdate,
    delete: mockDelete,
  }
}

function mockAuthenticatedUser(user?: MockUser) {
  mockGetSession.mockResolvedValue({ user: user || TEST_USER })
}

function mockUnauthenticated() {
  mockGetSession.mockResolvedValue(null)
}

describe('Individual Folder API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockGetUserEntityPermissions.mockResolvedValue('admin')
    mockDbRef.current = createFolderDbMock()
  })

  describe('PUT /api/folders/[id]', () => {
    it('should update folder successfully', async () => {
      mockAuthenticatedUser()

      const req = createMockRequest('PUT', {
        name: 'Updated Folder Name',
        color: '#FF0000',
      })
      const params = Promise.resolve({ id: 'folder-1' })

      const response = await PUT(req, { params })

      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data).toHaveProperty('folder')
      expect(data.folder).toMatchObject({
        name: 'Updated Folder',
      })
    })

    it('should update parent folder successfully', async () => {
      mockAuthenticatedUser()

      const req = createMockRequest('PUT', {
        name: 'Updated Folder',
        parentId: 'parent-folder-1',
      })
      const params = Promise.resolve({ id: 'folder-1' })

      const response = await PUT(req, { params })

      expect(response.status).toBe(200)
    })

    it('should return 401 for unauthenticated requests', async () => {
      mockUnauthenticated()

      const req = createMockRequest('PUT', {
        name: 'Updated Folder',
      })
      const params = Promise.resolve({ id: 'folder-1' })

      const response = await PUT(req, { params })

      expect(response.status).toBe(401)

      const data = await response.json()
      expect(data).toHaveProperty('error', 'Unauthorized')
    })

    it('should return 403 when user has only read permissions', async () => {
      mockAuthenticatedUser()
      mockGetUserEntityPermissions.mockResolvedValue('read')

      const req = createMockRequest('PUT', {
        name: 'Updated Folder',
      })
      const params = Promise.resolve({ id: 'folder-1' })

      const response = await PUT(req, { params })

      expect(response.status).toBe(403)

      const data = await response.json()
      expect(data).toHaveProperty('error', 'Write access required to update folders')
    })

    it('should allow folder update for write permissions', async () => {
      mockAuthenticatedUser()
      mockGetUserEntityPermissions.mockResolvedValue('write')

      const req = createMockRequest('PUT', {
        name: 'Updated Folder',
      })
      const params = Promise.resolve({ id: 'folder-1' })

      const response = await PUT(req, { params })

      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data).toHaveProperty('folder')
    })

    it('should allow folder update for admin permissions', async () => {
      mockAuthenticatedUser()
      mockGetUserEntityPermissions.mockResolvedValue('admin')

      const req = createMockRequest('PUT', {
        name: 'Updated Folder',
      })
      const params = Promise.resolve({ id: 'folder-1' })

      const response = await PUT(req, { params })

      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data).toHaveProperty('folder')
    })

    it('should return 400 when trying to set folder as its own parent', async () => {
      mockAuthenticatedUser()

      const req = createMockRequest('PUT', {
        name: 'Updated Folder',
        parentId: 'folder-1',
      })
      const params = Promise.resolve({ id: 'folder-1' })

      const response = await PUT(req, { params })

      expect(response.status).toBe(400)

      const data = await response.json()
      expect(data).toHaveProperty('error', 'Folder cannot be its own parent')
    })

    it('should trim folder name when updating', async () => {
      mockAuthenticatedUser()

      let capturedUpdates: CapturedFolderValues | null = null

      const mockSelect = vi.fn().mockImplementation(() => ({
        from: vi.fn().mockImplementation(() => ({
          where: vi.fn().mockImplementation(() => ({
            then: vi.fn().mockImplementation((callback) => {
              return Promise.resolve(callback([mockFolder]))
            }),
          })),
        })),
      }))

      const mockUpdate = vi.fn().mockImplementation(() => ({
        set: vi.fn().mockImplementation((updates) => {
          capturedUpdates = updates
          return {
            where: vi.fn().mockImplementation(() => ({
              returning: vi.fn().mockReturnValue([{ ...mockFolder, name: 'Folder With Spaces' }]),
            })),
          }
        }),
      }))

      mockDbRef.current = {
        select: mockSelect,
        update: mockUpdate,
        delete: vi.fn(),
      }

      const req = createMockRequest('PUT', {
        name: '  Folder With Spaces  ',
      })
      const params = Promise.resolve({ id: 'folder-1' })

      await PUT(req, { params })

      expect(capturedUpdates).not.toBeNull()
      expect(capturedUpdates!.name).toBe('Folder With Spaces')
    })

    it('should handle database errors gracefully', async () => {
      mockAuthenticatedUser()

      mockDbRef.current = createFolderDbMock({
        throwError: true,
      })

      const req = createMockRequest('PUT', {
        name: 'Updated Folder',
      })
      const params = Promise.resolve({ id: 'folder-1' })

      const response = await PUT(req, { params })

      expect(response.status).toBe(500)

      const data = await response.json()
      expect(data).toHaveProperty('error', 'Internal server error')
      expect(mockLogger.error).toHaveBeenCalledWith('Error updating folder:', {
        error: expect.any(Error),
      })
    })
  })

  describe('Input Validation', () => {
    it('should handle empty folder name', async () => {
      mockAuthenticatedUser()

      const req = createMockRequest('PUT', {
        name: '',
      })
      const params = Promise.resolve({ id: 'folder-1' })

      const response = await PUT(req, { params })

      expect(response.status).toBe(200)
    })

    it('should handle invalid JSON payload', async () => {
      mockAuthenticatedUser()

      const req = new Request('http://localhost:3000/api/folders/folder-1', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: 'invalid-json',
      }) as any

      const params = Promise.resolve({ id: 'folder-1' })

      const response = await PUT(req, { params })

      expect(response.status).toBe(500)
    })
  })

  describe('Circular Reference Prevention', () => {
    it('should prevent circular references when updating parent', async () => {
      mockAuthenticatedUser()

      const circularCheckResults = [{ parentId: 'folder-2' }, { parentId: 'folder-3' }]

      mockDbRef.current = createFolderDbMock({
        folderLookupResult: { id: 'folder-3', parentId: null, name: 'Folder 3' },
        circularCheckResults,
      })

      const req = createMockRequest('PUT', {
        name: 'Updated Folder 3',
        parentId: 'folder-1',
      })
      const params = Promise.resolve({ id: 'folder-3' })

      const response = await PUT(req, { params })

      expect(response.status).toBe(400)

      const data = await response.json()
      expect(data).toHaveProperty('error', 'Cannot create circular folder reference')
    })
  })

  describe('DELETE /api/folders/[id]', () => {
    it('should delete folder and all contents successfully', async () => {
      mockAuthenticatedUser()

      mockDbRef.current = createFolderDbMock({
        folderLookupResult: mockFolder,
      })

      const req = createMockRequest('DELETE')
      const params = Promise.resolve({ id: 'folder-1' })

      const response = await DELETE(req, { params })

      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data).toHaveProperty('success', true)
      expect(data).toHaveProperty('deletedItems')
    })

    it('should return 401 for unauthenticated delete requests', async () => {
      mockUnauthenticated()

      const req = createMockRequest('DELETE')
      const params = Promise.resolve({ id: 'folder-1' })

      const response = await DELETE(req, { params })

      expect(response.status).toBe(401)

      const data = await response.json()
      expect(data).toHaveProperty('error', 'Unauthorized')
    })

    it('should return 403 when user has only read permissions for delete', async () => {
      mockAuthenticatedUser()
      mockGetUserEntityPermissions.mockResolvedValue('read')

      const req = createMockRequest('DELETE')
      const params = Promise.resolve({ id: 'folder-1' })

      const response = await DELETE(req, { params })

      expect(response.status).toBe(403)

      const data = await response.json()
      expect(data).toHaveProperty('error', 'Admin access required to delete folders')
    })

    it('should return 403 when user has only write permissions for delete', async () => {
      mockAuthenticatedUser()
      mockGetUserEntityPermissions.mockResolvedValue('write')

      const req = createMockRequest('DELETE')
      const params = Promise.resolve({ id: 'folder-1' })

      const response = await DELETE(req, { params })

      expect(response.status).toBe(403)

      const data = await response.json()
      expect(data).toHaveProperty('error', 'Admin access required to delete folders')
    })

    it('should allow folder deletion for admin permissions', async () => {
      mockAuthenticatedUser()
      mockGetUserEntityPermissions.mockResolvedValue('admin')

      mockDbRef.current = createFolderDbMock({
        folderLookupResult: mockFolder,
      })

      const req = createMockRequest('DELETE')
      const params = Promise.resolve({ id: 'folder-1' })

      const response = await DELETE(req, { params })

      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data).toHaveProperty('success', true)
    })

    it('should handle database errors during deletion', async () => {
      mockAuthenticatedUser()

      mockDbRef.current = createFolderDbMock({
        throwError: true,
      })

      const req = createMockRequest('DELETE')
      const params = Promise.resolve({ id: 'folder-1' })

      const response = await DELETE(req, { params })

      expect(response.status).toBe(500)

      const data = await response.json()
      expect(data).toHaveProperty('error', 'Internal server error')
      expect(mockLogger.error).toHaveBeenCalledWith('Error deleting folder:', {
        error: expect.any(Error),
      })
    })
  })
})
