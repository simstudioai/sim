/**
 * Tests for workflow utility functions including permission validation.
 *
 * Tests cover:
 * - validateWorkflowPermissions for different user roles
 * - Owner vs workspace member access
 * - Read/write/admin action permissions
 */

import {
  authMockFns,
  createSession,
  createWorkflowRecord,
  expectWorkflowAccessDenied,
  expectWorkflowAccessGranted,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAuthorizeWorkflow } = vi.hoisted(() => ({
  mockAuthorizeWorkflow: vi.fn(),
}))

vi.mock('@sim/workflow-authz', () => ({
  authorizeWorkflowByWorkspacePermission: mockAuthorizeWorkflow,
  getActiveWorkflowContext: vi.fn(),
  getActiveWorkflowRecord: vi.fn(),
  assertActiveWorkflowContext: vi.fn(),
}))

import { validateWorkflowPermissions } from '@/lib/workflows/utils'

const mockSession = createSession({ userId: 'user-1', email: 'user1@test.com' })
const mockWorkflow = createWorkflowRecord({
  id: 'wf-1',
  userId: 'owner-1',
  workspaceId: 'ws-1',
})

const allowed = (workspacePermission: 'read' | 'write' | 'admin') => ({
  allowed: true,
  status: 200,
  workflow: mockWorkflow,
  workspacePermission,
})

const denied = (status: number, message: string, workspacePermission: string | null = null) => ({
  allowed: false,
  status,
  message,
  workflow: mockWorkflow,
  workspacePermission,
})

