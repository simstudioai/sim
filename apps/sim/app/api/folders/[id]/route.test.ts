/**
 * Tests for individual folder API route (/api/folders/[id])
 *
 * @vitest-environment node
 */
import {
  auditMock,
  authMockFns,
  createMockRequest,
  type MockUser,
  permissionsMock,
  permissionsMockFns,
  workflowsOrchestrationMock,
  workflowsOrchestrationMockFns,
  workflowsUtilsMock,
  workflowsUtilsMockFns,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockLogger, mockDbRef } = vi.hoisted(() => {
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
    mockDbRef: { current: null as any },
  }
})

const mockPerformDeleteFolder = workflowsOrchestrationMockFns.mockPerformDeleteFolder
const mockPerformUpdateFolder = workflowsOrchestrationMockFns.mockPerformUpdateFolder

const mockGetUserEntityPermissions = permissionsMockFns.mockGetUserEntityPermissions

vi.mock('@sim/audit', () => auditMock)
vi.mock('@sim/logger', () => ({
  createLogger: vi.fn().mockReturnValue(mockLogger),
  runWithRequestContext: <T>(_ctx: unknown, fn: () => T): T => fn(),
  getRequestContext: () => undefined,
}))
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@sim/db', () => ({
  get db() {
    return mockDbRef.current
  },
}))
vi.mock('@/lib/workflows/orchestration', () => workflowsOrchestrationMock)
vi.mock('@/lib/workflows/utils', () => workflowsUtilsMock)

import { DELETE, PUT } from '@/app/api/folders/[id]/route'

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
  authMockFns.mockGetSession.mockResolvedValue({ user: user || TEST_USER })
}

function mockUnauthenticated() {
  authMockFns.mockGetSession.mockResolvedValue(null)
}

describe('Individual Folder API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockGetUserEntityPermissions.mockResolvedValue('admin')
    mockDbRef.current = createFolderDbMock()
    mockPerformDeleteFolder.mockResolvedValue({
      success: true,
      deletedItems: { folders: 1, workflows: 0 },
    })
    mockPerformUpdateFolder.mockImplementation(async (params) => {
      if (params.parentId && params.parentId === params.folderId) {
        return {
          success: false,
          error: 'Folder cannot be its own parent',
          errorCode: 'validation',
        }
      }
      if (
        params.parentId &&
        (await workflowsUtilsMockFns.mockCheckForCircularReference(
          params.folderId,
          params.parentId
        ))
      ) {
        return {
          success: false,
          error: 'Cannot create circular folder reference',
          errorCode: 'validation',
        }
      }
      return {
        success: true,
        folder: {
          ...mockFolder,
          id: params.folderId,
          name: params.name !== undefined ? params.name.trim() : 'Updated Folder',
          color: params.color ?? mockFolder.color,
          parentId: params.parentId ?? mockFolder.parentId,
          isExpanded: params.isExpanded,
          sortOrder: params.sortOrder ?? mockFolder.sortOrder,
          updatedAt: new Date(),
        },
      }
    })
    workflowsUtilsMockFns.mockCheckForCircularReference.mockResolvedValue(false)
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
        name: 'Updated Folder Name',
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

      const req = createMockRequest('PUT', {
        name: '  Folder With Spaces  ',
      })
      const params = Promise.resolve({ id: 'folder-1' })

      const response = await PUT(req, { params })
      const data = await response.json()

      expect(data.folder.name).toBe('Folder With Spaces')
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

      mockDbRef.current = createFolderDbMock({
        folderLookupResult: {
          id: 'folder-3',
          parentId: null,
          name: 'Folder 3',
          workspaceId: 'workspace-123',
        },
      })

      workflowsUtilsMockFns.mockCheckForCircularReference.mockResolvedValue(true)

      const req = createMockRequest('PUT', {
        name: 'Updated Folder 3',
        parentId: 'folder-1',
      })
      const params = Promise.resolve({ id: 'folder-3' })

      const response = await PUT(req, { params })

      expect(response.status).toBe(400)

      const data = await response.json()
      expect(data).toHaveProperty('error', 'Cannot create circular folder reference')
      expect(workflowsUtilsMockFns.mockCheckForCircularReference).toHaveBeenCalledWith(
        'folder-3',
        'folder-1'
      )
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
      expect(mockPerformDeleteFolder).toHaveBeenCalledWith({
        folderId: 'folder-1',
        workspaceId: 'workspace-123',
        userId: TEST_USER.id,
        folderName: 'Test Folder',
      })
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
      expect(mockPerformDeleteFolder).toHaveBeenCalled()
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
