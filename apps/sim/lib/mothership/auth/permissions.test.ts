import { workflowAuthzMockFns } from '@sim/testing'
import { afterAll, describe, expect, it } from 'vitest'

const { mockAuthorizeWorkflowByWorkspacePermission } = workflowAuthzMockFns

import { verifyWorkflowAccess } from '@/lib/mothership/auth/permissions'

afterAll(() => {
  mockAuthorizeWorkflowByWorkspacePermission.mockReset()
})

describe('Copilot Auth Permissions', () => {
  describe('verifyWorkflowAccess', () => {
    it('should return no access for non-existent workflow', async () => {
      mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
        allowed: false,
        status: 404,
        workflow: null,
        workspacePermission: null,
      })

      const result = await verifyWorkflowAccess('user-123', 'non-existent-workflow')

      expect(result).toEqual({ hasAccess: false, userPermission: null })
    })

    it('should delegate to the shared workflow authorizer with a read action', async () => {
      mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
        allowed: true,
        status: 200,
        workflow: { workspaceId: 'workspace-456' },
        workspacePermission: 'write',
      })

      await verifyWorkflowAccess('user-123', 'workflow-789')

      expect(mockAuthorizeWorkflowByWorkspacePermission).toHaveBeenCalledWith({
        workflowId: 'workflow-789',
        userId: 'user-123',
        action: 'read',
      })
    })

    it.each(['read', 'write', 'admin'] as const)(
      'should grant access with %s permission through the workspace',
      async (permission) => {
        mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
          allowed: true,
          status: 200,
          workflow: { workspaceId: 'workspace-456' },
          workspacePermission: permission,
        })

        const result = await verifyWorkflowAccess('user-123', 'workflow-789')

        expect(result).toEqual({
          hasAccess: true,
          userPermission: permission,
          workspaceId: 'workspace-456',
        })
      }
    )

    it('should report the workspaceId even when permission is denied for an existing workflow', async () => {
      mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
        allowed: false,
        status: 403,
        workflow: { workspaceId: 'workspace-456' },
        workspacePermission: null,
      })

      const result = await verifyWorkflowAccess('user-123', 'workflow-789')

      expect(result).toEqual({
        hasAccess: false,
        userPermission: null,
        workspaceId: 'workspace-456',
      })
    })

    it('should return no access for a workflow without a workspace', async () => {
      mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
        allowed: false,
        status: 403,
        workflow: { workspaceId: null },
        workspacePermission: null,
      })

      const result = await verifyWorkflowAccess('user-123', 'workflow-789')

      expect(result).toEqual({ hasAccess: false, userPermission: null })
    })

    it('should handle errors gracefully', async () => {
      mockAuthorizeWorkflowByWorkspacePermission.mockRejectedValueOnce(
        new Error('Database connection failed')
      )

      const result = await verifyWorkflowAccess('user-123', 'workflow-789')

      expect(result).toEqual({ hasAccess: false, userPermission: null })
    })
  })
})
