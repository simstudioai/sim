/**
 * Tests for workflow variables API route
 * Tests the optimized permissions and caching system
 *
 * @vitest-environment node
 */
import { auditMock } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCheckSessionOrInternalAuth, mockAuthorizeWorkflowByWorkspacePermission } = vi.hoisted(
  () => ({
    mockCheckSessionOrInternalAuth: vi.fn(),
    mockAuthorizeWorkflowByWorkspacePermission: vi.fn(),
  })
)

vi.mock('@/lib/audit/log', () => auditMock)

vi.mock('@/lib/auth/hybrid', () => ({
  checkSessionOrInternalAuth: mockCheckSessionOrInternalAuth,
}))

vi.mock('@/lib/workflows/utils', () => ({
  authorizeWorkflowByWorkspacePermission: mockAuthorizeWorkflowByWorkspacePermission,
}))

vi.mock('@/lib/core/utils/request', () => ({
  generateRequestId: vi.fn().mockReturnValue('mock-request-id-12345678'),
}))

import { GET, POST } from '@/app/api/workflows/[id]/variables/route'

describe('Workflow Variables API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('GET /api/workflows/[id]/variables', () => {
    it('should return 401 when user is not authenticated', async () => {
      mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
        success: false,
        error: 'Authentication required',
      })

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123/variables')
      const params = Promise.resolve({ id: 'workflow-123' })

      const response = await GET(req, { params })

      expect(response.status).toBe(401)
      const data = await response.json()
      expect(data.error).toBe('Unauthorized')
    })

    it('should return 404 when workflow does not exist', async () => {
      mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
        success: true,
        userId: 'user-123',
        authType: 'session',
      })
      mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
        allowed: false,
        status: 404,
        message: 'Workflow not found',
        workflow: null,
        workspacePermission: null,
      })

      const req = new NextRequest('http://localhost:3000/api/workflows/nonexistent/variables')
      const params = Promise.resolve({ id: 'nonexistent' })

      const response = await GET(req, { params })

      expect(response.status).toBe(404)
      const data = await response.json()
      expect(data.error).toBe('Workflow not found')
    })

    it('should allow access when user has workspace permission', async () => {
      const mockWorkflow = {
        id: 'workflow-123',
        userId: 'user-123',
        workspaceId: 'workspace-456',
        variables: {
          'var-1': { id: 'var-1', name: 'test', type: 'string', value: 'hello' },
        },
      }

      mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
        success: true,
        userId: 'user-123',
        authType: 'session',
      })
      mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
        allowed: true,
        status: 200,
        workflow: mockWorkflow,
        workspacePermission: 'admin',
      })

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123/variables')
      const params = Promise.resolve({ id: 'workflow-123' })

      const response = await GET(req, { params })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.data).toEqual(mockWorkflow.variables)
    })

    it('should allow access when user has workspace permissions', async () => {
      const mockWorkflow = {
        id: 'workflow-123',
        userId: 'other-user',
        workspaceId: 'workspace-456',
        variables: {
          'var-1': { id: 'var-1', name: 'test', type: 'string', value: 'hello' },
        },
      }

      mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
        success: true,
        userId: 'user-123',
        authType: 'session',
      })
      mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
        allowed: true,
        status: 200,
        workflow: mockWorkflow,
        workspacePermission: 'read',
      })

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123/variables')
      const params = Promise.resolve({ id: 'workflow-123' })

      const response = await GET(req, { params })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.data).toEqual(mockWorkflow.variables)
    })

    it('should deny access when user has no workspace permissions', async () => {
      const mockWorkflow = {
        id: 'workflow-123',
        userId: 'other-user',
        workspaceId: 'workspace-456',
        variables: {},
      }

      mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
        success: true,
        userId: 'user-123',
        authType: 'session',
      })
      mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
        allowed: false,
        status: 403,
        message: 'Unauthorized: Access denied to read this workflow',
        workflow: mockWorkflow,
        workspacePermission: null,
      })

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123/variables')
      const params = Promise.resolve({ id: 'workflow-123' })

      const response = await GET(req, { params })

      expect(response.status).toBe(403)
      const data = await response.json()
      expect(data.error).toBe('Unauthorized: Access denied to read this workflow')
    })

    it('should include proper cache headers', async () => {
      const mockWorkflow = {
        id: 'workflow-123',
        userId: 'user-123',
        workspaceId: 'workspace-456',
        variables: {
          'var-1': { id: 'var-1', name: 'test', type: 'string', value: 'hello' },
        },
      }

      mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
        success: true,
        userId: 'user-123',
        authType: 'session',
      })
      mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
        allowed: true,
        status: 200,
        workflow: mockWorkflow,
        workspacePermission: 'admin',
      })

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123/variables')
      const params = Promise.resolve({ id: 'workflow-123' })

      const response = await GET(req, { params })

      expect(response.status).toBe(200)
      expect(response.headers.get('Cache-Control')).toBe('max-age=30, stale-while-revalidate=300')
      expect(response.headers.get('ETag')).toMatch(/^"variables-workflow-123-\d+"$/)
    })
  })

  describe('POST /api/workflows/[id]/variables', () => {
    it('should allow user with write permission to update variables', async () => {
      const mockWorkflow = {
        id: 'workflow-123',
        userId: 'user-123',
        workspaceId: 'workspace-456',
        variables: {},
      }

      mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
        success: true,
        userId: 'user-123',
        authType: 'session',
      })
      mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
        allowed: true,
        status: 200,
        workflow: mockWorkflow,
        workspacePermission: 'write',
      })

      const variables = {
        'var-1': {
          id: 'var-1',
          workflowId: 'workflow-123',
          name: 'test',
          type: 'string',
          value: 'hello',
        },
      }

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123/variables', {
        method: 'POST',
        body: JSON.stringify({ variables }),
      })
      const params = Promise.resolve({ id: 'workflow-123' })

      const response = await POST(req, { params })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.success).toBe(true)
    })

    it('should deny access for users without permissions', async () => {
      const mockWorkflow = {
        id: 'workflow-123',
        userId: 'other-user',
        workspaceId: 'workspace-456',
        variables: {},
      }

      mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
        success: true,
        userId: 'user-123',
        authType: 'session',
      })
      mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
        allowed: false,
        status: 403,
        message: 'Unauthorized: Access denied to write this workflow',
        workflow: mockWorkflow,
        workspacePermission: null,
      })

      const variables = {
        'var-1': {
          id: 'var-1',
          workflowId: 'workflow-123',
          name: 'test',
          type: 'string',
          value: 'hello',
        },
      }

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123/variables', {
        method: 'POST',
        body: JSON.stringify({ variables }),
      })
      const params = Promise.resolve({ id: 'workflow-123' })

      const response = await POST(req, { params })

      expect(response.status).toBe(403)
      const data = await response.json()
      expect(data.error).toBe('Unauthorized: Access denied to write this workflow')
    })

    it('should validate request data schema', async () => {
      const mockWorkflow = {
        id: 'workflow-123',
        userId: 'user-123',
        workspaceId: 'workspace-456',
        variables: {},
      }

      mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
        success: true,
        userId: 'user-123',
        authType: 'session',
      })
      mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
        allowed: true,
        status: 200,
        workflow: mockWorkflow,
        workspacePermission: 'write',
      })

      const invalidData = { variables: [{ name: 'test' }] }

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123/variables', {
        method: 'POST',
        body: JSON.stringify(invalidData),
      })
      const params = Promise.resolve({ id: 'workflow-123' })

      const response = await POST(req, { params })

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.error).toBe('Invalid request data')
    })
  })

  describe('Error handling', () => {
    it('should handle database errors gracefully', async () => {
      mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
        success: true,
        userId: 'user-123',
        authType: 'session',
      })
      mockAuthorizeWorkflowByWorkspacePermission.mockRejectedValueOnce(
        new Error('Database connection failed')
      )

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123/variables')
      const params = Promise.resolve({ id: 'workflow-123' })

      const response = await GET(req, { params })

      expect(response.status).toBe(500)
      const data = await response.json()
      expect(data.error).toBe('Database connection failed')
    })
  })
})
