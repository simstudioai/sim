import { NextRequest } from 'next/server'
/**
 * Tests for custom tools API routes
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockRequest } from '@/app/api/__test-utils__/utils'

describe('Custom Tools API Routes', () => {
  // Sample data for testing
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

  // Mock implementation stubs
  const mockSelect = vi.fn()
  const mockFrom = vi.fn()
  const mockWhere = vi.fn()
  const mockInsert = vi.fn()
  const mockValues = vi.fn()
  const mockUpdate = vi.fn()
  const mockSet = vi.fn()
  const mockDelete = vi.fn()
  const mockLimit = vi.fn()
  const mockSession = { user: { id: 'user-123' } }

  beforeEach(() => {
    vi.resetModules()

    // Reset all mock implementations
    mockSelect.mockReturnValue({ from: mockFrom })
    mockFrom.mockReturnValue({ where: mockWhere })
    // where() can be called with limit() or directly awaited
    // Create a mock query builder that supports both patterns
    mockWhere.mockImplementation((condition) => {
      // Return an object that is both awaitable and has a limit() method
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

    // Mock database
    vi.doMock('@sim/db', () => ({
      db: {
        select: mockSelect,
        insert: mockInsert,
        update: mockUpdate,
        delete: mockDelete,
        transaction: vi.fn().mockImplementation(async (callback) => {
          // Execute the callback with a transaction object that has the same methods
          // Create transaction-specific mocks that follow the same pattern
          const txMockSelect = vi.fn().mockReturnValue({ from: mockFrom })
          const txMockInsert = vi.fn().mockReturnValue({ values: mockValues })
          const txMockUpdate = vi.fn().mockReturnValue({ set: mockSet })
          const txMockDelete = vi.fn().mockReturnValue({ where: mockWhere })

          // Transaction where() should also support the query builder pattern
          const txMockWhere = vi.fn().mockImplementation((condition) => {
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

          // Update mockFrom to return txMockWhere for transaction queries
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

    // Mock schema
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

    // Mock authentication
    vi.doMock('@/lib/auth', () => ({
      getSession: vi.fn().mockResolvedValue(mockSession),
    }))

    // Mock hybrid auth
    vi.doMock('@/lib/auth/hybrid', () => ({
      checkHybridAuth: vi.fn().mockResolvedValue({
        success: true,
        userId: 'user-123',
        authType: 'session',
      }),
    }))

    // Mock permissions
    vi.doMock('@/lib/permissions/utils', () => ({
      getUserEntityPermissions: vi.fn().mockResolvedValue('admin'),
    }))

    // Mock logger
    vi.doMock('@/lib/logs/console/logger', () => ({
      createLogger: vi.fn().mockReturnValue({
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      }),
    }))

    // Mock drizzle-orm functions
    vi.doMock('drizzle-orm', async () => {
      const actual = await vi.importActual('drizzle-orm')
      return {
        ...(actual as object),
        eq: vi.fn().mockImplementation((field, value) => ({ field, value, operator: 'eq' })),
        and: vi.fn().mockImplementation((...conditions) => ({ operator: 'and', conditions })),
        or: vi.fn().mockImplementation((...conditions) => ({ operator: 'or', conditions })),
        isNull: vi.fn().mockImplementation((field) => ({ field, operator: 'isNull' })),
        ne: vi.fn().mockImplementation((field, value) => ({ field, value, operator: 'ne' })),
      }
    })

    // Mock utils
    vi.doMock('@/lib/utils', () => ({
      generateRequestId: vi.fn().mockReturnValue('test-request-id'),
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
      // Create mock request with workspaceId
      const req = new NextRequest(
        'http://localhost:3000/api/tools/custom?workspaceId=workspace-123'
      )

      // Simulate DB returning tools
      mockWhere.mockReturnValueOnce(Promise.resolve(sampleTools))

      // Import handler after mocks are set up
      const { GET } = await import('@/app/api/tools/custom/route')

      // Call the handler
      const response = await GET(req)
      const data = await response.json()

      // Verify response
      expect(response.status).toBe(200)
      expect(data).toHaveProperty('data')
      expect(data.data).toEqual(sampleTools)

      // Verify DB query
      expect(mockSelect).toHaveBeenCalled()
      expect(mockFrom).toHaveBeenCalled()
      expect(mockWhere).toHaveBeenCalled()
    })

    it('should handle unauthorized access', async () => {
      // Create mock request
      const req = new NextRequest(
        'http://localhost:3000/api/tools/custom?workspaceId=workspace-123'
      )

      // Mock hybrid auth to return unauthorized
      vi.doMock('@/lib/auth/hybrid', () => ({
        checkHybridAuth: vi.fn().mockResolvedValue({
          success: false,
          error: 'Unauthorized',
        }),
      }))

      // Import handler after mocks are set up
      const { GET } = await import('@/app/api/tools/custom/route')

      // Call the handler
      const response = await GET(req)
      const data = await response.json()

      // Verify response
      expect(response.status).toBe(401)
      expect(data).toHaveProperty('error', 'Unauthorized')
    })

    it('should handle workflowId parameter', async () => {
      // Create mock request with workflowId parameter
      const req = new NextRequest('http://localhost:3000/api/tools/custom?workflowId=workflow-123')

      // Mock workflow lookup to return workspaceId (for limit(1) call)
      mockLimit.mockResolvedValueOnce([{ workspaceId: 'workspace-123' }])

      // Mock the where() call for fetching tools (returns awaitable query builder)
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

      // Import handler after mocks are set up
      const { GET } = await import('@/app/api/tools/custom/route')

      // Call the handler
      const response = await GET(req)
      const data = await response.json()

      // Verify response
      expect(response.status).toBe(200)
      expect(data).toHaveProperty('data')

      // Verify DB query was called
      expect(mockWhere).toHaveBeenCalled()
    })
  })

  /**
   * Test POST endpoint
   */
  describe('POST /api/tools/custom', () => {
    it('should reject unauthorized requests', async () => {
      // Mock hybrid auth to return unauthorized
      vi.doMock('@/lib/auth/hybrid', () => ({
        checkHybridAuth: vi.fn().mockResolvedValue({
          success: false,
          error: 'Unauthorized',
        }),
      }))

      // Create mock request
      const req = createMockRequest('POST', { tools: [], workspaceId: 'workspace-123' })

      // Import handler after mocks are set up
      const { POST } = await import('@/app/api/tools/custom/route')

      // Call the handler
      const response = await POST(req)
      const data = await response.json()

      // Verify response
      expect(response.status).toBe(401)
      expect(data).toHaveProperty('error', 'Unauthorized')
    })

    it('should validate request data', async () => {
      // Create invalid tool data (missing required fields)
      const invalidTool = {
        // Missing title, schema
        code: 'return "invalid";',
      }

      // Create mock request with invalid tool and workspaceId
      const req = createMockRequest('POST', { tools: [invalidTool], workspaceId: 'workspace-123' })

      // Import handler after mocks are set up
      const { POST } = await import('@/app/api/tools/custom/route')

      // Call the handler
      const response = await POST(req)
      const data = await response.json()

      // Verify response
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
      // Mock finding existing workspace-scoped tool
      mockLimit.mockResolvedValueOnce([sampleTools[0]])

      // Create mock request with ID and workspaceId parameters
      const req = new NextRequest(
        'http://localhost:3000/api/tools/custom?id=tool-1&workspaceId=workspace-123'
      )

      // Import handler after mocks are set up
      const { DELETE } = await import('@/app/api/tools/custom/route')

      // Call the handler
      const response = await DELETE(req)
      const data = await response.json()

      // Verify response
      expect(response.status).toBe(200)
      expect(data).toHaveProperty('success', true)

      // Verify delete was called with correct parameters
      expect(mockDelete).toHaveBeenCalled()
      expect(mockWhere).toHaveBeenCalled()
    })

    it('should reject requests missing tool ID', async () => {
      // Create mock request without ID parameter
      const req = createMockRequest('DELETE')

      // Import handler after mocks are set up
      const { DELETE } = await import('@/app/api/tools/custom/route')

      // Call the handler
      const response = await DELETE(req)
      const data = await response.json()

      // Verify response
      expect(response.status).toBe(400)
      expect(data).toHaveProperty('error', 'Tool ID is required')
    })

    it('should handle tool not found', async () => {
      // Mock tool not found
      mockLimit.mockResolvedValueOnce([])

      // Create mock request with non-existent ID
      const req = new NextRequest('http://localhost:3000/api/tools/custom?id=non-existent')

      // Import handler after mocks are set up
      const { DELETE } = await import('@/app/api/tools/custom/route')

      // Call the handler
      const response = await DELETE(req)
      const data = await response.json()

      // Verify response
      expect(response.status).toBe(404)
      expect(data).toHaveProperty('error', 'Tool not found')
    })

    it('should prevent unauthorized deletion of user-scoped tool', async () => {
      // Mock hybrid auth for the DELETE request
      vi.doMock('@/lib/auth/hybrid', () => ({
        checkHybridAuth: vi.fn().mockResolvedValue({
          success: true,
          userId: 'user-456', // Different user
          authType: 'session',
        }),
      }))

      // Mock finding user-scoped tool (no workspaceId) that belongs to user-123
      const userScopedTool = { ...sampleTools[0], workspaceId: null, userId: 'user-123' }
      mockLimit.mockResolvedValueOnce([userScopedTool])

      // Create mock request (no workspaceId for user-scoped tool)
      const req = new NextRequest('http://localhost:3000/api/tools/custom?id=tool-1')

      // Import handler after mocks are set up
      const { DELETE } = await import('@/app/api/tools/custom/route')

      // Call the handler
      const response = await DELETE(req)
      const data = await response.json()

      // Verify response
      expect(response.status).toBe(403)
      expect(data).toHaveProperty('error', 'Access denied')
    })

    it('should reject unauthorized requests', async () => {
      // Mock hybrid auth to return unauthorized
      vi.doMock('@/lib/auth/hybrid', () => ({
        checkHybridAuth: vi.fn().mockResolvedValue({
          success: false,
          error: 'Unauthorized',
        }),
      }))

      // Create mock request
      const req = new NextRequest('http://localhost:3000/api/tools/custom?id=tool-1')

      // Import handler after mocks are set up
      const { DELETE } = await import('@/app/api/tools/custom/route')

      // Call the handler
      const response = await DELETE(req)
      const data = await response.json()

      // Verify response
      expect(response.status).toBe(401)
      expect(data).toHaveProperty('error', 'Unauthorized')
    })
  })
})
