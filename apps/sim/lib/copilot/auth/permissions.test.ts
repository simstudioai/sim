/**
 * Tests for copilot auth permissions module
 *
 * @vitest-environment node
 */
import { drizzleOrmMock, loggerMock } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('Copilot Auth Permissions', () => {
  const mockSelect = vi.fn()
  const mockFrom = vi.fn()
  const mockWhere = vi.fn()
  const mockLimit = vi.fn()

  beforeEach(() => {
    vi.resetModules()

    mockSelect.mockReturnValue({ from: mockFrom })
    mockFrom.mockReturnValue({ where: mockWhere })
    mockWhere.mockReturnValue({ limit: mockLimit })
    mockLimit.mockResolvedValue([])

    vi.doMock('@sim/db', () => ({
      db: {
        select: mockSelect,
      },
    }))

    vi.doMock('@sim/db/schema', () => ({
      workflow: {
        id: 'id',
        userId: 'userId',
        workspaceId: 'workspaceId',
      },
    }))

    vi.doMock('drizzle-orm', () => drizzleOrmMock)

    vi.doMock('@sim/logger', () => loggerMock)

    vi.doMock('@/lib/workspaces/permissions/utils', () => ({
      getUserEntityPermissions: vi.fn(),
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  describe('verifyWorkflowAccess', () => {
    it('should return no access for non-existent workflow', async () => {
      mockLimit.mockResolvedValueOnce([])

      const { verifyWorkflowAccess } = await import('@/lib/copilot/auth/permissions')
      const result = await verifyWorkflowAccess('user-123', 'non-existent-workflow')

      expect(result).toEqual({
        hasAccess: false,
        userPermission: null,
        isOwner: false,
      })
    })

    it('should return admin access for workflow owner', async () => {
      const workflowData = {
        userId: 'user-123',
        workspaceId: 'workspace-456',
      }
      mockLimit.mockResolvedValueOnce([workflowData])

      const { verifyWorkflowAccess } = await import('@/lib/copilot/auth/permissions')
      const result = await verifyWorkflowAccess('user-123', 'workflow-789')

      expect(result).toEqual({
        hasAccess: true,
        userPermission: 'admin',
        workspaceId: 'workspace-456',
        isOwner: true,
      })
    })

    it('should return admin access for workflow owner without workspace', async () => {
      const workflowData = {
        userId: 'user-123',
        workspaceId: null,
      }
      mockLimit.mockResolvedValueOnce([workflowData])

      const { verifyWorkflowAccess } = await import('@/lib/copilot/auth/permissions')
      const result = await verifyWorkflowAccess('user-123', 'workflow-789')

      expect(result).toEqual({
        hasAccess: true,
        userPermission: 'admin',
        workspaceId: undefined,
        isOwner: true,
      })
    })

    it('should check workspace permissions for non-owner with workspace', async () => {
      const workflowData = {
        userId: 'other-user',
        workspaceId: 'workspace-456',
      }
      mockLimit.mockResolvedValueOnce([workflowData])

      const { getUserEntityPermissions } = await import('@/lib/workspaces/permissions/utils')
      vi.mocked(getUserEntityPermissions).mockResolvedValueOnce('write')

      const { verifyWorkflowAccess } = await import('@/lib/copilot/auth/permissions')
      const result = await verifyWorkflowAccess('user-123', 'workflow-789')

      expect(result).toEqual({
        hasAccess: true,
        userPermission: 'write',
        workspaceId: 'workspace-456',
        isOwner: false,
      })

      expect(getUserEntityPermissions).toHaveBeenCalledWith(
        'user-123',
        'workspace',
        'workspace-456'
      )
    })

    it('should return read permission through workspace', async () => {
      const workflowData = {
        userId: 'other-user',
        workspaceId: 'workspace-456',
      }
      mockLimit.mockResolvedValueOnce([workflowData])

      const { getUserEntityPermissions } = await import('@/lib/workspaces/permissions/utils')
      vi.mocked(getUserEntityPermissions).mockResolvedValueOnce('read')

      const { verifyWorkflowAccess } = await import('@/lib/copilot/auth/permissions')
      const result = await verifyWorkflowAccess('user-123', 'workflow-789')

      expect(result).toEqual({
        hasAccess: true,
        userPermission: 'read',
        workspaceId: 'workspace-456',
        isOwner: false,
      })
    })

    it('should return admin permission through workspace', async () => {
      const workflowData = {
        userId: 'other-user',
        workspaceId: 'workspace-456',
      }
      mockLimit.mockResolvedValueOnce([workflowData])

      const { getUserEntityPermissions } = await import('@/lib/workspaces/permissions/utils')
      vi.mocked(getUserEntityPermissions).mockResolvedValueOnce('admin')

      const { verifyWorkflowAccess } = await import('@/lib/copilot/auth/permissions')
      const result = await verifyWorkflowAccess('user-123', 'workflow-789')

      expect(result).toEqual({
        hasAccess: true,
        userPermission: 'admin',
        workspaceId: 'workspace-456',
        isOwner: false,
      })
    })

    it('should return no access for non-owner without workspace permissions', async () => {
      const workflowData = {
        userId: 'other-user',
        workspaceId: 'workspace-456',
      }
      mockLimit.mockResolvedValueOnce([workflowData])

      const { getUserEntityPermissions } = await import('@/lib/workspaces/permissions/utils')
      vi.mocked(getUserEntityPermissions).mockResolvedValueOnce(null)

      const { verifyWorkflowAccess } = await import('@/lib/copilot/auth/permissions')
      const result = await verifyWorkflowAccess('user-123', 'workflow-789')

      expect(result).toEqual({
        hasAccess: false,
        userPermission: null,
        workspaceId: 'workspace-456',
        isOwner: false,
      })
    })

    it('should return no access for non-owner of workflow without workspace', async () => {
      const workflowData = {
        userId: 'other-user',
        workspaceId: null,
      }
      mockLimit.mockResolvedValueOnce([workflowData])

      const { verifyWorkflowAccess } = await import('@/lib/copilot/auth/permissions')
      const result = await verifyWorkflowAccess('user-123', 'workflow-789')

      expect(result).toEqual({
        hasAccess: false,
        userPermission: null,
        workspaceId: undefined,
        isOwner: false,
      })
    })

    it('should handle database errors gracefully', async () => {
      mockLimit.mockRejectedValueOnce(new Error('Database connection failed'))

      const { verifyWorkflowAccess } = await import('@/lib/copilot/auth/permissions')
      const result = await verifyWorkflowAccess('user-123', 'workflow-789')

      expect(result).toEqual({
        hasAccess: false,
        userPermission: null,
        isOwner: false,
      })
    })

    it('should handle permission check errors gracefully', async () => {
      const workflowData = {
        userId: 'other-user',
        workspaceId: 'workspace-456',
      }
      mockLimit.mockResolvedValueOnce([workflowData])

      const { getUserEntityPermissions } = await import('@/lib/workspaces/permissions/utils')
      vi.mocked(getUserEntityPermissions).mockRejectedValueOnce(
        new Error('Permission check failed')
      )

      const { verifyWorkflowAccess } = await import('@/lib/copilot/auth/permissions')
      const result = await verifyWorkflowAccess('user-123', 'workflow-789')

      expect(result).toEqual({
        hasAccess: false,
        userPermission: null,
        isOwner: false,
      })
    })
  })

  describe('createPermissionError', () => {
    it('should create a permission error message for edit operation', async () => {
      const { createPermissionError } = await import('@/lib/copilot/auth/permissions')
      const result = createPermissionError('edit')

      expect(result).toBe('Access denied: You do not have permission to edit this workflow')
    })

    it('should create a permission error message for view operation', async () => {
      const { createPermissionError } = await import('@/lib/copilot/auth/permissions')
      const result = createPermissionError('view')

      expect(result).toBe('Access denied: You do not have permission to view this workflow')
    })

    it('should create a permission error message for delete operation', async () => {
      const { createPermissionError } = await import('@/lib/copilot/auth/permissions')
      const result = createPermissionError('delete')

      expect(result).toBe('Access denied: You do not have permission to delete this workflow')
    })

    it('should create a permission error message for deploy operation', async () => {
      const { createPermissionError } = await import('@/lib/copilot/auth/permissions')
      const result = createPermissionError('deploy')

      expect(result).toBe('Access denied: You do not have permission to deploy this workflow')
    })

    it('should create a permission error message for custom operation', async () => {
      const { createPermissionError } = await import('@/lib/copilot/auth/permissions')
      const result = createPermissionError('modify settings of')

      expect(result).toBe(
        'Access denied: You do not have permission to modify settings of this workflow'
      )
    })
  })
})
