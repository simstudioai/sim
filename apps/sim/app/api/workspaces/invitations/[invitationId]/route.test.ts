import { createSession, createWorkspaceRecord, loggerMock } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Tests for workspace invitation by ID API route
 * Tests GET (details + token acceptance), DELETE (cancellation)
 *
 * @vitest-environment node
 */

const mockGetSession = vi.fn()
const mockHasWorkspaceAdminAccess = vi.fn()

let dbSelectResults: any[] = []
let dbSelectCallIndex = 0

const mockDbSelect = vi.fn().mockImplementation(() => ({
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  then: vi.fn().mockImplementation((callback: (rows: any[]) => any) => {
    const result = dbSelectResults[dbSelectCallIndex] || []
    dbSelectCallIndex++
    return Promise.resolve(callback ? callback(result) : result)
  }),
}))

const mockDbInsert = vi.fn().mockImplementation(() => ({
  values: vi.fn().mockResolvedValue(undefined),
}))

const mockDbUpdate = vi.fn().mockImplementation(() => ({
  set: vi.fn().mockReturnThis(),
  where: vi.fn().mockResolvedValue(undefined),
}))

const mockDbDelete = vi.fn().mockImplementation(() => ({
  where: vi.fn().mockResolvedValue(undefined),
}))

const mockDbTransaction = vi.fn().mockImplementation(async (callback: any) => {
  await callback({
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  })
})

vi.mock('@/lib/auth', () => ({
  getSession: () => mockGetSession(),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  hasWorkspaceAdminAccess: (userId: string, workspaceId: string) =>
    mockHasWorkspaceAdminAccess(userId, workspaceId),
}))

vi.mock('@sim/logger', () => loggerMock)

vi.mock('@/lib/core/utils/urls', () => ({
  getBaseUrl: vi.fn().mockReturnValue('https://test.sim.ai'),
}))

vi.mock('@sim/db', () => ({
  db: {
    select: () => mockDbSelect(),
    insert: (table: any) => mockDbInsert(table),
    update: (table: any) => mockDbUpdate(table),
    delete: (table: any) => mockDbDelete(table),
    transaction: (callback: any) => mockDbTransaction(callback),
  },
}))

vi.mock('@sim/db/schema', () => ({
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

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a, b) => ({ type: 'eq', a, b })),
  and: vi.fn((...args) => ({ type: 'and', args })),
}))

vi.mock('crypto', () => ({
  randomUUID: vi.fn().mockReturnValue('mock-uuid-1234'),
}))

import { DELETE, GET } from './route'

const mockUser = {
  id: 'user-123',
  email: 'test@example.com',
  name: 'Test User',
}

const mockWorkspaceData = createWorkspaceRecord({
  id: 'workspace-456',
  name: 'Test Workspace',
})

const mockWorkspace = {
  id: mockWorkspaceData.id,
  name: mockWorkspaceData.name,
}

const mockInvitation = {
  id: 'invitation-789',
  workspaceId: 'workspace-456',
  email: 'invited@example.com',
  inviterId: 'inviter-321',
  status: 'pending',
  token: 'token-abc123',
  permissions: 'read',
  expiresAt: new Date(Date.now() + 86400000),
  createdAt: new Date(),
  updatedAt: new Date(),
}

