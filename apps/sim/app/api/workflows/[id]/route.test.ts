/**
 * Integration tests for workflow by ID API route
 * Tests the new centralized permissions system
 *
 * @vitest-environment node
 */

import { auditMock, loggerMock, setupGlobalFetchMock } from '@sim/testing'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetSession = vi.fn()
const mockLoadWorkflowFromNormalizedTables = vi.fn()
const mockGetWorkflowById = vi.fn()
const mockAuthorizeWorkflowByWorkspacePermission = vi.fn()
const mockDbDelete = vi.fn()
const mockDbUpdate = vi.fn()
const mockDbSelect = vi.fn()

vi.mock('@/lib/auth', () => ({
  getSession: () => mockGetSession(),
}))

vi.mock('@sim/logger', () => loggerMock)

vi.mock('@/lib/audit/log', () => auditMock)

vi.mock('@/lib/workflows/persistence/utils', () => ({
  loadWorkflowFromNormalizedTables: (workflowId: string) =>
    mockLoadWorkflowFromNormalizedTables(workflowId),
}))

vi.mock('@/lib/workflows/utils', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/workflows/utils')>('@/lib/workflows/utils')

  return {
    ...actual,
    getWorkflowById: (workflowId: string) => mockGetWorkflowById(workflowId),
    authorizeWorkflowByWorkspacePermission: (params: {
      workflowId: string
      userId: string
      action?: 'read' | 'write' | 'admin'
    }) => mockAuthorizeWorkflowByWorkspacePermission(params),
  }
})

vi.mock('@sim/db', () => ({
  db: {
    delete: () => mockDbDelete(),
    update: () => mockDbUpdate(),
    select: () => mockDbSelect(),
  },
  workflow: {},
}))

import { DELETE, GET, PUT } from './route'

