/**
 * Tests for custom tools API routes
 *
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockSelect,
  mockFrom,
  mockWhere,
  mockOrderBy,
  mockInsert,
  mockValues,
  mockUpdate,
  mockSet,
  mockDelete,
  mockLimit,
  mockCheckSessionOrInternalAuth,
  mockGetSession,
  mockGetUserEntityPermissions,
  mockUpsertCustomTools,
  mockAuthorizeWorkflowByWorkspacePermission,
  mockLogger,
} = vi.hoisted(() => {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  }
  return {
    mockSelect: vi.fn(),
    mockFrom: vi.fn(),
    mockWhere: vi.fn(),
    mockOrderBy: vi.fn(),
    mockInsert: vi.fn(),
    mockValues: vi.fn(),
    mockUpdate: vi.fn(),
    mockSet: vi.fn(),
    mockDelete: vi.fn(),
    mockLimit: vi.fn(),
    mockCheckSessionOrInternalAuth: vi.fn(),
    mockGetSession: vi.fn(),
    mockGetUserEntityPermissions: vi.fn(),
    mockUpsertCustomTools: vi.fn(),
    mockAuthorizeWorkflowByWorkspacePermission: vi.fn(),
    mockLogger: logger,
  }
})

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

vi.mock('@sim/db', () => ({
  db: {
    select: (...args: unknown[]) => mockSelect(...args),
    insert: (...args: unknown[]) => mockInsert(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
    transaction: vi
      .fn()
      .mockImplementation(async (callback: (tx: Record<string, unknown>) => unknown) => {
        const txMockSelect = vi.fn().mockReturnValue({ from: mockFrom })
        const txMockInsert = vi.fn().mockReturnValue({ values: mockValues })
        const txMockUpdate = vi.fn().mockReturnValue({ set: mockSet })
        const txMockDelete = vi.fn().mockReturnValue({ where: mockWhere })

        const txMockOrderBy = vi.fn().mockImplementation(() => {
          const queryBuilder = {
            limit: mockLimit,
            then: (resolve: (value: typeof sampleTools) => void) => {
              resolve(sampleTools)
              return queryBuilder
            },
            catch: (_reject: (error: Error) => void) => queryBuilder,
          }
          return queryBuilder
        })

        const txMockWhere = vi.fn().mockImplementation(() => {
          const queryBuilder = {
            orderBy: txMockOrderBy,
            limit: mockLimit,
            then: (resolve: (value: typeof sampleTools) => void) => {
              resolve(sampleTools)
              return queryBuilder
            },
            catch: (_reject: (error: Error) => void) => queryBuilder,
          }
          return queryBuilder
        })

        const txMockFrom = vi.fn().mockReturnValue({ where: txMockWhere })
        txMockSelect.mockReturnValue({ from: txMockFrom })

        return await callback({
          select: txMockSelect,
          insert: txMockInsert,
          update: txMockUpdate,
          delete: txMockDelete,
        })
      }),
  },
}))

vi.mock('@sim/db/schema', () => ({
  customTools: {
    id: 'id',
    workspaceId: 'workspaceId',
    userId: 'userId',
    title: 'title',
  },
  workflow: {
    id: 'id',
    workspaceId: 'workspaceId',
    userId: 'userId',
  },
}))

vi.mock('@/lib/auth', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
}))

vi.mock('@/lib/auth/hybrid', () => ({
  checkSessionOrInternalAuth: (...args: unknown[]) => mockCheckSessionOrInternalAuth(...args),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getUserEntityPermissions: (...args: unknown[]) => mockGetUserEntityPermissions(...args),
}))

vi.mock('@sim/logger', () => ({
  createLogger: vi.fn().mockReturnValue(mockLogger),
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn().mockImplementation((field: unknown, value: unknown) => ({
    field,
    value,
    operator: 'eq',
  })),
  and: vi.fn().mockImplementation((...conditions: unknown[]) => ({
    operator: 'and',
    conditions,
  })),
  or: vi.fn().mockImplementation((...conditions: unknown[]) => ({
    operator: 'or',
    conditions,
  })),
  isNull: vi.fn().mockImplementation((field: unknown) => ({ field, operator: 'isNull' })),
  ne: vi.fn().mockImplementation((field: unknown, value: unknown) => ({
    field,
    value,
    operator: 'ne',
  })),
  desc: vi.fn().mockImplementation((field: unknown) => ({ field, operator: 'desc' })),
}))

vi.mock('@/lib/core/utils/request', () => ({
  generateRequestId: vi.fn().mockReturnValue('test-request-id'),
}))

vi.mock('@/lib/workflows/custom-tools/operations', () => ({
  upsertCustomTools: (...args: unknown[]) => mockUpsertCustomTools(...args),
}))

vi.mock('@/lib/workflows/utils', () => ({
  authorizeWorkflowByWorkspacePermission: (...args: unknown[]) =>
    mockAuthorizeWorkflowByWorkspacePermission(...args),
}))

import { DELETE, GET, POST } from '@/app/api/tools/custom/route'

describe('Custom Tools API Routes', () => {
  const mockSession = { user: { id: 'user-123' } }

  beforeEach(() => {
    vi.clearAllMocks()

    mockSelect.mockReturnValue({ from: mockFrom })
    mockFrom.mockReturnValue({ where: mockWhere })
    mockWhere.mockImplementation(() => {
      const queryBuilder = {
        orderBy: mockOrderBy,
        limit: mockLimit,
        then: (resolve: (value: typeof sampleTools) => void) => {
          resolve(sampleTools)
          return queryBuilder
        },
        catch: (_reject: (error: Error) => void) => queryBuilder,
      }
      return queryBuilder
    })
    mockOrderBy.mockImplementation(() => {
      const queryBuilder = {
        limit: mockLimit,
        then: (resolve: (value: typeof sampleTools) => void) => {
          resolve(sampleTools)
          return queryBuilder
        },
        catch: (_reject: (error: Error) => void) => queryBuilder,
      }
      return queryBuilder
    })
    mockLimit.mockResolvedValue(sampleTools)
    mockInsert.mockReturnValue({ values: mockValues })
    mockValues.mockResolvedValue({ id: 'new-tool-id' })
    mockUpdate.mockReturnValue({ set: mockSet })
    mockSet.mockReturnValue({ where: mockWhere })
    mockDelete.mockReturnValue({ where: mockWhere })

    mockGetSession.mockResolvedValue(mockSession)
    mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-123',
      authType: 'session',
    })
    mockGetUserEntityPermissions.mockResolvedValue('admin')
    mockUpsertCustomTools.mockResolvedValue(sampleTools)
    mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
      allowed: true,
      status: 200,
      workflow: { workspaceId: 'workspace-123' },
    })
  })

  /**
   * Test GET endpoint
   */
  describe('GET /api/tools/custom', () => {
    it('should return tools for authenticated user with workspaceId', async () => {
      const req = new NextRequest(
        'http://localhost:3000/api/tools/custom?workspaceId=workspace-123'
      )

      mockWhere.mockReturnValueOnce({
        orderBy: mockOrderBy.mockReturnValueOnce(Promise.resolve(sampleTools)),
      })

      const response = await GET(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toHaveProperty('data')
      expect(data.data).toEqual(sampleTools)

      expect(mockSelect).toHaveBeenCalled()
      expect(mockFrom).toHaveBeenCalled()
      expect(mockWhere).toHaveBeenCalled()
      expect(mockOrderBy).toHaveBeenCalled()
    })

    it('should handle unauthorized access', async () => {
      const req = new NextRequest(
        'http://localhost:3000/api/tools/custom?workspaceId=workspace-123'
      )

      mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
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

      const response = await GET(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toHaveProperty('data')

      expect(mockWhere).toHaveBeenCalled()
    })
  })

  /**
   * Test POST endpoint
   */
  describe('POST /api/tools/custom', () => {
    it('should reject unauthorized requests', async () => {
      mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
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
      mockLimit.mockResolvedValueOnce([sampleTools[0]])

      const req = new NextRequest(
        'http://localhost:3000/api/tools/custom?id=tool-1&workspaceId=workspace-123'
      )

      const response = await DELETE(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toHaveProperty('success', true)

      expect(mockDelete).toHaveBeenCalled()
      expect(mockWhere).toHaveBeenCalled()
    })

    it('should reject requests missing tool ID', async () => {
      const req = new NextRequest('http://localhost:3000/api/tools/custom')

      const response = await DELETE(req)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data).toHaveProperty('error', 'Tool ID is required')
    })

    it('should handle tool not found', async () => {
      const mockLimitNotFound = vi.fn().mockResolvedValue([])
      mockWhere.mockReturnValueOnce({ limit: mockLimitNotFound })

      const req = new NextRequest('http://localhost:3000/api/tools/custom?id=non-existent')

      const response = await DELETE(req)
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data).toHaveProperty('error', 'Tool not found')
    })

    it('should prevent unauthorized deletion of user-scoped tool', async () => {
      mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
        success: true,
        userId: 'user-456',
        authType: 'session',
      })

      const userScopedTool = { ...sampleTools[0], workspaceId: null, userId: 'user-123' }
      const mockLimitUserScoped = vi.fn().mockResolvedValue([userScopedTool])
      mockWhere.mockReturnValueOnce({ limit: mockLimitUserScoped })

      const req = new NextRequest('http://localhost:3000/api/tools/custom?id=tool-1')

      const response = await DELETE(req)
      const data = await response.json()

      expect(response.status).toBe(403)
      expect(data).toHaveProperty('error', 'Access denied')
    })

    it('should reject unauthorized requests', async () => {
      mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
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
