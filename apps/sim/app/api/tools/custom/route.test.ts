/**
 * Tests for custom tools API routes
 *
 * @vitest-environment node
 */
import {
  authMockFns,
  createMockRequest,
  dbChainMock,
  dbChainMockFns,
  hybridAuthMockFns,
  permissionsMock,
  permissionsMockFns,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
  workflowAuthzMockFns,
  workflowsUtilsMock,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockUpsertCustomTools } = vi.hoisted(() => ({
  mockUpsertCustomTools: vi.fn(),
}))

const mockGetUserEntityPermissions = permissionsMockFns.mockGetUserEntityPermissions

const sampleTools = [
  {
    id: 'tool-1',
    workspaceId: 'workspace-123',
    userId: 'user-123',
    title: 'Weather Tool',
    schema: {
      type: 'function',
      function: {
        name: 'getWeather',
        description: 'Get weather information for a location',
        parameters: {
          type: 'object',
          properties: {
            location: {
              type: 'string',
              description: 'The city and state, e.g. San Francisco, CA',
            },
          },
          required: ['location'],
        },
      },
    },
    code: 'return { temperature: 72, conditions: "sunny" };',
    createdAt: '2023-01-01T00:00:00.000Z',
    updatedAt: '2023-01-02T00:00:00.000Z',
  },
  {
    id: 'tool-2',
    workspaceId: 'workspace-123',
    userId: 'user-123',
    title: 'Calculator Tool',
    schema: {
      type: 'function',
      function: {
        name: 'calculator',
        description: 'Perform basic calculations',
        parameters: {
          type: 'object',
          properties: {
            operation: {
              type: 'string',
              description: 'The operation to perform (add, subtract, multiply, divide)',
            },
            a: { type: 'number', description: 'First number' },
            b: { type: 'number', description: 'Second number' },
          },
          required: ['operation', 'a', 'b'],
        },
      },
    },
    code: 'const { operation, a, b } = params; if (operation === "add") return a + b;',
    createdAt: '2023-02-01T00:00:00.000Z',
    updatedAt: '2023-02-02T00:00:00.000Z',
  },
]

vi.mock('@sim/db', () => dbChainMock)

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

vi.mock('@/lib/workflows/custom-tools/operations', () => ({
  upsertCustomTools: (...args: unknown[]) => mockUpsertCustomTools(...args),
}))

vi.mock('@/lib/workflows/utils', () => workflowsUtilsMock)

import { DELETE, GET, POST } from '@/app/api/tools/custom/route'

describe('Custom Tools API Routes', () => {
  const mockSession = { user: { id: 'user-123' } }

  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()

    authMockFns.mockGetSession.mockResolvedValue(mockSession)
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-123',
      authType: 'session',
    })
    mockGetUserEntityPermissions.mockResolvedValue('admin')
    mockUpsertCustomTools.mockResolvedValue(sampleTools)
    workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
      allowed: true,
      status: 200,
      workflow: { workspaceId: 'workspace-123' },
    })
  })

  afterAll(() => {
    resetDbChainMock()
  })

  /**
   * Test GET endpoint
   */
  describe('GET /api/tools/custom', () => {
    it('should return tools for authenticated user with workspaceId', async () => {
      const req = new NextRequest(
        'http://localhost:3000/api/tools/custom?workspaceId=workspace-123'
      )

      queueTableRows(schemaMock.customTools, sampleTools)

      const response = await GET(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toHaveProperty('data')
      expect(data.data).toEqual(sampleTools)

      expect(dbChainMockFns.select).toHaveBeenCalled()
      expect(dbChainMockFns.from).toHaveBeenCalled()
      expect(dbChainMockFns.where).toHaveBeenCalled()
      expect(dbChainMockFns.orderBy).toHaveBeenCalled()
    })

    it('should handle unauthorized access', async () => {
      const req = new NextRequest(
        'http://localhost:3000/api/tools/custom?workspaceId=workspace-123'
      )

      hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
        success: false,
        error: 'Unauthorized',
      })

      const response = await GET(req)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data).toHaveProperty('error', 'Unauthorized')
    })

    it('should handle workflowId parameter', async () => {
      const req = new NextRequest('http://localhost:3000/api/tools/custom?workflowId=workflow-123')

      queueTableRows(schemaMock.customTools, sampleTools)

      const response = await GET(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toHaveProperty('data')

      expect(dbChainMockFns.where).toHaveBeenCalled()
    })
  })

  /**
   * Test POST endpoint
   */
  describe('POST /api/tools/custom', () => {
    it('should reject unauthorized requests', async () => {
      hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
        success: false,
        error: 'Unauthorized',
      })

      const req = createMockRequest('POST', { tools: [], workspaceId: 'workspace-123' })

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data).toHaveProperty('error', 'Unauthorized')
    })

    it('should validate request data', async () => {
      const invalidTool = {
        code: 'return "invalid";',
      }

      const req = createMockRequest('POST', { tools: [invalidTool], workspaceId: 'workspace-123' })

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data).toHaveProperty('error', 'Invalid request data')
      expect(data).toHaveProperty('details')
    })
  })

  /**
   * Test DELETE endpoint
   */
  describe('DELETE /api/tools/custom', () => {
    it('should delete a workspace-scoped tool by ID', async () => {
      queueTableRows(schemaMock.customTools, [sampleTools[0]])

      const req = new NextRequest(
        'http://localhost:3000/api/tools/custom?id=tool-1&workspaceId=workspace-123'
      )

      const response = await DELETE(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toHaveProperty('success', true)

      expect(dbChainMockFns.delete).toHaveBeenCalled()
      expect(dbChainMockFns.where).toHaveBeenCalled()
    })

    it('should reject requests missing tool ID', async () => {
      const req = new NextRequest('http://localhost:3000/api/tools/custom')

      const response = await DELETE(req)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data).toHaveProperty('error', 'Tool ID is required')
    })

    it('should handle tool not found', async () => {
      queueTableRows(schemaMock.customTools, [])

      const req = new NextRequest('http://localhost:3000/api/tools/custom?id=non-existent')

      const response = await DELETE(req)
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data).toHaveProperty('error', 'Tool not found')
    })

    it('should prevent unauthorized deletion of user-scoped tool', async () => {
      hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
        success: true,
        userId: 'user-456',
        authType: 'session',
      })

      const userScopedTool = { ...sampleTools[0], workspaceId: null, userId: 'user-123' }
      queueTableRows(schemaMock.customTools, [userScopedTool])

      const req = new NextRequest('http://localhost:3000/api/tools/custom?id=tool-1')

      const response = await DELETE(req)
      const data = await response.json()

      expect(response.status).toBe(403)
      expect(data).toHaveProperty('error', 'Access denied')
    })

    it('should reject unauthorized requests', async () => {
      hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
        success: false,
        error: 'Unauthorized',
      })

      const req = new NextRequest('http://localhost:3000/api/tools/custom?id=tool-1')

      const response = await DELETE(req)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data).toHaveProperty('error', 'Unauthorized')
    })
  })
})
