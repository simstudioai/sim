import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockRequest, mockAuth, mockConsoleLogger } from '@/app/api/__test-utils__/utils'

describe('Workspace Invitations API Route', () => {
  const mockWorkspace = { id: 'workspace-1', name: 'Test Workspace' }
  const mockUser = { id: 'user-1', email: 'test@example.com' }
  const mockInvitation = { id: 'invitation-1', status: 'pending' }

  let mockDbResults: any[] = []
  let mockGetSession: any
  let mockResendSend: any
  let mockInsertValues: any

  beforeEach(() => {
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

    mockInsertValues = vi.fn().mockResolvedValue(undefined)
    const mockDbChain = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      then: vi.fn().mockImplementation((callback: any) => {
        const result = mockDbResults.shift() || []
        return callback ? callback(result) : Promise.resolve(result)
      }),
      insert: vi.fn().mockReturnThis(),
      values: mockInsertValues,
    }

    vi.doMock('@/db', () => ({
      db: mockDbChain,
    }))

    vi.doMock('@/db/schema', () => ({
      user: { id: 'user_id', email: 'user_email', name: 'user_name', image: 'user_image' },
      workspace: { id: 'workspace_id', name: 'workspace_name', ownerId: 'owner_id' },
      permissions: {
        userId: 'user_id',
        entityId: 'entity_id',
        entityType: 'entity_type',
        permissionType: 'permission_type',
      },
      workspaceInvitation: {
        id: 'invitation_id',
        workspaceId: 'workspace_id',
        email: 'invitation_email',
        status: 'invitation_status',
        token: 'invitation_token',
        inviterId: 'inviter_id',
        role: 'invitation_role',
        permissions: 'invitation_permissions',
        expiresAt: 'expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
      permissionTypeEnum: { enumValues: ['admin', 'write', 'read'] as const },
    }))

    mockResendSend = vi.fn().mockResolvedValue({ id: 'email-id' })
    vi.doMock('resend', () => ({
      Resend: vi.fn().mockImplementation(() => ({
        emails: { send: mockResendSend },
      })),
    }))

    vi.doMock('@react-email/render', () => ({
      render: vi.fn().mockResolvedValue('<html>email content</html>'),
    }))

    vi.doMock('@/components/emails/workspace-invitation', () => ({
      WorkspaceInvitationEmail: vi.fn(),
    }))

    vi.doMock('@/lib/env', () => ({
      env: {
        RESEND_API_KEY: 'test-resend-key',
        NEXT_PUBLIC_APP_URL: 'https://test.simstudio.ai',
        EMAIL_DOMAIN: 'test.simstudio.ai',
      },
    }))

    vi.doMock('@/lib/urls/utils', () => ({
      getEmailDomain: vi.fn().mockReturnValue('simstudio.ai'),
    }))

    vi.doMock('drizzle-orm', () => ({
      and: vi.fn().mockImplementation((...args) => ({ type: 'and', conditions: args })),
      eq: vi.fn().mockImplementation((field, value) => ({ type: 'eq', field, value })),
      inArray: vi.fn().mockImplementation((field, values) => ({ type: 'inArray', field, values })),
    }))
  })

  describe('GET /api/workspaces/invitations', () => {
    it('should return 401 when user is not authenticated', async () => {
      mockGetSession.mockResolvedValue(null)

      const { GET } = await import('./route')
      const req = createMockRequest('GET')
      const response = await GET(req)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data).toEqual({ error: 'Unauthorized' })
    })

    it('should return empty invitations when user has no workspaces', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })
      mockDbResults = [[], []] // No workspaces, no invitations

      const { GET } = await import('./route')
      const req = createMockRequest('GET')
      const response = await GET(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toEqual({ invitations: [] })
    })

    it('should return invitations for user workspaces', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })
      const mockWorkspaces = [{ id: 'workspace-1' }, { id: 'workspace-2' }]
      const mockInvitations = [
        { id: 'invitation-1', workspaceId: 'workspace-1', email: 'test@example.com' },
        { id: 'invitation-2', workspaceId: 'workspace-2', email: 'test2@example.com' },
      ]
      mockDbResults = [mockWorkspaces, mockInvitations]

      const { GET } = await import('./route')
      const req = createMockRequest('GET')
      const response = await GET(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toEqual({ invitations: mockInvitations })
    })
  })

  describe('POST /api/workspaces/invitations', () => {
    it('should return 401 when user is not authenticated', async () => {
      mockGetSession.mockResolvedValue(null)

      const { POST } = await import('./route')
      const req = createMockRequest('POST', {
        workspaceId: 'workspace-1',
        email: 'test@example.com',
      })
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data).toEqual({ error: 'Unauthorized' })
    })

    it('should return 400 when workspaceId is missing', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })

      const { POST } = await import('./route')
      const req = createMockRequest('POST', { email: 'test@example.com' })
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data).toEqual({ error: 'Workspace ID and email are required' })
    })

    it('should return 400 when email is missing', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })

      const { POST } = await import('./route')
      const req = createMockRequest('POST', { workspaceId: 'workspace-1' })
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data).toEqual({ error: 'Workspace ID and email are required' })
    })

    it('should return 400 when permission type is invalid', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })

      const { POST } = await import('./route')
      const req = createMockRequest('POST', {
        workspaceId: 'workspace-1',
        email: 'test@example.com',
        permission: 'invalid-permission',
      })
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data).toEqual({
        error: 'Invalid permission: must be one of admin, write, read',
      })
    })

    it('should return 403 when user does not have admin permissions', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })
      mockDbResults = [[]] // No admin permissions found

      const { POST } = await import('./route')
      const req = createMockRequest('POST', {
        workspaceId: 'workspace-1',
        email: 'test@example.com',
      })
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(403)
      expect(data).toEqual({ error: 'You need admin permissions to invite users' })
    })

    it('should return 404 when workspace is not found', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })
      mockDbResults = [
        [{ permissionType: 'admin' }], // User has admin permissions
        [], // Workspace not found
      ]

      const { POST } = await import('./route')
      const req = createMockRequest('POST', {
        workspaceId: 'workspace-1',
        email: 'test@example.com',
      })
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data).toEqual({ error: 'Workspace not found' })
    })

    it('should return 400 when user already has workspace access', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })
      mockDbResults = [
        [{ permissionType: 'admin' }], // User has admin permissions
        [mockWorkspace], // Workspace exists
        [mockUser], // User exists
        [{ permissionType: 'read' }], // User already has access
      ]

      const { POST } = await import('./route')
      const req = createMockRequest('POST', {
        workspaceId: 'workspace-1',
        email: 'test@example.com',
      })
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data).toEqual({
        error: 'test@example.com already has access to this workspace',
        email: 'test@example.com',
      })
    })

    it('should return 400 when invitation already exists', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })
      mockDbResults = [
        [{ permissionType: 'admin' }], // User has admin permissions
        [mockWorkspace], // Workspace exists
        [], // User doesn't exist
        [mockInvitation], // Invitation exists
      ]

      const { POST } = await import('./route')
      const req = createMockRequest('POST', {
        workspaceId: 'workspace-1',
        email: 'test@example.com',
      })
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data).toEqual({
        error: 'test@example.com has already been invited to this workspace',
        email: 'test@example.com',
      })
    })

    it('should successfully create invitation and send email', async () => {
      mockGetSession.mockResolvedValue({
        user: { id: 'user-123', name: 'Test User', email: 'sender@example.com' },
      })
      mockDbResults = [
        [{ permissionType: 'admin' }], // User has admin permissions
        [mockWorkspace], // Workspace exists
        [], // User doesn't exist
        [], // No existing invitation
      ]

      const { POST } = await import('./route')
      const req = createMockRequest('POST', {
        workspaceId: 'workspace-1',
        email: 'test@example.com',
        permission: 'read',
      })
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.invitation).toBeDefined()
      expect(data.invitation.email).toBe('test@example.com')
      expect(data.invitation.permissions).toBe('read')
      expect(data.invitation.token).toBe('mock-uuid-1234')
      expect(mockInsertValues).toHaveBeenCalled()
    })
  })
})
