/**
 * Tests for individual folder API route (/api/folders/[id])
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type CapturedFolderValues,
  createMockRequest,
  type MockUser,
  mockAuth,
  mockLogger,
  setupCommonApiMocks,
} from '@/app/api/__test-utils__/utils'

interface FolderDbMockOptions {
  folderLookupResult?: any
  updateResult?: any[]
  throwError?: boolean
  circularCheckResults?: any[]
}

describe('Individual Folder API Route', () => {
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

  const { mockAuthenticatedUser, mockUnauthenticated } = mockAuth(TEST_USER)
  const mockGetUserEntityPermissions = vi.fn()

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
            // First call: folder lookup
            if (callCount === 1) {
              // The route code does .then((rows) => rows[0])
              // So we need to return an array for folderLookupResult
              const result = folderLookupResult === undefined ? [] : [folderLookupResult]
              return Promise.resolve(callback(result))
            }
            // Subsequent calls: circular reference checks
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
      db: {
        select: mockSelect,
        update: mockUpdate,
        delete: mockDelete,
      },
      mocks: {
        select: mockSelect,
        update: mockUpdate,
        delete: mockDelete,
      },
    }
  }

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    setupCommonApiMocks()

    mockGetUserEntityPermissions.mockResolvedValue('admin')

    vi.doMock('@/lib/permissions/utils', () => ({
      getUserEntityPermissions: mockGetUserEntityPermissions,
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('PUT /api/folders/[id]', () => {
    it('should update folder successfully', async () => {
      mockAuthenticatedUser()

      const dbMock = createFolderDbMock()
      vi.doMock('@/db', () => dbMock)

      const req = createMockRequest('PUT', {
        name: 'Updated Folder Name',
        color: '#FF0000',
      })
      const params = Promise.resolve({ id: 'folder-1' })

      const { PUT } = await import('./route')

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

      const dbMock = createFolderDbMock()
      vi.doMock('@/db', () => dbMock)

      const req = createMockRequest('PUT', {
        name: 'Updated Folder',
        parentId: 'parent-folder-1',
      })
      const params = Promise.resolve({ id: 'folder-1' })

      const { PUT } = await import('./route')

      const response = await PUT(req, { params })

      expect(response.status).toBe(200)
    })

    it('should return 401 for unauthenticated requests', async () => {
      mockUnauthenticated()

      const dbMock = createFolderDbMock()
      vi.doMock('@/db', () => dbMock)

      const req = createMockRequest('PUT', {
        name: 'Updated Folder',
      })
      const params = Promise.resolve({ id: 'folder-1' })

      const { PUT } = await import('./route')

      const response = await PUT(req, { params })

      expect(response.status).toBe(401)

      const data = await response.json()
      expect(data).toHaveProperty('error', 'Unauthorized')
    })

    it('should return 403 when user has only read permissions', async () => {
      mockAuthenticatedUser()
      mockGetUserEntityPermissions.mockResolvedValue('read') // Read-only permissions

      const dbMock = createFolderDbMock()
      vi.doMock('@/db', () => dbMock)

      const req = createMockRequest('PUT', {
        name: 'Updated Folder',
      })
      const params = Promise.resolve({ id: 'folder-1' })

      const { PUT } = await import('./route')

      const response = await PUT(req, { params })

      expect(response.status).toBe(403)

      const data = await response.json()
      expect(data).toHaveProperty('error', 'Write access required to update folders')
    })

    it('should allow folder update for write permissions', async () => {
      mockAuthenticatedUser()
      mockGetUserEntityPermissions.mockResolvedValue('write') // Write permissions

      const dbMock = createFolderDbMock()
      vi.doMock('@/db', () => dbMock)

      const req = createMockRequest('PUT', {
        name: 'Updated Folder',
      })
      const params = Promise.resolve({ id: 'folder-1' })

      const { PUT } = await import('./route')

      const response = await PUT(req, { params })

      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data).toHaveProperty('folder')
    })

    it('should allow folder update for admin permissions', async () => {
      mockAuthenticatedUser()
      mockGetUserEntityPermissions.mockResolvedValue('admin') // Admin permissions

      const dbMock = createFolderDbMock()
      vi.doMock('@/db', () => dbMock)

      const req = createMockRequest('PUT', {
        name: 'Updated Folder',
      })
      const params = Promise.resolve({ id: 'folder-1' })

      const { PUT } = await import('./route')

      const response = await PUT(req, { params })

      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data).toHaveProperty('folder')
    })

    it('should return 400 when trying to set folder as its own parent', async () => {
      mockAuthenticatedUser()

      const dbMock = createFolderDbMock()
      vi.doMock('@/db', () => dbMock)

      const req = createMockRequest('PUT', {
        name: 'Updated Folder',
        parentId: 'folder-1', // Same as the folder ID
      })
      const params = Promise.resolve({ id: 'folder-1' })

      const { PUT } = await import('./route')

      const response = await PUT(req, { params })

      expect(response.status).toBe(400)

      const data = await response.json()
      expect(data).toHaveProperty('error', 'Folder cannot be its own parent')
    })

    it('should trim folder name when updating', async () => {
      mockAuthenticatedUser()

      let capturedUpdates: CapturedFolderValues | null = null
      const dbMock = createFolderDbMock({
        updateResult: [{ ...mockFolder, name: 'Folder With Spaces' }],
      })

      // Override the set implementation to capture updates
      const originalSet = dbMock.mocks.update().set
      dbMock.mocks.update.mockReturnValue({
        set: vi.fn().mockImplementation((updates) => {
          capturedUpdates = updates
          return originalSet(updates)
        }),
      })

      vi.doMock('@/db', () => dbMock)

      const req = createMockRequest('PUT', {
        name: '  Folder With Spaces  ',
      })
      const params = Promise.resolve({ id: 'folder-1' })

      const { PUT } = await import('./route')

      await PUT(req, { params })

      expect(capturedUpdates).not.toBeNull()
      expect(capturedUpdates!.name).toBe('Folder With Spaces')
    })

    it('should handle database errors gracefully', async () => {
      mockAuthenticatedUser()

      const dbMock = createFolderDbMock({
        throwError: true,
      })
      vi.doMock('@/db', () => dbMock)

      const req = createMockRequest('PUT', {
        name: 'Updated Folder',
      })
      const params = Promise.resolve({ id: 'folder-1' })

      const { PUT } = await import('./route')

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

      const dbMock = createFolderDbMock()
      vi.doMock('@/db', () => dbMock)

      const req = createMockRequest('PUT', {
        name: '', // Empty name
      })
      const params = Promise.resolve({ id: 'folder-1' })

      const { PUT } = await import('./route')

      const response = await PUT(req, { params })

      // Should still work as the API doesn't validate empty names
      expect(response.status).toBe(200)
    })

    it('should handle invalid JSON payload', async () => {
      mockAuthenticatedUser()

      const dbMock = createFolderDbMock()
      vi.doMock('@/db', () => dbMock)

      // Create a request with invalid JSON
      const req = new Request('http://localhost:3000/api/folders/folder-1', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: 'invalid-json',
      }) as any

      const params = Promise.resolve({ id: 'folder-1' })

      const { PUT } = await import('./route')

      const response = await PUT(req, { params })

      expect(response.status).toBe(500) // Should handle JSON parse error gracefully
    })
  })

  describe('Circular Reference Prevention', () => {
    it('should prevent circular references when updating parent', async () => {
      mockAuthenticatedUser()

      // Mock the circular reference scenario
      // folder-3 trying to set folder-1 as parent,
      // but folder-1 -> folder-2 -> folder-3 (would create cycle)
      const circularCheckResults = [
        { parentId: 'folder-2' }, // folder-1 has parent folder-2
        { parentId: 'folder-3' }, // folder-2 has parent folder-3 (creates cycle!)
      ]

      const dbMock = createFolderDbMock({
        folderLookupResult: { id: 'folder-3', parentId: null, name: 'Folder 3' },
        circularCheckResults,
      })
      vi.doMock('@/db', () => dbMock)

      const req = createMockRequest('PUT', {
        name: 'Updated Folder 3',
        parentId: 'folder-1', // This would create a circular reference
      })
      const params = Promise.resolve({ id: 'folder-3' })

      const { PUT } = await import('./route')

      const response = await PUT(req, { params })

      // Should return 400 due to circular reference
      expect(response.status).toBe(400)

      const data = await response.json()
      expect(data).toHaveProperty('error', 'Cannot create circular folder reference')
    })
  })

  describe('DELETE /api/folders/[id]', () => {
    it('should delete folder and all contents successfully', async () => {
      mockAuthenticatedUser()

      const dbMock = createFolderDbMock({
        folderLookupResult: mockFolder,
      })

      // Mock the recursive deletion function
      vi.doMock('@/db', () => dbMock)

      const req = createMockRequest('DELETE')
      const params = Promise.resolve({ id: 'folder-1' })

      const { DELETE } = await import('./route')

      const response = await DELETE(req, { params })

      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data).toHaveProperty('success', true)
      expect(data).toHaveProperty('deletedItems')
    })

    it('should return 401 for unauthenticated delete requests', async () => {
      mockUnauthenticated()

      const dbMock = createFolderDbMock()
      vi.doMock('@/db', () => dbMock)

      const req = createMockRequest('DELETE')
      const params = Promise.resolve({ id: 'folder-1' })

      const { DELETE } = await import('./route')

      const response = await DELETE(req, { params })

      expect(response.status).toBe(401)

      const data = await response.json()
      expect(data).toHaveProperty('error', 'Unauthorized')
    })

    it('should return 403 when user has only read permissions for delete', async () => {
      mockAuthenticatedUser()
      mockGetUserEntityPermissions.mockResolvedValue('read') // Read-only permissions

      const dbMock = createFolderDbMock()
      vi.doMock('@/db', () => dbMock)

      const req = createMockRequest('DELETE')
      const params = Promise.resolve({ id: 'folder-1' })

      const { DELETE } = await import('./route')

      const response = await DELETE(req, { params })

      expect(response.status).toBe(403)

      const data = await response.json()
      expect(data).toHaveProperty('error', 'Admin access required to delete folders')
    })

    it('should return 403 when user has only write permissions for delete', async () => {
      mockAuthenticatedUser()
      mockGetUserEntityPermissions.mockResolvedValue('write') // Write permissions (not enough for delete)

      const dbMock = createFolderDbMock()
      vi.doMock('@/db', () => dbMock)

      const req = createMockRequest('DELETE')
      const params = Promise.resolve({ id: 'folder-1' })

      const { DELETE } = await import('./route')

      const response = await DELETE(req, { params })

      expect(response.status).toBe(403)

      const data = await response.json()
      expect(data).toHaveProperty('error', 'Admin access required to delete folders')
    })

    it('should allow folder deletion for admin permissions', async () => {
      mockAuthenticatedUser()
      mockGetUserEntityPermissions.mockResolvedValue('admin') // Admin permissions

      const dbMock = createFolderDbMock({
        folderLookupResult: mockFolder,
      })
      vi.doMock('@/db', () => dbMock)

      const req = createMockRequest('DELETE')
      const params = Promise.resolve({ id: 'folder-1' })

      const { DELETE } = await import('./route')

      const response = await DELETE(req, { params })

      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data).toHaveProperty('success', true)
    })

    it('should handle database errors during deletion', async () => {
      mockAuthenticatedUser()

      const dbMock = createFolderDbMock({
        throwError: true,
      })
      vi.doMock('@/db', () => dbMock)

      const req = createMockRequest('DELETE')
      const params = Promise.resolve({ id: 'folder-1' })

      const { DELETE } = await import('./route')

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
