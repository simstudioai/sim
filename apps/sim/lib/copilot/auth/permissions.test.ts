/**
 * @vitest-environment node
 */
import { permissionsMock, permissionsMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetActiveWorkflowContext } = vi.hoisted(() => ({
  mockGetActiveWorkflowContext: vi.fn(),
}))

const mockGetUserEntityPermissions = permissionsMockFns.mockGetUserEntityPermissions

vi.mock('@sim/workflow-authz', () => ({
  getActiveWorkflowContext: mockGetActiveWorkflowContext,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

import { createPermissionError, verifyWorkflowAccess } from '@/lib/copilot/auth/permissions'

describe('Copilot Auth Permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockGetActiveWorkflowContext.mockResolvedValue(null)
  })

  describe('verifyWorkflowAccess', () => {
    it('should return no access for non-existent workflow', async () => {
      mockGetActiveWorkflowContext.mockResolvedValueOnce(null)

      const result = await verifyWorkflowAccess('user-123', 'non-existent-workflow')

      expect(result).toEqual({
        hasAccess: false,
        userPermission: null,
      })
    })

    it('should check workspace permissions for workflow with workspace', async () => {
      mockGetActiveWorkflowContext.mockResolvedValueOnce({
        workflow: {},
        workspaceId: 'workspace-456',
      })
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
      mockGetActiveWorkflowContext.mockResolvedValueOnce({
        workflow: {},
        workspaceId: 'workspace-456',
      })
      mockGetUserEntityPermissions.mockResolvedValueOnce('read')

      const result = await verifyWorkflowAccess('user-123', 'workflow-789')

      expect(result).toEqual({
        hasAccess: true,
        userPermission: 'read',
        workspaceId: 'workspace-456',
      })
    })

    it('should return admin permission through workspace', async () => {
      mockGetActiveWorkflowContext.mockResolvedValueOnce({
        workflow: {},
        workspaceId: 'workspace-456',
      })
      mockGetUserEntityPermissions.mockResolvedValueOnce('admin')

      const result = await verifyWorkflowAccess('user-123', 'workflow-789')

      expect(result).toEqual({
        hasAccess: true,
        userPermission: 'admin',
        workspaceId: 'workspace-456',
      })
    })

    it('should return no access without workspace permissions', async () => {
      mockGetActiveWorkflowContext.mockResolvedValueOnce({
        workflow: {},
        workspaceId: 'workspace-456',
      })
      mockGetUserEntityPermissions.mockResolvedValueOnce(null)

      const result = await verifyWorkflowAccess('user-123', 'workflow-789')

      expect(result).toEqual({
        hasAccess: false,
        userPermission: null,
        workspaceId: 'workspace-456',
      })
    })

    it('should return no access for workflow without workspace', async () => {
      mockGetActiveWorkflowContext.mockResolvedValueOnce(null)

      const result = await verifyWorkflowAccess('user-123', 'workflow-789')

      expect(result).toEqual({
        hasAccess: false,
        userPermission: null,
      })
    })

    it('should handle database errors gracefully', async () => {
      mockGetActiveWorkflowContext.mockRejectedValueOnce(new Error('Database connection failed'))

      const result = await verifyWorkflowAccess('user-123', 'workflow-789')

      expect(result).toEqual({
        hasAccess: false,
        userPermission: null,
      })
    })

    it('should handle permission check errors gracefully', async () => {
      mockGetActiveWorkflowContext.mockResolvedValueOnce({
        workflow: {},
        workspaceId: 'workspace-456',
      })
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
