/**
 * Tests for workflow variables API route
 * Tests the optimized permissions and caching system
 *
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('Workflow Variables API Route', () => {
  const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }

  beforeEach(() => {
    vi.resetModules()

    vi.stubGlobal('crypto', {
      randomUUID: vi.fn().mockReturnValue('mock-request-id-12345678'),
    })

    vi.doMock('@/lib/logs/console-logger', () => ({
      createLogger: vi.fn().mockReturnValue(mockLogger),
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('GET /api/workflows/[id]/variables', () => {
    it('should return 401 when user is not authenticated', async () => {
      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue(null),
      }))

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123/variables')
      const params = Promise.resolve({ id: 'workflow-123' })

      const { GET } = await import('./route')
      const response = await GET(req, { params })

      expect(response.status).toBe(401)
      const data = await response.json()
      expect(data.error).toBe('Unauthorized')
    })

    it('should return 404 when workflow does not exist', async () => {
      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'user-123' },
        }),
      }))

      vi.doMock('@/db', () => ({
        db: {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([]), // No workflow found
              }),
            }),
          }),
        },
      }))

      const req = new NextRequest('http://localhost:3000/api/workflows/nonexistent/variables')
      const params = Promise.resolve({ id: 'nonexistent' })

      const { GET } = await import('./route')
      const response = await GET(req, { params })

      expect(response.status).toBe(404)
      const data = await response.json()
      expect(data.error).toBe('Workflow not found')
    })

    it('should allow access when user owns the workflow', async () => {
      const mockWorkflow = {
        id: 'workflow-123',
        userId: 'user-123',
        workspaceId: null,
        variables: {
          'var-1': { id: 'var-1', name: 'test', type: 'string', value: 'hello' },
        },
      }

      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'user-123' },
        }),
      }))

      vi.doMock('@/db', () => ({
        db: {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([mockWorkflow]),
              }),
            }),
          }),
        },
      }))

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123/variables')
      const params = Promise.resolve({ id: 'workflow-123' })

      const { GET } = await import('./route')
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

      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'user-123' },
        }),
      }))

      vi.doMock('@/db', () => ({
        db: {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([mockWorkflow]),
              }),
            }),
          }),
        },
      }))

      vi.doMock('@/lib/permissions/utils', () => ({
        getUserEntityPermissions: vi.fn().mockResolvedValue('read'),
      }))

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123/variables')
      const params = Promise.resolve({ id: 'workflow-123' })

      const { GET } = await import('./route')
      const response = await GET(req, { params })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.data).toEqual(mockWorkflow.variables)

      // Verify permissions check was called
      const { getUserEntityPermissions } = await import('@/lib/permissions/utils')
      expect(getUserEntityPermissions).toHaveBeenCalledWith(
        'user-123',
        'workspace',
        'workspace-456'
      )
    })

    it('should deny access when user has no workspace permissions', async () => {
      const mockWorkflow = {
        id: 'workflow-123',
        userId: 'other-user',
        workspaceId: 'workspace-456',
        variables: {},
      }

      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'user-123' },
        }),
      }))

      vi.doMock('@/db', () => ({
        db: {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([mockWorkflow]),
              }),
            }),
          }),
        },
      }))

      vi.doMock('@/lib/permissions/utils', () => ({
        getUserEntityPermissions: vi.fn().mockResolvedValue(null),
      }))

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123/variables')
      const params = Promise.resolve({ id: 'workflow-123' })

      const { GET } = await import('./route')
      const response = await GET(req, { params })

      expect(response.status).toBe(401)
      const data = await response.json()
      expect(data.error).toBe('Unauthorized')
    })

    it('should include proper cache headers', async () => {
      const mockWorkflow = {
        id: 'workflow-123',
        userId: 'user-123',
        workspaceId: null,
        variables: {
          'var-1': { id: 'var-1', name: 'test', type: 'string', value: 'hello' },
        },
      }

      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'user-123' },
        }),
      }))

      vi.doMock('@/db', () => ({
        db: {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([mockWorkflow]),
              }),
            }),
          }),
        },
      }))

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123/variables')
      const params = Promise.resolve({ id: 'workflow-123' })

      const { GET } = await import('./route')
      const response = await GET(req, { params })

      expect(response.status).toBe(200)
      expect(response.headers.get('Cache-Control')).toBe('max-age=30, stale-while-revalidate=300')
      expect(response.headers.get('ETag')).toMatch(/^"variables-workflow-123-\d+"$/)
    })

    it('should return empty object for workflows with no variables', async () => {
      const mockWorkflow = {
        id: 'workflow-123',
        userId: 'user-123',
        workspaceId: null,
        variables: null,
      }

      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'user-123' },
        }),
      }))

      vi.doMock('@/db', () => ({
        db: {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([mockWorkflow]),
              }),
            }),
          }),
        },
      }))

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123/variables')
      const params = Promise.resolve({ id: 'workflow-123' })

      const { GET } = await import('./route')
      const response = await GET(req, { params })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.data).toEqual({})
    })
  })

  describe('POST /api/workflows/[id]/variables', () => {
    it('should allow owner to update variables', async () => {
      const mockWorkflow = {
        id: 'workflow-123',
        userId: 'user-123',
        workspaceId: null,
        variables: {},
      }

      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'user-123' },
        }),
      }))

      vi.doMock('@/db', () => ({
        db: {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([mockWorkflow]),
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue(undefined),
            }),
          }),
        },
      }))

      const variables = [
        { id: 'var-1', workflowId: 'workflow-123', name: 'test', type: 'string', value: 'hello' },
      ]

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123/variables', {
        method: 'POST',
        body: JSON.stringify({ variables }),
      })
      const params = Promise.resolve({ id: 'workflow-123' })

      const { POST } = await import('./route')
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

      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'user-123' },
        }),
      }))

      vi.doMock('@/db', () => ({
        db: {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([mockWorkflow]),
              }),
            }),
          }),
        },
      }))

      vi.doMock('@/lib/permissions/utils', () => ({
        getUserEntityPermissions: vi.fn().mockResolvedValue(null),
      }))

      const variables = [
        { id: 'var-1', workflowId: 'workflow-123', name: 'test', type: 'string', value: 'hello' },
      ]

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123/variables', {
        method: 'POST',
        body: JSON.stringify({ variables }),
      })
      const params = Promise.resolve({ id: 'workflow-123' })

      const { POST } = await import('./route')
      const response = await POST(req, { params })

      expect(response.status).toBe(401)
      const data = await response.json()
      expect(data.error).toBe('Unauthorized')
    })

    it('should validate request data schema', async () => {
      const mockWorkflow = {
        id: 'workflow-123',
        userId: 'user-123',
        workspaceId: null,
        variables: {},
      }

      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'user-123' },
        }),
      }))

      vi.doMock('@/db', () => ({
        db: {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([mockWorkflow]),
              }),
            }),
          }),
        },
      }))

      // Invalid data - missing required fields
      const invalidData = { variables: [{ name: 'test' }] }

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123/variables', {
        method: 'POST',
        body: JSON.stringify(invalidData),
      })
      const params = Promise.resolve({ id: 'workflow-123' })

      const { POST } = await import('./route')
      const response = await POST(req, { params })

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.error).toBe('Invalid request data')
    })
  })

  describe('Error handling', () => {
    it('should handle database errors gracefully', async () => {
      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue({
          user: { id: 'user-123' },
        }),
      }))

      vi.doMock('@/db', () => ({
        db: {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockRejectedValue(new Error('Database connection failed')),
              }),
            }),
          }),
        },
      }))

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123/variables')
      const params = Promise.resolve({ id: 'workflow-123' })

      const { GET } = await import('./route')
      const response = await GET(req, { params })

      expect(response.status).toBe(500)
      const data = await response.json()
      expect(data.error).toBe('Database connection failed')
      expect(mockLogger.error).toHaveBeenCalled()
    })
  })
})