describe('Workflow By ID API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    vi.stubGlobal('crypto', {
      randomUUID: vi.fn().mockReturnValue('mock-request-id-12345678'),
    })

    mockLoadWorkflowFromNormalizedTables.mockResolvedValue(null)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('GET /api/workflows/[id]', () => {
    it('should return 401 when user is not authenticated', async () => {
      mockGetSession.mockResolvedValue(null)

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123')
      const params = Promise.resolve({ id: 'workflow-123' })

      const response = await GET(req, { params })

      expect(response.status).toBe(401)
      const data = await response.json()
      expect(data.error).toBe('Unauthorized')
    })

    it('should return 404 when workflow does not exist', async () => {
      mockGetSession.mockResolvedValue({
        user: { id: 'user-123' },
      })

      mockGetWorkflowById.mockResolvedValue(null)

      const req = new NextRequest('http://localhost:3000/api/workflows/nonexistent')
      const params = Promise.resolve({ id: 'nonexistent' })

      const response = await GET(req, { params })

      expect(response.status).toBe(404)
      const data = await response.json()
      expect(data.error).toBe('Workflow not found')
    })

    it.concurrent('should allow access when user has admin workspace permission', async () => {
      const mockWorkflow = {
        id: 'workflow-123',
        userId: 'user-123',
        name: 'Test Workflow',
        workspaceId: 'workspace-456',
      }

      const mockNormalizedData = {
        blocks: {},
        edges: [],
        loops: {},
        parallels: {},
        isFromNormalizedTables: true,
      }

      mockGetSession.mockResolvedValue({
        user: { id: 'user-123' },
      })

      mockGetWorkflowById.mockResolvedValue(mockWorkflow)
      mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
        allowed: true,
        status: 200,
        workflow: mockWorkflow,
        workspacePermission: 'admin',
      })

      mockLoadWorkflowFromNormalizedTables.mockResolvedValue(mockNormalizedData)

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123')
      const params = Promise.resolve({ id: 'workflow-123' })

      const response = await GET(req, { params })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.data.id).toBe('workflow-123')
    })

    it.concurrent('should allow access when user has workspace permissions', async () => {
      const mockWorkflow = {
        id: 'workflow-123',
        userId: 'other-user',
        name: 'Test Workflow',
        workspaceId: 'workspace-456',
      }

      const mockNormalizedData = {
        blocks: {},
        edges: [],
        loops: {},
        parallels: {},
        isFromNormalizedTables: true,
      }

      mockGetSession.mockResolvedValue({
        user: { id: 'user-123' },
      })

      mockGetWorkflowById.mockResolvedValue(mockWorkflow)
      mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
        allowed: true,
        status: 200,
        workflow: mockWorkflow,
        workspacePermission: 'read',
      })

      mockLoadWorkflowFromNormalizedTables.mockResolvedValue(mockNormalizedData)

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123')
      const params = Promise.resolve({ id: 'workflow-123' })

      const response = await GET(req, { params })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.data.id).toBe('workflow-123')
    })

    it('should deny access when user has no workspace permissions', async () => {
      const mockWorkflow = {
        id: 'workflow-123',
        userId: 'other-user',
        name: 'Test Workflow',
        workspaceId: 'workspace-456',
      }

      mockGetSession.mockResolvedValue({
        user: { id: 'user-123' },
      })

      mockGetWorkflowById.mockResolvedValue(mockWorkflow)
      mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
        allowed: false,
        status: 403,
        message: 'Unauthorized: Access denied to read this workflow',
        workflow: mockWorkflow,
        workspacePermission: null,
      })

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123')
      const params = Promise.resolve({ id: 'workflow-123' })

      const response = await GET(req, { params })

      expect(response.status).toBe(403)
      const data = await response.json()
      expect(data.error).toBe('Unauthorized: Access denied to read this workflow')
    })

    it.concurrent('should use normalized tables when available', async () => {
      const mockWorkflow = {
        id: 'workflow-123',
        userId: 'user-123',
        name: 'Test Workflow',
        workspaceId: 'workspace-456',
      }

      const mockNormalizedData = {
        blocks: { 'block-1': { id: 'block-1', type: 'starter' } },
        edges: [{ id: 'edge-1', source: 'block-1', target: 'block-2' }],
        loops: {},
        parallels: {},
        isFromNormalizedTables: true,
      }

      mockGetSession.mockResolvedValue({
        user: { id: 'user-123' },
      })

      mockGetWorkflowById.mockResolvedValue(mockWorkflow)
      mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
        allowed: true,
        status: 200,
        workflow: mockWorkflow,
        workspacePermission: 'admin',
      })

      mockLoadWorkflowFromNormalizedTables.mockResolvedValue(mockNormalizedData)

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123')
      const params = Promise.resolve({ id: 'workflow-123' })

      const response = await GET(req, { params })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.data.state.blocks).toEqual(mockNormalizedData.blocks)
      expect(data.data.state.edges).toEqual(mockNormalizedData.edges)
    })
  })

  describe('DELETE /api/workflows/[id]', () => {
    it('should allow admin to delete workflow', async () => {
      const mockWorkflow = {
        id: 'workflow-123',
        userId: 'user-123',
        name: 'Test Workflow',
        workspaceId: 'workspace-456',
      }

      mockGetSession.mockResolvedValue({
        user: { id: 'user-123' },
      })

      mockGetWorkflowById.mockResolvedValue(mockWorkflow)
      mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
        allowed: true,
        status: 200,
        workflow: mockWorkflow,
        workspacePermission: 'admin',
      })

      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ id: 'workflow-123' }, { id: 'workflow-456' }]),
        }),
      })

      mockDbDelete.mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: 'workflow-123' }]),
      })

      setupGlobalFetchMock({ ok: true })

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123', {
        method: 'DELETE',
      })
      const params = Promise.resolve({ id: 'workflow-123' })

      const response = await DELETE(req, { params })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.success).toBe(true)
    })

    it('should allow admin to delete workspace workflow', async () => {
      const mockWorkflow = {
        id: 'workflow-123',
        userId: 'other-user',
        name: 'Test Workflow',
        workspaceId: 'workspace-456',
      }

      mockGetSession.mockResolvedValue({
        user: { id: 'user-123' },
      })

      mockGetWorkflowById.mockResolvedValue(mockWorkflow)
      mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
        allowed: true,
        status: 200,
        workflow: mockWorkflow,
        workspacePermission: 'admin',
      })

      // Mock db.select() to return multiple workflows so deletion is allowed
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ id: 'workflow-123' }, { id: 'workflow-456' }]),
        }),
      })

      mockDbDelete.mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: 'workflow-123' }]),
      })

      setupGlobalFetchMock({ ok: true })

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123', {
        method: 'DELETE',
      })
      const params = Promise.resolve({ id: 'workflow-123' })

      const response = await DELETE(req, { params })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.success).toBe(true)
    })

    it('should prevent deletion of the last workflow in workspace', async () => {
      const mockWorkflow = {
        id: 'workflow-123',
        userId: 'user-123',
        name: 'Test Workflow',
        workspaceId: 'workspace-456',
      }

      mockGetSession.mockResolvedValue({
        user: { id: 'user-123' },
      })

      mockGetWorkflowById.mockResolvedValue(mockWorkflow)
      mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
        allowed: true,
        status: 200,
        workflow: mockWorkflow,
        workspacePermission: 'admin',
      })

      // Mock db.select() to return only 1 workflow (the one being deleted)
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ id: 'workflow-123' }]),
        }),
      })

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123', {
        method: 'DELETE',
      })
      const params = Promise.resolve({ id: 'workflow-123' })

      const response = await DELETE(req, { params })

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.error).toBe('Cannot delete the only workflow in the workspace')
    })

    it.concurrent('should deny deletion for non-admin users', async () => {
      const mockWorkflow = {
        id: 'workflow-123',
        userId: 'other-user',
        name: 'Test Workflow',
        workspaceId: 'workspace-456',
      }

      mockGetSession.mockResolvedValue({
        user: { id: 'user-123' },
      })

      mockGetWorkflowById.mockResolvedValue(mockWorkflow)
      mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
        allowed: false,
        status: 403,
        message: 'Unauthorized: Access denied to admin this workflow',
        workflow: mockWorkflow,
        workspacePermission: null,
      })

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123', {
        method: 'DELETE',
      })
      const params = Promise.resolve({ id: 'workflow-123' })

      const response = await DELETE(req, { params })

      expect(response.status).toBe(403)
      const data = await response.json()
      expect(data.error).toBe('Unauthorized: Access denied to admin this workflow')
    })
  })

  describe('PUT /api/workflows/[id]', () => {
    it('should allow user with write permission to update workflow', async () => {
      const mockWorkflow = {
        id: 'workflow-123',
        userId: 'user-123',
        name: 'Test Workflow',
        workspaceId: 'workspace-456',
      }

      const updateData = { name: 'Updated Workflow' }
      const updatedWorkflow = { ...mockWorkflow, ...updateData, updatedAt: new Date() }

      mockGetSession.mockResolvedValue({
        user: { id: 'user-123' },
      })

      mockGetWorkflowById.mockResolvedValue(mockWorkflow)
      mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
        allowed: true,
        status: 200,
        workflow: mockWorkflow,
        workspacePermission: 'write',
      })

      mockDbUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([updatedWorkflow]),
          }),
        }),
      })

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123', {
        method: 'PUT',
        body: JSON.stringify(updateData),
      })
      const params = Promise.resolve({ id: 'workflow-123' })

      const response = await PUT(req, { params })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.workflow.name).toBe('Updated Workflow')
    })

    it('should allow users with write permission to update workflow', async () => {
      const mockWorkflow = {
        id: 'workflow-123',
        userId: 'other-user',
        name: 'Test Workflow',
        workspaceId: 'workspace-456',
      }

      const updateData = { name: 'Updated Workflow' }
      const updatedWorkflow = { ...mockWorkflow, ...updateData, updatedAt: new Date() }

      mockGetSession.mockResolvedValue({
        user: { id: 'user-123' },
      })

      mockGetWorkflowById.mockResolvedValue(mockWorkflow)
      mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
        allowed: true,
        status: 200,
        workflow: mockWorkflow,
        workspacePermission: 'write',
      })

      mockDbUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([updatedWorkflow]),
          }),
        }),
      })

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123', {
        method: 'PUT',
        body: JSON.stringify(updateData),
      })
      const params = Promise.resolve({ id: 'workflow-123' })

      const response = await PUT(req, { params })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.workflow.name).toBe('Updated Workflow')
    })

    it('should deny update for users with only read permission', async () => {
      const mockWorkflow = {
        id: 'workflow-123',
        userId: 'other-user',
        name: 'Test Workflow',
        workspaceId: 'workspace-456',
      }

      const updateData = { name: 'Updated Workflow' }

      mockGetSession.mockResolvedValue({
        user: { id: 'user-123' },
      })

      mockGetWorkflowById.mockResolvedValue(mockWorkflow)
      mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
        allowed: false,
        status: 403,
        message: 'Unauthorized: Access denied to write this workflow',
        workflow: mockWorkflow,
        workspacePermission: 'read',
      })

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123', {
        method: 'PUT',
        body: JSON.stringify(updateData),
      })
      const params = Promise.resolve({ id: 'workflow-123' })

      const response = await PUT(req, { params })

      expect(response.status).toBe(403)
      const data = await response.json()
      expect(data.error).toBe('Unauthorized: Access denied to write this workflow')
    })

    it.concurrent('should validate request data', async () => {
      const mockWorkflow = {
        id: 'workflow-123',
        userId: 'user-123',
        name: 'Test Workflow',
        workspaceId: 'workspace-456',
      }

      mockGetSession.mockResolvedValue({
        user: { id: 'user-123' },
      })

      mockGetWorkflowById.mockResolvedValue(mockWorkflow)
      mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
        allowed: true,
        status: 200,
        workflow: mockWorkflow,
        workspacePermission: 'write',
      })

      const invalidData = { name: '' }

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123', {
        method: 'PUT',
        body: JSON.stringify(invalidData),
      })
      const params = Promise.resolve({ id: 'workflow-123' })

      const response = await PUT(req, { params })

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.error).toBe('Invalid request data')
    })
  })

  describe('Error handling', () => {
    it.concurrent('should handle database errors gracefully', async () => {
      mockGetSession.mockResolvedValue({
        user: { id: 'user-123' },
      })

      mockGetWorkflowById.mockRejectedValue(new Error('Database connection timeout'))

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123')
      const params = Promise.resolve({ id: 'workflow-123' })

      const response = await GET(req, { params })

      expect(response.status).toBe(500)
      const data = await response.json()
      expect(data.error).toBe('Internal server error')
    })
  })
})
