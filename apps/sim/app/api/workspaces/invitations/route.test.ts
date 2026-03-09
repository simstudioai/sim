/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetSession,
  mockInsertValues,
  mockDbResults,
  mockResendSend,
  mockDbChain,
  mockRender,
  mockWorkspaceInvitationEmail,
  mockGetEmailDomain,
  mockValidateInvitationsAllowed,
  mockRandomUUID,
} = vi.hoisted(() => {
  const mockGetSession = vi.fn()
  const mockInsertValues = vi.fn().mockResolvedValue(undefined)
  const mockResendSend = vi.fn().mockResolvedValue({ id: 'email-id' })
  const mockRender = vi.fn().mockResolvedValue('<html>email content</html>')
  const mockWorkspaceInvitationEmail = vi.fn()
  const mockGetEmailDomain = vi.fn().mockReturnValue('sim.ai')
  const mockValidateInvitationsAllowed = vi.fn().mockResolvedValue(undefined)
  const mockRandomUUID = vi.fn().mockReturnValue('mock-uuid-1234')

  const mockDbResults: { value: any[] } = { value: [] }

  const mockDbChain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    then: vi.fn().mockImplementation((callback: any) => {
      const result = mockDbResults.value.shift() || []
      return callback ? callback(result) : Promise.resolve(result)
    }),
    insert: vi.fn().mockReturnThis(),
    values: mockInsertValues,
  }

  return {
    mockGetSession,
    mockInsertValues,
    mockDbResults,
    mockResendSend,
    mockDbChain,
    mockRender,
    mockWorkspaceInvitationEmail,
    mockGetEmailDomain,
    mockValidateInvitationsAllowed,
    mockRandomUUID,
  }
})

vi.mock('crypto', () => ({
  randomUUID: mockRandomUUID,
}))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@sim/db', () => ({
  db: mockDbChain,
}))

vi.mock('@sim/db/schema', () => ({
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

vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: { send: mockResendSend },
  })),
}))

vi.mock('@react-email/render', () => ({
  render: mockRender,
}))

vi.mock('@/components/emails/workspace-invitation', () => ({
  WorkspaceInvitationEmail: mockWorkspaceInvitationEmail,
}))

vi.mock('@/lib/core/config/env', async () => {
  const { createEnvMock } = await import('@sim/testing')
  return createEnvMock()
})

vi.mock('@/lib/core/utils/urls', () => ({
  getEmailDomain: mockGetEmailDomain,
}))

vi.mock('@/lib/audit/log', async () => {
  const { auditMock } = await import('@sim/testing')
  return auditMock
})

vi.mock('@sim/logger', () => ({
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn().mockImplementation((...args: any[]) => ({ type: 'and', conditions: args })),
  eq: vi.fn().mockImplementation((field: any, value: any) => ({ type: 'eq', field, value })),
  inArray: vi
    .fn()
    .mockImplementation((field: any, values: any) => ({ type: 'inArray', field, values })),
}))

vi.mock('@/ee/access-control/utils/permission-check', () => ({
  validateInvitationsAllowed: mockValidateInvitationsAllowed,
  InvitationsNotAllowedError: class InvitationsNotAllowedError extends Error {
    constructor() {
      super('Invitations are not allowed based on your permission group settings')
      this.name = 'InvitationsNotAllowedError'
    }
  },
}))

import { GET, POST } from '@/app/api/workspaces/invitations/route'

describe('Workspace Invitations API Route', () => {
  const mockWorkspace = { id: 'workspace-1', name: 'Test Workspace' }
  const mockUser = { id: 'user-1', email: 'test@example.com' }
  const mockInvitation = { id: 'invitation-1', status: 'pending' }

  beforeEach(() => {
    vi.clearAllMocks()
    mockDbResults.value = []

    // Reset mockDbChain methods that need fresh returnThis behavior
    mockDbChain.select.mockReturnThis()
    mockDbChain.from.mockReturnThis()
    mockDbChain.where.mockReturnThis()
    mockDbChain.innerJoin.mockReturnThis()
    mockDbChain.limit.mockReturnThis()
    mockDbChain.insert.mockReturnThis()
    mockDbChain.then.mockImplementation((callback: any) => {
      const result = mockDbResults.value.shift() || []
      return callback ? callback(result) : Promise.resolve(result)
    })
    mockDbChain.values = mockInsertValues
    mockInsertValues.mockResolvedValue(undefined)
    mockResendSend.mockResolvedValue({ id: 'email-id' })
    mockRandomUUID.mockReturnValue('mock-uuid-1234')
    mockRender.mockResolvedValue('<html>email content</html>')
    mockGetEmailDomain.mockReturnValue('sim.ai')
    mockValidateInvitationsAllowed.mockResolvedValue(undefined)
  })

  describe('GET /api/workspaces/invitations', () => {
    it('should return 401 when user is not authenticated', async () => {
      mockGetSession.mockResolvedValue(null)

      const req = createMockRequest('GET')
      const response = await GET(req)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data).toEqual({ error: 'Unauthorized' })
    })

    it('should return empty invitations when user has no workspaces', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })
      mockDbResults.value = [[], []] // No workspaces, no invitations

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
      mockDbResults.value = [mockWorkspaces, mockInvitations]

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

      const req = createMockRequest('POST', { email: 'test@example.com' })
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data).toEqual({ error: 'Workspace ID and email are required' })
    })

    it('should return 400 when email is missing', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })

      const req = createMockRequest('POST', { workspaceId: 'workspace-1' })
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data).toEqual({ error: 'Workspace ID and email are required' })
    })

    it('should return 400 when permission type is invalid', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })

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
      mockDbResults.value = [[]] // No admin permissions found

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
      mockDbResults.value = [
        [{ permissionType: 'admin' }], // User has admin permissions
        [], // Workspace not found
      ]

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
      mockDbResults.value = [
        [{ permissionType: 'admin' }], // User has admin permissions
        [mockWorkspace], // Workspace exists
        [mockUser], // User exists
        [{ permissionType: 'read' }], // User already has access
      ]

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
      mockDbResults.value = [
        [{ permissionType: 'admin' }], // User has admin permissions
        [mockWorkspace], // Workspace exists
        [], // User doesn't exist
        [mockInvitation], // Invitation exists
      ]

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
      mockDbResults.value = [
        [{ permissionType: 'admin' }], // User has admin permissions
        [mockWorkspace], // Workspace exists
        [], // User doesn't exist
        [], // No existing invitation
      ]

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