describe('validateWorkflowPermissions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue(mockSession)
  })

  describe('authentication', () => {
    it('should return 401 when no session exists', async () => {
      authMockFns.mockGetSession.mockResolvedValue(null)

      const result = await validateWorkflowPermissions('wf-1', 'req-1', 'read')

      expectWorkflowAccessDenied(result, 401)
      expect(result.error?.message).toBe('Unauthorized')
    })

    it('should return 401 when session has no user id', async () => {
      authMockFns.mockGetSession.mockResolvedValue({ user: {} })

      const result = await validateWorkflowPermissions('wf-1', 'req-1', 'read')

      expectWorkflowAccessDenied(result, 401)
    })
  })

  describe('workflow not found', () => {
    it('should return 404 when workflow does not exist', async () => {
      mockAuthorizeWorkflow.mockResolvedValue({
        allowed: false,
        status: 404,
        message: 'Workflow not found',
        workflow: null,
        workspacePermission: null,
      })

      const result = await validateWorkflowPermissions('non-existent', 'req-1', 'read')

      expectWorkflowAccessDenied(result, 404)
      expect(result.error?.message).toBe('Workflow not found')
    })
  })

  describe('owner access', () => {
    it('should deny access to workflow owner without workspace permissions for read action', async () => {
      authMockFns.mockGetSession.mockResolvedValue({
        user: { id: 'owner-1', email: 'owner-1@test.com' },
      })
      mockAuthorizeWorkflow.mockResolvedValue(
        denied(403, 'Unauthorized: Access denied to read this workflow')
      )

      const result = await validateWorkflowPermissions('wf-1', 'req-1', 'read')
      expectWorkflowAccessDenied(result, 403)
    })

    it('should deny access to workflow owner without workspace permissions for write action', async () => {
      authMockFns.mockGetSession.mockResolvedValue({
        user: { id: 'owner-1', email: 'owner-1@test.com' },
      })
      mockAuthorizeWorkflow.mockResolvedValue(
        denied(403, 'Unauthorized: Access denied to write this workflow')
      )

      const result = await validateWorkflowPermissions('wf-1', 'req-1', 'write')
      expectWorkflowAccessDenied(result, 403)
    })

    it('should deny access to workflow owner without workspace permissions for admin action', async () => {
      authMockFns.mockGetSession.mockResolvedValue({
        user: { id: 'owner-1', email: 'owner-1@test.com' },
      })
      mockAuthorizeWorkflow.mockResolvedValue(
        denied(403, 'Unauthorized: Access denied to admin this workflow')
      )

      const result = await validateWorkflowPermissions('wf-1', 'req-1', 'admin')
      expectWorkflowAccessDenied(result, 403)
    })
  })

  describe('workspace member access with permissions', () => {
    it('should grant read access to user with read permission', async () => {
      mockAuthorizeWorkflow.mockResolvedValue(allowed('read'))

      const result = await validateWorkflowPermissions('wf-1', 'req-1', 'read')
      expectWorkflowAccessGranted(result)
    })

    it('should deny write access to user with only read permission', async () => {
      mockAuthorizeWorkflow.mockResolvedValue(
        denied(403, 'Unauthorized: Access denied to write this workflow', 'read')
      )

      const result = await validateWorkflowPermissions('wf-1', 'req-1', 'write')
      expectWorkflowAccessDenied(result, 403)
      expect(result.error?.message).toContain('write')
    })

    it('should grant write access to user with write permission', async () => {
      mockAuthorizeWorkflow.mockResolvedValue(allowed('write'))

      const result = await validateWorkflowPermissions('wf-1', 'req-1', 'write')
      expectWorkflowAccessGranted(result)
    })

    it('should grant write access to user with admin permission', async () => {
      mockAuthorizeWorkflow.mockResolvedValue(allowed('admin'))

      const result = await validateWorkflowPermissions('wf-1', 'req-1', 'write')
      expectWorkflowAccessGranted(result)
    })

    it('should deny admin access to user with only write permission', async () => {
      mockAuthorizeWorkflow.mockResolvedValue(
        denied(403, 'Unauthorized: Access denied to admin this workflow', 'write')
      )

      const result = await validateWorkflowPermissions('wf-1', 'req-1', 'admin')
      expectWorkflowAccessDenied(result, 403)
      expect(result.error?.message).toContain('admin')
    })

    it('should grant admin access to user with admin permission', async () => {
      mockAuthorizeWorkflow.mockResolvedValue(allowed('admin'))

      const result = await validateWorkflowPermissions('wf-1', 'req-1', 'admin')
      expectWorkflowAccessGranted(result)
    })
  })

  describe('no workspace permission', () => {
    it('should deny access to user without any workspace permission', async () => {
      mockAuthorizeWorkflow.mockResolvedValue(
        denied(403, 'Unauthorized: Access denied to read this workflow')
      )

      const result = await validateWorkflowPermissions('wf-1', 'req-1', 'read')
      expectWorkflowAccessDenied(result, 403)
    })
  })

  describe('workflow without workspace', () => {
    it('should deny access to non-owner for workflow without workspace', async () => {
      mockAuthorizeWorkflow.mockResolvedValue({
        allowed: false,
        status: 403,
        message:
          'This workflow is not attached to a workspace. Personal workflows are deprecated and cannot be accessed.',
        workflow: createWorkflowRecord({ id: 'wf-2', userId: 'other-user', workspaceId: null }),
        workspacePermission: null,
      })

      const result = await validateWorkflowPermissions('wf-2', 'req-1', 'read')
      expectWorkflowAccessDenied(result, 403)
    })

    it('should deny access to owner for workflow without workspace', async () => {
      mockAuthorizeWorkflow.mockResolvedValue({
        allowed: false,
        status: 403,
        message:
          'This workflow is not attached to a workspace. Personal workflows are deprecated and cannot be accessed.',
        workflow: createWorkflowRecord({ id: 'wf-2', userId: 'user-1', workspaceId: null }),
        workspacePermission: null,
      })

      const result = await validateWorkflowPermissions('wf-2', 'req-1', 'read')
      expectWorkflowAccessDenied(result, 403)
    })
  })

  describe('default action', () => {
    it('should default to read action when not specified', async () => {
      mockAuthorizeWorkflow.mockResolvedValue(allowed('read'))

      const result = await validateWorkflowPermissions('wf-1', 'req-1')
      expectWorkflowAccessGranted(result)
    })
  })
})
