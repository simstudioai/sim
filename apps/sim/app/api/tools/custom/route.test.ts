/**
 * Tests for custom tools API routes
 *
 * @vitest-environment node
 */
import { createMockRequest, loggerMock } from '@sim/testing'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('Custom Tools API Routes', () => {
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

  const mockSelect = vi.fn()
  const mockFrom = vi.fn()
  const mockWhere = vi.fn()
  const mockOrderBy = vi.fn()
  const mockInsert = vi.fn()
  const mockValues = vi.fn()
  const mockUpdate = vi.fn()
  const mockSet = vi.fn()
  const mockDelete = vi.fn()
  const mockLimit = vi.fn()
  const mockSession = { user: { id: 'user-123' } }

  beforeEach(() => {
    vi.resetModules()

    mockSelect.mockReturnValue({ from: mockFrom })
    mockFrom.mockReturnValue({ where: mockWhere })
    mockWhere.mockImplementation((condition) => {
      const queryBuilder = {
        orderBy: mockOrderBy,
        limit: mockLimit,
        then: (resolve: (value: typeof sampleTools) => void) => {
          resolve(sampleTools)
          return queryBuilder
        },
        catch: (reject: (error: Error) => void) => queryBuilder,
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
        catch: (reject: (error: Error) => void) => queryBuilder,
      }
      return queryBuilder
    })
    mockLimit.mockResolvedValue(sampleTools)
    mockInsert.mockReturnValue({ values: mockValues })
    mockValues.mockResolvedValue({ id: 'new-tool-id' })
    mockUpdate.mockReturnValue({ set: mockSet })
    mockSet.mockReturnValue({ where: mockWhere })
    mockDelete.mockReturnValue({ where: mockWhere })

    vi.doMock('@sim/db', () => ({
      db: {
        select: mockSelect,
        insert: mockInsert,
        update: mockUpdate,
        delete: mockDelete,
        transaction: vi.fn().mockImplementation(async (callback) => {
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
              catch: (reject: (error: Error) => void) => queryBuilder,
            }
            return queryBuilder
          })

          const txMockWhere = vi.fn().mockImplementation((condition) => {
            const queryBuilder = {
              orderBy: txMockOrderBy,
              limit: mockLimit,
              then: (resolve: (value: typeof sampleTools) => void) => {
                resolve(sampleTools)
                return queryBuilder
              },
              catch: (reject: (error: Error) => void) => queryBuilder,
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

    vi.doMock('@sim/db/schema', () => ({
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

    vi.doMock('@/lib/auth', () => ({
      getSession: vi.fn().mockResolvedValue(mockSession),
    }))

    vi.doMock('@/lib/auth/hybrid', () => ({
      checkSessionOrInternalAuth: vi.fn().mockResolvedValue({
        success: true,
        userId: 'user-123',
        authType: 'session',
      }),
    }))

    vi.doMock('@/lib/workspaces/permissions/utils', () => ({
      getUserEntityPermissions: vi.fn().mockResolvedValue('admin'),
    }))

    vi.doMock('@sim/logger', () => loggerMock)

    vi.doMock('drizzle-orm', async () => {
      const actual = await vi.importActual('drizzle-orm')
      return {
        ...(actual as object),
        eq: vi.fn().mockImplementation((field, value) => ({ field, value, operator: 'eq' })),
        and: vi.fn().mockImplementation((...conditions) => ({ operator: 'and', conditions })),
        or: vi.fn().mockImplementation((...conditions) => ({ operator: 'or', conditions })),
        isNull: vi.fn().mockImplementation((field) => ({ field, operator: 'isNull' })),
        ne: vi.fn().mockImplementation((field, value) => ({ field, value, operator: 'ne' })),
        desc: vi.fn().mockImplementation((field) => ({ field, operator: 'desc' })),
      }
    })

    vi.doMock('@/lib/core/utils/request', () => ({
      generateRequestId: vi.fn().mockReturnValue('test-request-id'),
    }))

    vi.doMock('@/lib/workflows/custom-tools/operations', () => ({
      upsertCustomTools: vi.fn().mockResolvedValue(sampleTools),
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
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

      const { GET } = await import('@/app/api/tools/custom/route')

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

      vi.doMock('@/lib/auth/hybrid', () => ({
        checkSessionOrInternalAuth: vi.fn().mockResolvedValue({
          success: false,
          error: 'Unauthorized',
        }),
      }))

      const { GET } = await import('@/app/api/tools/custom/route')

      const response = await GET(req)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data).toHaveProperty('error', 'Unauthorized')
    })

    it('should handle workflowId parameter', async () => {
      const req = new NextRequest('http://localhost:3000/api/tools/custom?workflowId=workflow-123')

      mockLimit.mockResolvedValueOnce([{ workspaceId: 'workspace-123' }])

      mockWhere.mockImplementationOnce((condition) => {
        const queryBuilder = {
          limit: mockLimit,
          then: (resolve: (value: typeof sampleTools) => void) => {
            resolve(sampleTools)
            return queryBuilder
          },
          catch: (reject: (error: Error) => void) => queryBuilder,
        }
        return queryBuilder
      })

      const { GET } = await import('@/app/api/tools/custom/route')

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
      vi.doMock('@/lib/auth/hybrid', () => ({
        checkSessionOrInternalAuth: vi.fn().mockResolvedValue({
          success: false,
          error: 'Unauthorized',
        }),
      }))

      const req = createMockRequest('POST', { tools: [], workspaceId: 'workspace-123' })

      const { POST } = await import('@/app/api/tools/custom/route')

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

      const { POST } = await import('@/app/api/tools/custom/route')

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

      const { DELETE } = await import('@/app/api/tools/custom/route')

      const response = await DELETE(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toHaveProperty('success', true)

      expect(mockDelete).toHaveBeenCalled()
      expect(mockWhere).toHaveBeenCalled()
    })

    it('should reject requests missing tool ID', async () => {
      const req = new NextRequest('http://localhost:3000/api/tools/custom')

      const { DELETE } = await import('@/app/api/tools/custom/route')

      const response = await DELETE(req)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data).toHaveProperty('error', 'Tool ID is required')
    })

    it('should handle tool not found', async () => {
      mockLimit.mockResolvedValueOnce([])

      const req = new NextRequest('http://localhost:3000/api/tools/custom?id=non-existent')

      const { DELETE } = await import('@/app/api/tools/custom/route')

      const response = await DELETE(req)
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data).toHaveProperty('error', 'Tool not found')
    })

    it('should prevent unauthorized deletion of user-scoped tool', async () => {
      vi.doMock('@/lib/auth/hybrid', () => ({
        checkSessionOrInternalAuth: vi.fn().mockResolvedValue({
          success: true,
          userId: 'user-456',
          authType: 'session',
        }),
      }))

      const userScopedTool = { ...sampleTools[0], workspaceId: null, userId: 'user-123' }
      mockLimit.mockResolvedValueOnce([userScopedTool])

      const req = new NextRequest('http://localhost:3000/api/tools/custom?id=tool-1')

      const { DELETE } = await import('@/app/api/tools/custom/route')

      const response = await DELETE(req)
      const data = await response.json()

      expect(response.status).toBe(403)
      expect(data).toHaveProperty('error', 'Access denied')
    })

    it('should reject unauthorized requests', async () => {
      vi.doMock('@/lib/auth/hybrid', () => ({
        checkSessionOrInternalAuth: vi.fn().mockResolvedValue({
          success: false,
          error: 'Unauthorized',
        }),
      }))

      const req = new NextRequest('http://localhost:3000/api/tools/custom?id=tool-1')

      const { DELETE } = await import('@/app/api/tools/custom/route')

      const response = await DELETE(req)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data).toHaveProperty('error', 'Unauthorized')
    })
  })
})