describe('Workspace Invitation [invitationId] API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbSelectResults = []
    dbSelectCallIndex = 0
  })

  describe('GET /api/workspaces/invitations/[invitationId]', () => {
    it('should return invitation details when called without token', async () => {
      const session = createSession({ userId: mockUser.id, email: mockUser.email })
      mockGetSession.mockResolvedValue(session)
      dbSelectResults = [[mockInvitation], [mockWorkspace]]

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

    it('should return 401 when unauthenticated without token', async () => {
      mockGetSession.mockResolvedValue(null)

      const request = new NextRequest('http://localhost/api/workspaces/invitations/invitation-789')
      const params = Promise.resolve({ invitationId: 'invitation-789' })

      const response = await GET(request, { params })
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data).toEqual({ error: 'Unauthorized' })
    })

    it('should accept invitation when called with valid token', async () => {
      const session = createSession({
        userId: mockUser.id,
        email: 'invited@example.com',
        name: mockUser.name,
      })
      mockGetSession.mockResolvedValue(session)

      dbSelectResults = [
        [mockInvitation],
        [mockWorkspace],
        [{ ...mockUser, email: 'invited@example.com' }],
        [],
      ]

      const request = new NextRequest(
        'http://localhost/api/workspaces/invitations/token-abc123?token=token-abc123'
      )
      const params = Promise.resolve({ invitationId: 'token-abc123' })

      const response = await GET(request, { params })

      expect(response.status).toBe(307)
      expect(response.headers.get('location')).toBe('https://test.sim.ai/workspace/workspace-456/w')
    })

    it('should redirect to error page when invitation expired', async () => {
      const session = createSession({
        userId: mockUser.id,
        email: 'invited@example.com',
        name: mockUser.name,
      })
      mockGetSession.mockResolvedValue(session)

      const expiredInvitation = {
        ...mockInvitation,
        expiresAt: new Date(Date.now() - 86400000),
      }

      dbSelectResults = [[expiredInvitation], [mockWorkspace]]

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
      const session = createSession({
        userId: mockUser.id,
        email: 'wrong@example.com',
        name: mockUser.name,
      })
      mockGetSession.mockResolvedValue(session)

      dbSelectResults = [
        [mockInvitation],
        [mockWorkspace],
        [{ ...mockUser, email: 'wrong@example.com' }],
      ]

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

    it('should return 404 when invitation not found', async () => {
      const session = createSession({ userId: mockUser.id, email: mockUser.email })
      mockGetSession.mockResolvedValue(session)
      dbSelectResults = [[]]

      const request = new NextRequest('http://localhost/api/workspaces/invitations/non-existent')
      const params = Promise.resolve({ invitationId: 'non-existent' })

      const response = await GET(request, { params })
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data).toEqual({ error: 'Invitation not found or has expired' })
    })
  })

  describe('DELETE /api/workspaces/invitations/[invitationId]', () => {
    it('should return 401 when user is not authenticated', async () => {
      mockGetSession.mockResolvedValue(null)

      const request = new NextRequest(
        'http://localhost/api/workspaces/invitations/invitation-789',
        { method: 'DELETE' }
      )
      const params = Promise.resolve({ invitationId: 'invitation-789' })

      const response = await DELETE(request, { params })
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data).toEqual({ error: 'Unauthorized' })
    })

    it('should return 404 when invitation does not exist', async () => {
      const session = createSession({ userId: mockUser.id, email: mockUser.email })
      mockGetSession.mockResolvedValue(session)
      dbSelectResults = [[]]

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
      const session = createSession({ userId: mockUser.id, email: mockUser.email })
      mockGetSession.mockResolvedValue(session)
      mockHasWorkspaceAdminAccess.mockResolvedValue(false)
      dbSelectResults = [[mockInvitation]]

      const request = new NextRequest(
        'http://localhost/api/workspaces/invitations/invitation-789',
        { method: 'DELETE' }
      )
      const params = Promise.resolve({ invitationId: 'invitation-789' })

      const response = await DELETE(request, { params })
      const data = await response.json()

      expect(response.status).toBe(403)
      expect(data).toEqual({ error: 'Insufficient permissions' })
      expect(mockHasWorkspaceAdminAccess).toHaveBeenCalledWith('user-123', 'workspace-456')
    })

    it('should return 400 when trying to delete non-pending invitation', async () => {
      const session = createSession({ userId: mockUser.id, email: mockUser.email })
      mockGetSession.mockResolvedValue(session)
      mockHasWorkspaceAdminAccess.mockResolvedValue(true)

      const acceptedInvitation = { ...mockInvitation, status: 'accepted' }
      dbSelectResults = [[acceptedInvitation]]

      const request = new NextRequest(
        'http://localhost/api/workspaces/invitations/invitation-789',
        { method: 'DELETE' }
      )
      const params = Promise.resolve({ invitationId: 'invitation-789' })

      const response = await DELETE(request, { params })
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data).toEqual({ error: 'Can only delete pending invitations' })
    })

    it('should successfully delete pending invitation when user has admin access', async () => {
      const session = createSession({ userId: mockUser.id, email: mockUser.email })
      mockGetSession.mockResolvedValue(session)
      mockHasWorkspaceAdminAccess.mockResolvedValue(true)
      dbSelectResults = [[mockInvitation]]

      const request = new NextRequest(
        'http://localhost/api/workspaces/invitations/invitation-789',
        { method: 'DELETE' }
      )
      const params = Promise.resolve({ invitationId: 'invitation-789' })

      const response = await DELETE(request, { params })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toEqual({ success: true })
    })
  })
})
