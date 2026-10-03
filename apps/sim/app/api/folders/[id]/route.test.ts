/**
 * Tests for individual folder API route (/api/folders/[id])
 */
import {
  auditMock,
  authMockFns,
  createMockRequest,
  foldersOrchestrationMock,
  foldersOrchestrationMockFns,
  type MockUser,
  permissionsMock,
  permissionsMockFns,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mockDeleteFolder = foldersOrchestrationMockFns.mockDeleteFolder
const mockUpdateFolder = foldersOrchestrationMockFns.mockUpdateFolder

const mockGetUserEntityPermissions = permissionsMockFns.mockGetUserEntityPermissions

vi.mock('@sim/audit', () => auditMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/lib/folders/orchestration', () => foldersOrchestrationMock)

import { DELETE, PUT } from '@/app/api/folders/[id]/route'

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

/** Queues the folder-existence lookup the route runs before authorizing. */
function queueFolderLookup(folder: Record<string, unknown> = mockFolder) {
  queueTableRows(schemaMock.folder, [folder])
}

function mockAuthenticatedUser(user?: MockUser) {
  authMockFns.mockGetSession.mockResolvedValue({ user: user || TEST_USER })
}

describe('Individual Folder API Route', () => {
  afterAll(() => {
    resetDbChainMock()
  })

  beforeEach(() => {
    resetDbChainMock()

    mockGetUserEntityPermissions.mockResolvedValue('admin')
    mockDeleteFolder.mockResolvedValue({
      success: true,
      deletedItems: { folders: 1, workflows: 0 },
    })
  })

  describe('PUT /api/folders/[id]', () => {
    it('should return 403 when user has only read permissions', async () => {
      mockAuthenticatedUser()
      mockGetUserEntityPermissions.mockResolvedValue('read')

      queueFolderLookup()
      const req = createMockRequest('PUT', {
        name: 'Updated Folder',
      })
      const params = Promise.resolve({ id: 'folder-1' })

      const response = await PUT(req, { params })

      expect(response.status).toBe(403)

      const data = await response.json()
      expect(data).toHaveProperty('error', 'Write access required to update folders')
    })

    it('rejects a locked write on a resource type that has no lock semantics', async () => {
      mockAuthenticatedUser()
      queueFolderLookup()

      const req = createMockRequest(
        'PUT',
        { locked: true },
        {},
        'http://localhost:3000/api/folders/folder-1?resourceType=knowledge_base'
      )
      const params = Promise.resolve({ id: 'folder-1' })

      const response = await PUT(req, { params })

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.error).toBe('Folder locking is only supported for workflow folders')
      expect(mockUpdateFolder).not.toHaveBeenCalled()
    })
  })

  describe('DELETE /api/folders/[id]', () => {
    it('surfaces a delete-locked resource as 423, not a generic 500', async () => {
      mockAuthenticatedUser()
      queueFolderLookup()
      mockDeleteFolder.mockResolvedValueOnce({
        success: false,
        error: 'Cannot delete folder: table Ledger is delete-locked',
        errorCode: 'locked',
      })

      const req = createMockRequest('DELETE')
      const params = Promise.resolve({ id: 'folder-1' })

      const response = await DELETE(req, { params })

      expect(response.status).toBe(423)
      const data = await response.json()
      expect(data.error).toBe('Cannot delete folder: table Ledger is delete-locked')
    })
  })
})
