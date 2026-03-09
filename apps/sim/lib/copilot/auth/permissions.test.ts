/**
 * @vitest-environment node
 */
import { drizzleOrmMock, loggerMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSelect, mockFrom, mockWhere, mockLimit, mockGetUserEntityPermissions } = vi.hoisted(
  () => ({
    mockSelect: vi.fn(),
    mockFrom: vi.fn(),
    mockWhere: vi.fn(),
    mockLimit: vi.fn(),
    mockGetUserEntityPermissions: vi.fn(),
  })
)

vi.mock('@sim/db', () => ({
  db: {
    select: mockSelect,
  },
}))

vi.mock('@sim/db/schema', () => ({
  workflow: {
    id: 'id',
    workspaceId: 'workspaceId',
  },
}))

vi.mock('drizzle-orm', () => drizzleOrmMock)
vi.mock('@sim/logger', () => loggerMock)

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getUserEntityPermissions: mockGetUserEntityPermissions,
}))

import { createPermissionError, verifyWorkflowAccess } from '@/lib/copilot/auth/permissions'

describe('Copilot Auth Permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockSelect.mockReturnValue({ from: mockFrom })
    mockFrom.mockReturnValue({ where: mockWhere })
    mockWhere.mockReturnValue({ limit: mockLimit })
    mockLimit.mockResolvedValue([])
  })

  describe('verifyWorkflowAccess', () => {
    it('should return no access for non-existent workflow', async () => {
      mockLimit.mockResolvedValueOnce([])

      const result = await verifyWorkflowAccess('user-123', 'non-existent-workflow')

      expect(result).toEqual({
        hasAccess: false,
        userPermission: null,
      })
    })

    it('should check workspace permissions for workflow with workspace', async () => {
      const workflowData = {
        workspaceId: 'workspace-456',
      }
      mockLimit.mockResolvedValueOnce([workflowData])
      mockGetUserEntityPermissions.mockResolvedValueOnce('write')

      const result = await verifyWorkflowAccess('user-123', 'workflow-789')

      expect(result).toEqual({
        hasAccess: true,
        userPermission: 'write',
        workspaceId: 'workspace-456',
      })

      expect(mockGetUserEntityPermissions).toHaveBeenCalledWith(
        'user-123',
        'workspace',
        'workspace-456'
      )
    })

    it('should return read permission through workspace', async () => {
      const workflowData = {
        workspaceId: 'workspace-456',
      }
      mockLimit.mockResolvedValueOnce([workflowData])
      mockGetUserEntityPermissions.mockResolvedValueOnce('read')

      const result = await verifyWorkflowAccess('user-123', 'workflow-789')

      expect(result).toEqual({
        hasAccess: true,
        userPermission: 'read',
        workspaceId: 'workspace-456',
      })
    })

    it('should return admin permission through workspace', async () => {
      const workflowData = {
        workspaceId: 'workspace-456',
      }
      mockLimit.mockResolvedValueOnce([workflowData])
      mockGetUserEntityPermissions.mockResolvedValueOnce('admin')

      const result = await verifyWorkflowAccess('user-123', 'workflow-789')

      expect(result).toEqual({
        hasAccess: true,
        userPermission: 'admin',
        workspaceId: 'workspace-456',
      })
    })

    it('should return no access without workspace permissions', async () => {
      const workflowData = {
        workspaceId: 'workspace-456',
      }
      mockLimit.mockResolvedValueOnce([workflowData])
      mockGetUserEntityPermissions.mockResolvedValueOnce(null)

      const result = await verifyWorkflowAccess('user-123', 'workflow-789')

      expect(result).toEqual({
        hasAccess: false,
        userPermission: null,
        workspaceId: 'workspace-456',
      })
    })

    it('should return no access for workflow without workspace', async () => {
      const workflowData = {
        workspaceId: null,
      }
      mockLimit.mockResolvedValueOnce([workflowData])

      const result = await verifyWorkflowAccess('user-123', 'workflow-789')

      expect(result).toEqual({
        hasAccess: false,
        userPermission: null,
        workspaceId: undefined,
      })
    })

    it('should handle database errors gracefully', async () => {
      mockLimit.mockRejectedValueOnce(new Error('Database connection failed'))

      const result = await verifyWorkflowAccess('user-123', 'workflow-789')

      expect(result).toEqual({
        hasAccess: false,
        userPermission: null,
      })
    })

    it('should handle permission check errors gracefully', async () => {
      const workflowData = {
        userId: 'other-user',
        workspaceId: 'workspace-456',
      }
      mockLimit.mockResolvedValueOnce([workflowData])
      mockGetUserEntityPermissions.mockRejectedValueOnce(new Error('Permission check failed'))

      const result = await verifyWorkflowAccess('user-123', 'workflow-789')

      expect(result).toEqual({
        hasAccess: false,
        userPermission: null,
      })
    })
  })

  describe('createPermissionError', () => {
    it('should create a permission error message for edit operation', () => {
      const result = createPermissionError('edit')
      expect(result).toBe('Access denied: You do not have permission to edit this workflow')
    })

    it('should create a permission error message for view operation', () => {
      const result = createPermissionError('view')
      expect(result).toBe('Access denied: You do not have permission to view this workflow')
    })

    it('should create a permission error message for delete operation', () => {
      const result = createPermissionError('delete')
      expect(result).toBe('Access denied: You do not have permission to delete this workflow')
    })

    it('should create a permission error message for deploy operation', () => {
      const result = createPermissionError('deploy')
      expect(result).toBe('Access denied: You do not have permission to deploy this workflow')
    })

    it('should create a permission error message for custom operation', () => {
      const result = createPermissionError('modify settings of')
      expect(result).toBe(
        'Access denied: You do not have permission to modify settings of this workflow'
      )
    })
  })
})
