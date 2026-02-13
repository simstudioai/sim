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
  mockAuth,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockDb = databaseMock.db

describe('validateWorkflowPermissions', () => {
  const auth = mockAuth()

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
    vi.resetModules()
    vi.clearAllMocks()

    vi.doMock('@sim/db', () => databaseMock)
  })

  describe('authentication', () => {
    it('should return 401 when no session exists', async () => {
      auth.setUnauthenticated()

      const { validateWorkflowPermissions } = await import('@/lib/workflows/utils')
      const result = await validateWorkflowPermissions('wf-1', 'req-1', 'read')

      expectWorkflowAccessDenied(result, 401)
      expect(result.error?.message).toBe('Unauthorized')
    })

    it('should return 401 when session has no user id', async () => {
      auth.mockGetSession.mockResolvedValue({ user: {} } as any)

      const { validateWorkflowPermissions } = await import('@/lib/workflows/utils')
      const result = await validateWorkflowPermissions('wf-1', 'req-1', 'read')

      expectWorkflowAccessDenied(result, 401)
    })
  })

  describe('workflow not found', () => {
    it('should return 404 when workflow does not exist', async () => {
      auth.mockGetSession.mockResolvedValue(mockSession as any)

      const mockLimit = vi.fn().mockResolvedValue([])
      const mockWhere = vi.fn(() => ({ limit: mockLimit }))
      const mockFrom = vi.fn(() => ({ where: mockWhere }))
      vi.mocked(mockDb.select).mockReturnValue({ from: mockFrom } as any)

      const { validateWorkflowPermissions } = await import('@/lib/workflows/utils')
      const result = await validateWorkflowPermissions('non-existent', 'req-1', 'read')

      expectWorkflowAccessDenied(result, 404)
      expect(result.error?.message).toBe('Workflow not found')
    })
  })

  describe('owner access', () => {
    it('should deny access to workflow owner without workspace permissions for read action', async () => {
      auth.setAuthenticated({ id: 'owner-1', email: 'owner-1@test.com' })

      const mockLimit = vi.fn().mockResolvedValue([mockWorkflow])
      const mockWhere = vi.fn(() => ({ limit: mockLimit }))
      const mockFrom = vi.fn(() => ({ where: mockWhere }))
      vi.mocked(mockDb.select).mockReturnValue({ from: mockFrom } as any)

      const { validateWorkflowPermissions } = await import('@/lib/workflows/utils')
      const result = await validateWorkflowPermissions('wf-1', 'req-1', 'read')

      expectWorkflowAccessDenied(result, 403)
    })

    it('should deny access to workflow owner without workspace permissions for write action', async () => {
      auth.setAuthenticated({ id: 'owner-1', email: 'owner-1@test.com' })

      const mockLimit = vi.fn().mockResolvedValue([mockWorkflow])
      const mockWhere = vi.fn(() => ({ limit: mockLimit }))
      const mockFrom = vi.fn(() => ({ where: mockWhere }))
      vi.mocked(mockDb.select).mockReturnValue({ from: mockFrom } as any)

      const { validateWorkflowPermissions } = await import('@/lib/workflows/utils')
      const result = await validateWorkflowPermissions('wf-1', 'req-1', 'write')

      expectWorkflowAccessDenied(result, 403)
    })

    it('should deny access to workflow owner without workspace permissions for admin action', async () => {
      auth.setAuthenticated({ id: 'owner-1', email: 'owner-1@test.com' })

      const mockLimit = vi.fn().mockResolvedValue([mockWorkflow])
      const mockWhere = vi.fn(() => ({ limit: mockLimit }))
      const mockFrom = vi.fn(() => ({ where: mockWhere }))
      vi.mocked(mockDb.select).mockReturnValue({ from: mockFrom } as any)

      const { validateWorkflowPermissions } = await import('@/lib/workflows/utils')
      const result = await validateWorkflowPermissions('wf-1', 'req-1', 'admin')

      expectWorkflowAccessDenied(result, 403)
    })
  })

  describe('workspace member access with permissions', () => {
    beforeEach(() => {
      auth.mockGetSession.mockResolvedValue(mockSession as any)
    })

    it('should grant read access to user with read permission', async () => {
      let callCount = 0
      const mockLimit = vi.fn().mockImplementation(() => {
        callCount++
        if (callCount === 1) return Promise.resolve([mockWorkflow])
        return Promise.resolve([{ permissionType: 'read' }])
      })
      const mockWhere = vi.fn(() => ({ limit: mockLimit }))
      const mockFrom = vi.fn(() => ({ where: mockWhere }))
      vi.mocked(mockDb.select).mockReturnValue({ from: mockFrom } as any)

      const { validateWorkflowPermissions } = await import('@/lib/workflows/utils')
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
      vi.mocked(mockDb.select).mockReturnValue({ from: mockFrom } as any)

      const { validateWorkflowPermissions } = await import('@/lib/workflows/utils')
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
      vi.mocked(mockDb.select).mockReturnValue({ from: mockFrom } as any)

      const { validateWorkflowPermissions } = await import('@/lib/workflows/utils')
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
      vi.mocked(mockDb.select).mockReturnValue({ from: mockFrom } as any)

      const { validateWorkflowPermissions } = await import('@/lib/workflows/utils')
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
      vi.mocked(mockDb.select).mockReturnValue({ from: mockFrom } as any)

      const { validateWorkflowPermissions } = await import('@/lib/workflows/utils')
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
      vi.mocked(mockDb.select).mockReturnValue({ from: mockFrom } as any)

      const { validateWorkflowPermissions } = await import('@/lib/workflows/utils')
      const result = await validateWorkflowPermissions('wf-1', 'req-1', 'admin')

      expectWorkflowAccessGranted(result)
    })
  })

  describe('no workspace permission', () => {
    it('should deny access to user without any workspace permission', async () => {
      auth.mockGetSession.mockResolvedValue(mockSession as any)

      let callCount = 0
      const mockLimit = vi.fn().mockImplementation(() => {
        callCount++
        if (callCount === 1) return Promise.resolve([mockWorkflow])
        return Promise.resolve([])
      })
      const mockWhere = vi.fn(() => ({ limit: mockLimit }))
      const mockFrom = vi.fn(() => ({ where: mockWhere }))
      vi.mocked(mockDb.select).mockReturnValue({ from: mockFrom } as any)

      const { validateWorkflowPermissions } = await import('@/lib/workflows/utils')
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

      auth.mockGetSession.mockResolvedValue(mockSession as any)

      const mockLimit = vi.fn().mockResolvedValue([workflowWithoutWorkspace])
      const mockWhere = vi.fn(() => ({ limit: mockLimit }))
      const mockFrom = vi.fn(() => ({ where: mockWhere }))
      vi.mocked(mockDb.select).mockReturnValue({ from: mockFrom } as any)

      const { validateWorkflowPermissions } = await import('@/lib/workflows/utils')
      const result = await validateWorkflowPermissions('wf-2', 'req-1', 'read')

      expectWorkflowAccessDenied(result, 403)
    })

    it('should deny access to owner for workflow without workspace', async () => {
      const workflowWithoutWorkspace = createWorkflowRecord({
        id: 'wf-2',
        userId: 'user-1',
        workspaceId: null,
      })

      auth.mockGetSession.mockResolvedValue(mockSession as any)

      const mockLimit = vi.fn().mockResolvedValue([workflowWithoutWorkspace])
      const mockWhere = vi.fn(() => ({ limit: mockLimit }))
      const mockFrom = vi.fn(() => ({ where: mockWhere }))
      vi.mocked(mockDb.select).mockReturnValue({ from: mockFrom } as any)

      const { validateWorkflowPermissions } = await import('@/lib/workflows/utils')
      const result = await validateWorkflowPermissions('wf-2', 'req-1', 'read')

      expectWorkflowAccessDenied(result, 403)
    })
  })

  describe('default action', () => {
    it('should default to read action when not specified', async () => {
      auth.mockGetSession.mockResolvedValue(mockSession as any)

      let callCount = 0
      const mockLimit = vi.fn().mockImplementation(() => {
        callCount++
        if (callCount === 1) return Promise.resolve([mockWorkflow])
        return Promise.resolve([{ permissionType: 'read' }])
      })
      const mockWhere = vi.fn(() => ({ limit: mockLimit }))
      const mockFrom = vi.fn(() => ({ where: mockWhere }))
      vi.mocked(mockDb.select).mockReturnValue({ from: mockFrom } as any)

      const { validateWorkflowPermissions } = await import('@/lib/workflows/utils')
      const result = await validateWorkflowPermissions('wf-1', 'req-1')

      expectWorkflowAccessGranted(result)
    })
  })
})
