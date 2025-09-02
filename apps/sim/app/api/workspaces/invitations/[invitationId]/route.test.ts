import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockAuth, mockConsoleLogger } from '@/app/api/__test-utils__/utils'

/**
 * Tests for workspace invitation by ID API route
 * Tests GET (details + token acceptance), DELETE (cancellation)
 *
 * @vitest-environment node
 */

describe('Workspace Invitation [invitationId] API Route', () => {
  const mockUser = {
    id: 'user-123',
    email: 'test@example.com',
    name: 'Test User',
  }

  const mockWorkspace = {
    id: 'workspace-456',
    name: 'Test Workspace',
  }

  const mockInvitation = {
    id: 'invitation-789',
    workspaceId: 'workspace-456',
    email: 'invited@example.com',
    inviterId: 'inviter-321',
    status: 'pending',
    token: 'token-abc123',
    permissions: 'read',
    expiresAt: new Date(Date.now() + 86400000), // 1 day from now
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  let mockDbResults: any[] = []
  let mockGetSession: any
  let mockHasWorkspaceAdminAccess: any
  let mockTransaction: any

  beforeEach(async () => {
    vi.resetModules()
    vi.resetAllMocks()

    mockDbResults = []
    mockConsoleLogger()
    mockAuth(mockUser)

    vi.doMock('crypto', () => ({
      randomUUID: vi.fn().mockReturnValue('mock-uuid-1234'),
    }))

    mockGetSession = vi.fn()
    vi.doMock('@/lib/auth', () => ({
      getSession: mockGetSession,
    }))

    mockHasWorkspaceAdminAccess = vi.fn()
    vi.doMock('@/lib/permissions/utils', () => ({
      hasWorkspaceAdminAccess: mockHasWorkspaceAdminAccess,
    }))

    vi.doMock('@/lib/env', () => ({
      env: {
        NEXT_PUBLIC_APP_URL: 'https://test.sim.ai',
      },
    }))

    mockTransaction = vi.fn()
    const mockDbChain = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      then: vi.fn().mockImplementation((callback: any) => {
        const result = mockDbResults.shift() || []
        return callback ? callback(result) : Promise.resolve(result)
      }),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      transaction: mockTransaction,
    }

    vi.doMock('@/db', () => ({
      db: mockDbChain,
    }))

    vi.doMock('@/db/schema', () => ({
      workspaceInvitation: {
        id: 'id',
        workspaceId: 'workspaceId',
        email: 'email',
        inviterId: 'inviterId',
        status: 'status',
        token: 'token',
        permissions: 'permissions',
        expiresAt: 'expiresAt',
      },
      workspace: {
        id: 'id',
        name: 'name',
      },
      user: {
        id: 'id',
        email: 'email',
      },
      permissions: {
        id: 'id',
        entityType: 'entityType',
        entityId: 'entityId',
        userId: 'userId',
        permissionType: 'permissionType',
      },
    }))

    vi.doMock('drizzle-orm', () => ({
      eq: vi.fn((a, b) => ({ type: 'eq', a, b })),
      and: vi.fn((...args) => ({ type: 'and', args })),
    }))
  })

  describe('GET /api/workspaces/invitations/[invitationId]', () => {
    it('should return invitation details when called without token', async () => {
      const { GET } = await import('./route')

      mockGetSession.mockResolvedValue({ user: mockUser })

      mockDbResults.push([mockInvitation])
      mockDbResults.push([mockWorkspace])

      const request = new NextRequest('http://localhost/api/workspaces/invitations/invitation-789')
      const params = Promise.resolve({ invitationId: 'invitation-789' })

      const response = await GET(request, { params })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toMatchObject({
        id: 'invitation-789',
        email: 'invited@example.com',
        status: 'pending',
        workspaceName: 'Test Workspace',
      })
    })

    it('should redirect to login when unauthenticated with token', async () => {
      const { GET } = await import('./route')

      mockGetSession.mockResolvedValue(null)

      const request = new NextRequest(
        'http://localhost/api/workspaces/invitations/token-abc123?token=token-abc123'
      )
      const params = Promise.resolve({ invitationId: 'token-abc123' })

      const response = await GET(request, { params })

      expect(response.status).toBe(307)
      expect(response.headers.get('location')).toBe(
        'https://test.sim.ai/invite/token-abc123?token=token-abc123'
      )
    })

    it('should accept invitation when called with valid token', async () => {
      const { GET } = await import('./route')

      mockGetSession.mockResolvedValue({
        user: { ...mockUser, email: 'invited@example.com' },
      })

      mockDbResults.push([mockInvitation])
      mockDbResults.push([mockWorkspace])
      mockDbResults.push([{ ...mockUser, email: 'invited@example.com' }])
      mockDbResults.push([])

      mockTransaction.mockImplementation(async (callback: any) => {
        await callback({
          insert: vi.fn().mockReturnThis(),
          values: vi.fn().mockResolvedValue(undefined),
          update: vi.fn().mockReturnThis(),
          set: vi.fn().mockReturnThis(),
          where: vi.fn().mockResolvedValue(undefined),
        })
      })

      const request = new NextRequest(
        'http://localhost/api/workspaces/invitations/token-abc123?token=token-abc123'
      )
      const params = Promise.resolve({ invitationId: 'token-abc123' })

      const response = await GET(request, { params })

      expect(response.status).toBe(307)
      expect(response.headers.get('location')).toBe('https://test.sim.ai/workspace/workspace-456/w')
    })

    it('should redirect to error page when invitation expired', async () => {
      const { GET } = await import('./route')

      mockGetSession.mockResolvedValue({
        user: { ...mockUser, email: 'invited@example.com' },
      })

      const expiredInvitation = {
        ...mockInvitation,
        expiresAt: new Date(Date.now() - 86400000), // 1 day ago
      }

      mockDbResults.push([expiredInvitation])
      mockDbResults.push([mockWorkspace])

      const request = new NextRequest(
        'http://localhost/api/workspaces/invitations/token-abc123?token=token-abc123'
      )
      const params = Promise.resolve({ invitationId: 'token-abc123' })

      const response = await GET(request, { params })

      expect(response.status).toBe(307)
      expect(response.headers.get('location')).toBe(
        'https://test.sim.ai/invite/invitation-789?error=expired'
      )
    })

    it('should redirect to error page when email mismatch', async () => {
      const { GET } = await import('./route')

      mockGetSession.mockResolvedValue({
        user: { ...mockUser, email: 'wrong@example.com' },
      })

      mockDbResults.push([mockInvitation])
      mockDbResults.push([mockWorkspace])
      mockDbResults.push([{ ...mockUser, email: 'wrong@example.com' }])

      const request = new NextRequest(
        'http://localhost/api/workspaces/invitations/token-abc123?token=token-abc123'
      )
      const params = Promise.resolve({ invitationId: 'token-abc123' })

      const response = await GET(request, { params })

      expect(response.status).toBe(307)
      expect(response.headers.get('location')).toBe(
        'https://test.sim.ai/invite/invitation-789?error=email-mismatch'
      )
    })
  })

  describe('DELETE /api/workspaces/invitations/[invitationId]', () => {
    it('should return 401 when user is not authenticated', async () => {
      const { DELETE } = await import('./route')

      mockGetSession.mockResolvedValue(null)

      const request = new NextRequest(
        'http://localhost/api/workspaces/invitations/invitation-789',
        {
          method: 'DELETE',
        }
      )
      const params = Promise.resolve({ invitationId: 'invitation-789' })

      const response = await DELETE(request, { params })
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data).toEqual({ error: 'Unauthorized' })
    })

    it('should return 404 when invitation does not exist', async () => {
      const { DELETE } = await import('./route')

      mockGetSession.mockResolvedValue({ user: mockUser })

      mockDbResults.push([])

      const request = new NextRequest('http://localhost/api/workspaces/invitations/non-existent', {
        method: 'DELETE',
      })
      const params = Promise.resolve({ invitationId: 'non-existent' })

      const response = await DELETE(request, { params })
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data).toEqual({ error: 'Invitation not found' })
    })

    it('should return 403 when user lacks admin access', async () => {
      const { DELETE } = await import('./route')

      mockGetSession.mockResolvedValue({ user: mockUser })
      mockHasWorkspaceAdminAccess.mockResolvedValue(false)

      mockDbResults.push([mockInvitation])

      const request = new NextRequest(
        'http://localhost/api/workspaces/invitations/invitation-789',
        {
          method: 'DELETE',
        }
      )
      const params = Promise.resolve({ invitationId: 'invitation-789' })

      const response = await DELETE(request, { params })
      const data = await response.json()

      expect(response.status).toBe(403)
      expect(data).toEqual({ error: 'Insufficient permissions' })
      expect(mockHasWorkspaceAdminAccess).toHaveBeenCalledWith('user-123', 'workspace-456')
    })

    it('should return 400 when trying to delete non-pending invitation', async () => {
      const { DELETE } = await import('./route')

      mockGetSession.mockResolvedValue({ user: mockUser })
      mockHasWorkspaceAdminAccess.mockResolvedValue(true)

      const acceptedInvitation = { ...mockInvitation, status: 'accepted' }
      mockDbResults.push([acceptedInvitation])

      const request = new NextRequest(
        'http://localhost/api/workspaces/invitations/invitation-789',
        {
          method: 'DELETE',
        }
      )
      const params = Promise.resolve({ invitationId: 'invitation-789' })

      const response = await DELETE(request, { params })
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data).toEqual({ error: 'Can only delete pending invitations' })
    })

    it('should successfully delete pending invitation when user has admin access', async () => {
      const { DELETE } = await import('./route')

      mockGetSession.mockResolvedValue({ user: mockUser })
      mockHasWorkspaceAdminAccess.mockResolvedValue(true)

      mockDbResults.push([mockInvitation])

      const request = new NextRequest(
        'http://localhost/api/workspaces/invitations/invitation-789',
        {
          method: 'DELETE',
        }
      )
      const params = Promise.resolve({ invitationId: 'invitation-789' })

      const response = await DELETE(request, { params })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toEqual({ success: true })
    })

    it('should return 500 when database error occurs', async () => {
      vi.resetModules()

      const mockErrorDb = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        then: vi.fn().mockRejectedValue(new Error('Database connection failed')),
      }

      vi.doMock('@/db', () => ({ db: mockErrorDb }))
      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({ user: mockUser }),
      }))
      vi.doMock('@/lib/permissions/utils', () => ({
        hasWorkspaceAdminAccess: vi.fn(),
      }))
      vi.doMock('@/db/schema', () => ({
        workspaceInvitation: { id: 'id' },
      }))
      vi.doMock('drizzle-orm', () => ({
        eq: vi.fn(),
      }))

      const { DELETE } = await import('./route')

      const request = new NextRequest(
        'http://localhost/api/workspaces/invitations/invitation-789',
        {
          method: 'DELETE',
        }
      )
      const params = Promise.resolve({ invitationId: 'invitation-789' })

      const response = await DELETE(request, { params })
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data).toEqual({ error: 'Failed to delete invitation' })
    })
  })
})
