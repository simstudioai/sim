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
  databaseMock,
  expectWorkflowAccessDenied,
  expectWorkflowAccessGranted,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

import { validateWorkflowPermissions } from '@/lib/workflows/utils'

const mockDb = databaseMock.db

const mockSession = createSession({ userId: 'user-1', email: 'user1@test.com' })
const mockWorkflow = createWorkflowRecord({
  id: 'wf-1',
  userId: 'owner-1',
  workspaceId: 'ws-1',
})

describe('validateWorkflowPermissions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('authentication', () => {
    it('should return 401 when no session exists', async () => {
      mockGetSession.mockResolvedValue(null)

      const result = await validateWorkflowPermissions('wf-1', 'req-1', 'read')

      expectWorkflowAccessDenied(result, 401)
      expect(result.error?.message).toBe('Unauthorized')
    })

    it('should return 401 when session has no user id', async () => {
      mockGetSession.mockResolvedValue({ user: {} })

      const result = await validateWorkflowPermissions('wf-1', 'req-1', 'read')

      expectWorkflowAccessDenied(result, 401)
    })
  })

  describe('workflow not found', () => {
    it('should return 404 when workflow does not exist', async () => {
      mockGetSession.mockResolvedValue(mockSession)

      const mockLimit = vi.fn().mockResolvedValue([])
      const mockWhere = vi.fn(() => ({ limit: mockLimit }))
      const mockFrom = vi.fn(() => ({ where: mockWhere }))
      vi.mocked(mockDb.select).mockReturnValue({ from: mockFrom } as any)

      const result = await validateWorkflowPermissions('non-existent', 'req-1', 'read')

      expectWorkflowAccessDenied(result, 404)
      expect(result.error?.message).toBe('Workflow not found')
    })
  })

  describe('owner access', () => {
    it('should deny access to workflow owner without workspace permissions for read action', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'owner-1', email: 'owner-1@test.com' } })

      const mockLimit = vi.fn().mockResolvedValue([mockWorkflow])
      const mockWhere = vi.fn(() => ({ limit: mockLimit }))
      const mockFrom = vi.fn(() => ({ where: mockWhere }))
      vi.mocked(mockDb.select).mockReturnValue({ from: mockFrom } as any)

      const result = await validateWorkflowPermissions('wf-1', 'req-1', 'read')

      expectWorkflowAccessDenied(result, 403)
    })

    it('should deny access to workflow owner without workspace permissions for write action', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'owner-1', email: 'owner-1@test.com' } })

      const mockLimit = vi.fn().mockResolvedValue([mockWorkflow])
      const mockWhere = vi.fn(() => ({ limit: mockLimit }))
      const mockFrom = vi.fn(() => ({ where: mockWhere }))
      vi.mocked(mockDb.select).mockReturnValue({ from: mockFrom } as any)

      const result = await validateWorkflowPermissions('wf-1', 'req-1', 'write')

      expectWorkflowAccessDenied(result, 403)
    })

    it('should deny access to workflow owner without workspace permissions for admin action', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'owner-1', email: 'owner-1@test.com' } })

      const mockLimit = vi.fn().mockResolvedValue([mockWorkflow])
      const mockWhere = vi.fn(() => ({ limit: mockLimit }))
      const mockFrom = vi.fn(() => ({ where: mockWhere }))
      vi.mocked(mockDb.select).mockReturnValue({ from: mockFrom } as any)

      const result = await validateWorkflowPermissions('wf-1', 'req-1', 'admin')

      expectWorkflowAccessDenied(result, 403)
    })
  })

  describe('workspace member access with permissions', () => {
    beforeEach(() => {
      mockGetSession.mockResolvedValue(mockSession)
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

      const result = await validateWorkflowPermissions('wf-1', 'req-1', 'admin')

      expectWorkflowAccessGranted(result)
    })
  })

  describe('no workspace permission', () => {
    it('should deny access to user without any workspace permission', async () => {
      mockGetSession.mockResolvedValue(mockSession)

      let callCount = 0
      const mockLimit = vi.fn().mockImplementation(() => {
        callCount++
        if (callCount === 1) return Promise.resolve([mockWorkflow])
        return Promise.resolve([])
      })
      const mockWhere = vi.fn(() => ({ limit: mockLimit }))
      const mockFrom = vi.fn(() => ({ where: mockWhere }))
      vi.mocked(mockDb.select).mockReturnValue({ from: mockFrom } as any)

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

      mockGetSession.mockResolvedValue(mockSession)

      const mockLimit = vi.fn().mockResolvedValue([workflowWithoutWorkspace])
      const mockWhere = vi.fn(() => ({ limit: mockLimit }))
      const mockFrom = vi.fn(() => ({ where: mockWhere }))
      vi.mocked(mockDb.select).mockReturnValue({ from: mockFrom } as any)

      const result = await validateWorkflowPermissions('wf-2', 'req-1', 'read')

      expectWorkflowAccessDenied(result, 403)
    })

    it('should deny access to owner for workflow without workspace', async () => {
      const workflowWithoutWorkspace = createWorkflowRecord({
        id: 'wf-2',
        userId: 'user-1',
        workspaceId: null,
      })

      mockGetSession.mockResolvedValue(mockSession)

      const mockLimit = vi.fn().mockResolvedValue([workflowWithoutWorkspace])
      const mockWhere = vi.fn(() => ({ limit: mockLimit }))
      const mockFrom = vi.fn(() => ({ where: mockWhere }))
      vi.mocked(mockDb.select).mockReturnValue({ from: mockFrom } as any)

      const result = await validateWorkflowPermissions('wf-2', 'req-1', 'read')

      expectWorkflowAccessDenied(result, 403)
    })
  })

  describe('default action', () => {
    it('should default to read action when not specified', async () => {
      mockGetSession.mockResolvedValue(mockSession)

      let callCount = 0
      const mockLimit = vi.fn().mockImplementation(() => {
        callCount++
        if (callCount === 1) return Promise.resolve([mockWorkflow])
        return Promise.resolve([{ permissionType: 'read' }])
      })
      const mockWhere = vi.fn(() => ({ limit: mockLimit }))
      const mockFrom = vi.fn(() => ({ where: mockWhere }))
      vi.mocked(mockDb.select).mockReturnValue({ from: mockFrom } as any)

      const result = await validateWorkflowPermissions('wf-1', 'req-1')

      expectWorkflowAccessGranted(result)
    })
  })
})
