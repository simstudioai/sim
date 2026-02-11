/**
 * Tests for workflow utility functions including permission validation.
 *
 * Tests cover:
 * - validateWorkflowPermissions for different user roles
 * - Owner vs workspace member access
 * - Read/write/admin action permissions
 */

import {
  createSession,
  createWorkflowRecord,
  createWorkspaceRecord,
  databaseMock,
  expectWorkflowAccessDenied,
  expectWorkflowAccessGranted,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db', () => databaseMock)

// Mock the auth module
vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(),
}))

import { db } from '@sim/db'
import { getSession } from '@/lib/auth'
// Import after mocks are set up
import { validateWorkflowPermissions } from '@/lib/workflows/utils'

describe('validateWorkflowPermissions', () => {
  const mockSession = createSession({ userId: 'user-1', email: 'user1@test.com' })
  const mockWorkflow = createWorkflowRecord({
    id: 'wf-1',
    userId: 'owner-1',
    workspaceId: 'ws-1',
  })
  const mockWorkspace = createWorkspaceRecord({
    id: 'ws-1',
    ownerId: 'workspace-owner',
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('authentication', () => {
    it('should return 401 when no session exists', async () => {
      vi.mocked(getSession).mockResolvedValue(null)

      const result = await validateWorkflowPermissions('wf-1', 'req-1', 'read')

      expectWorkflowAccessDenied(result, 401)
      expect(result.error?.message).toBe('Unauthorized')
    })

    it('should return 401 when session has no user id', async () => {
      vi.mocked(getSession).mockResolvedValue({ user: {} } as any)

      const result = await validateWorkflowPermissions('wf-1', 'req-1', 'read')

      expectWorkflowAccessDenied(result, 401)
    })
  })

  describe('workflow not found', () => {
    it('should return 404 when workflow does not exist', async () => {
      vi.mocked(getSession).mockResolvedValue(mockSession as any)

      // Mock workflow query to return empty
      const mockLimit = vi.fn().mockResolvedValue([])
      const mockWhere = vi.fn(() => ({ limit: mockLimit }))
      const mockFrom = vi.fn(() => ({ where: mockWhere }))
      vi.mocked(db.select).mockReturnValue({ from: mockFrom } as any)

      const result = await validateWorkflowPermissions('non-existent', 'req-1', 'read')

      expectWorkflowAccessDenied(result, 404)
      expect(result.error?.message).toBe('Workflow not found')
    })
  })

  describe('owner access', () => {
    it('should deny access to workflow owner without workspace permissions for read action', async () => {
      const ownerSession = createSession({ userId: 'owner-1' })
      vi.mocked(getSession).mockResolvedValue(ownerSession as any)

      // Mock workflow query
      const mockLimit = vi.fn().mockResolvedValue([mockWorkflow])
      const mockWhere = vi.fn(() => ({ limit: mockLimit }))
      const mockFrom = vi.fn(() => ({ where: mockWhere }))
      vi.mocked(db.select).mockReturnValue({ from: mockFrom } as any)

      const result = await validateWorkflowPermissions('wf-1', 'req-1', 'read')

      expectWorkflowAccessDenied(result, 403)
    })

    it('should deny access to workflow owner without workspace permissions for write action', async () => {
      const ownerSession = createSession({ userId: 'owner-1' })
      vi.mocked(getSession).mockResolvedValue(ownerSession as any)

      const mockLimit = vi.fn().mockResolvedValue([mockWorkflow])
      const mockWhere = vi.fn(() => ({ limit: mockLimit }))
      const mockFrom = vi.fn(() => ({ where: mockWhere }))
      vi.mocked(db.select).mockReturnValue({ from: mockFrom } as any)

      const result = await validateWorkflowPermissions('wf-1', 'req-1', 'write')

      expectWorkflowAccessDenied(result, 403)
    })

    it('should deny access to workflow owner without workspace permissions for admin action', async () => {
      const ownerSession = createSession({ userId: 'owner-1' })
      vi.mocked(getSession).mockResolvedValue(ownerSession as any)

      const mockLimit = vi.fn().mockResolvedValue([mockWorkflow])
      const mockWhere = vi.fn(() => ({ limit: mockLimit }))
      const mockFrom = vi.fn(() => ({ where: mockWhere }))
      vi.mocked(db.select).mockReturnValue({ from: mockFrom } as any)

      const result = await validateWorkflowPermissions('wf-1', 'req-1', 'admin')

      expectWorkflowAccessDenied(result, 403)
    })
  })

  describe('workspace member access with permissions', () => {
    beforeEach(() => {
      vi.mocked(getSession).mockResolvedValue(mockSession as any)
    })

    it('should grant read access to user with read permission', async () => {
      // First call: workflow query, second call: workspace owner, third call: permission
      let callCount = 0
      const mockLimit = vi.fn().mockImplementation(() => {
        callCount++
        if (callCount === 1) return Promise.resolve([mockWorkflow])
        return Promise.resolve([{ permissionType: 'read' }])
      })
      const mockWhere = vi.fn(() => ({ limit: mockLimit }))
      const mockFrom = vi.fn(() => ({ where: mockWhere }))
      vi.mocked(db.select).mockReturnValue({ from: mockFrom } as any)

      const result = await validateWorkflowPermissions('wf-1', 'req-1', 'read')

      expectWorkflowAccessGranted(result)
    })

    it('should deny write access to user with only read permission', async () => {
      let callCount = 0
      const mockLimit = vi.fn().mockImplementation(() => {
        callCount++
        if (callCount === 1) return Promise.resolve([mockWorkflow])
        return Promise.resolve([{ permissionType: 'read' }])
      })
      const mockWhere = vi.fn(() => ({ limit: mockLimit }))
      const mockFrom = vi.fn(() => ({ where: mockWhere }))
      vi.mocked(db.select).mockReturnValue({ from: mockFrom } as any)

      const result = await validateWorkflowPermissions('wf-1', 'req-1', 'write')

      expectWorkflowAccessDenied(result, 403)
      expect(result.error?.message).toContain('write')
    })

    it('should grant write access to user with write permission', async () => {
      let callCount = 0
      const mockLimit = vi.fn().mockImplementation(() => {
        callCount++
        if (callCount === 1) return Promise.resolve([mockWorkflow])
        return Promise.resolve([{ permissionType: 'write' }])
      })
      const mockWhere = vi.fn(() => ({ limit: mockLimit }))
      const mockFrom = vi.fn(() => ({ where: mockWhere }))
      vi.mocked(db.select).mockReturnValue({ from: mockFrom } as any)

      const result = await validateWorkflowPermissions('wf-1', 'req-1', 'write')

      expectWorkflowAccessGranted(result)
    })

    it('should grant write access to user with admin permission', async () => {
      let callCount = 0
      const mockLimit = vi.fn().mockImplementation(() => {
        callCount++
        if (callCount === 1) return Promise.resolve([mockWorkflow])
        return Promise.resolve([{ permissionType: 'admin' }])
      })
      const mockWhere = vi.fn(() => ({ limit: mockLimit }))
      const mockFrom = vi.fn(() => ({ where: mockWhere }))
      vi.mocked(db.select).mockReturnValue({ from: mockFrom } as any)

      const result = await validateWorkflowPermissions('wf-1', 'req-1', 'write')

      expectWorkflowAccessGranted(result)
    })

    it('should deny admin access to user with only write permission', async () => {
      let callCount = 0
      const mockLimit = vi.fn().mockImplementation(() => {
        callCount++
        if (callCount === 1) return Promise.resolve([mockWorkflow])
        return Promise.resolve([{ permissionType: 'write' }])
      })
      const mockWhere = vi.fn(() => ({ limit: mockLimit }))
      const mockFrom = vi.fn(() => ({ where: mockWhere }))
      vi.mocked(db.select).mockReturnValue({ from: mockFrom } as any)

      const result = await validateWorkflowPermissions('wf-1', 'req-1', 'admin')

      expectWorkflowAccessDenied(result, 403)
      expect(result.error?.message).toContain('admin')
    })

    it('should grant admin access to user with admin permission', async () => {
      let callCount = 0
      const mockLimit = vi.fn().mockImplementation(() => {
        callCount++
        if (callCount === 1) return Promise.resolve([mockWorkflow])
        return Promise.resolve([{ permissionType: 'admin' }])
      })
      const mockWhere = vi.fn(() => ({ limit: mockLimit }))
      const mockFrom = vi.fn(() => ({ where: mockWhere }))
      vi.mocked(db.select).mockReturnValue({ from: mockFrom } as any)

      const result = await validateWorkflowPermissions('wf-1', 'req-1', 'admin')

      expectWorkflowAccessGranted(result)
    })
  })

  describe('no workspace permission', () => {
    it('should deny access to user without any workspace permission', async () => {
      vi.mocked(getSession).mockResolvedValue(mockSession as any)

      let callCount = 0
      const mockLimit = vi.fn().mockImplementation(() => {
        callCount++
        if (callCount === 1) return Promise.resolve([mockWorkflow])
        return Promise.resolve([]) // No permission record
      })
      const mockWhere = vi.fn(() => ({ limit: mockLimit }))
      const mockFrom = vi.fn(() => ({ where: mockWhere }))
      vi.mocked(db.select).mockReturnValue({ from: mockFrom } as any)

      const result = await validateWorkflowPermissions('wf-1', 'req-1', 'read')

      expectWorkflowAccessDenied(result, 403)
    })
  })

  describe('workflow without workspace', () => {
    it('should deny access to non-owner for workflow without workspace', async () => {
      const workflowWithoutWorkspace = createWorkflowRecord({
        id: 'wf-2',
        userId: 'other-user',
        workspaceId: null,
      })

      vi.mocked(getSession).mockResolvedValue(mockSession as any)

      const mockLimit = vi.fn().mockResolvedValue([workflowWithoutWorkspace])
      const mockWhere = vi.fn(() => ({ limit: mockLimit }))
      const mockFrom = vi.fn(() => ({ where: mockWhere }))
      vi.mocked(db.select).mockReturnValue({ from: mockFrom } as any)

      const result = await validateWorkflowPermissions('wf-2', 'req-1', 'read')

      expectWorkflowAccessDenied(result, 403)
    })

    it('should deny access to owner for workflow without workspace', async () => {
      const workflowWithoutWorkspace = createWorkflowRecord({
        id: 'wf-2',
        userId: 'user-1',
        workspaceId: null,
      })

      vi.mocked(getSession).mockResolvedValue(mockSession as any)

      const mockLimit = vi.fn().mockResolvedValue([workflowWithoutWorkspace])
      const mockWhere = vi.fn(() => ({ limit: mockLimit }))
      const mockFrom = vi.fn(() => ({ where: mockWhere }))
      vi.mocked(db.select).mockReturnValue({ from: mockFrom } as any)

      const result = await validateWorkflowPermissions('wf-2', 'req-1', 'read')

      expectWorkflowAccessDenied(result, 403)
    })
  })

  describe('default action', () => {
    it('should default to read action when not specified', async () => {
      vi.mocked(getSession).mockResolvedValue(mockSession as any)

      let callCount = 0
      const mockLimit = vi.fn().mockImplementation(() => {
        callCount++
        if (callCount === 1) return Promise.resolve([mockWorkflow])
        return Promise.resolve([{ permissionType: 'read' }])
      })
      const mockWhere = vi.fn(() => ({ limit: mockLimit }))
      const mockFrom = vi.fn(() => ({ where: mockWhere }))
      vi.mocked(db.select).mockReturnValue({ from: mockFrom } as any)

      const result = await validateWorkflowPermissions('wf-1', 'req-1')

      expectWorkflowAccessGranted(result)
    })
  })
})
