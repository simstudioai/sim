/**
 * Tests for custom tools API routes
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createMockRequest } from '@/app/api/__test-utils__/utils'

describe('Custom Tools API Routes', () => {
  // Sample data for testing
  const sampleTools = [
    {
      id: 'tool-1',
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
    mockWhere.mockReturnValue({ limit: mockLimit })
    mockLimit.mockResolvedValue(sampleTools)
    mockInsert.mockReturnValue({ values: mockValues })
    mockValues.mockResolvedValue({ id: 'new-tool-id' })
    mockUpdate.mockReturnValue({ set: mockSet })
    mockSet.mockReturnValue({ where: mockWhere })
    mockDelete.mockReturnValue({ where: mockWhere })

    // Mock database
    vi.doMock('@/db', () => ({
      db: {
        select: mockSelect,
        insert: mockInsert,
        update: mockUpdate,
        delete: mockDelete,
        transaction: vi.fn().mockImplementation(async (callback) => {
          // Execute the callback with a transaction object that has the same methods
          return await callback({
            select: mockSelect,
            insert: mockInsert,
            update: mockUpdate,
            delete: mockDelete,
          })
        }),
      },
    }))

    // Mock schema
    vi.doMock('@/db/schema', () => ({
      customTools: {
        userId: 'userId', // Add these properties to enable WHERE clauses with eq()
        id: 'id',
      },
    }))

    // Mock authentication
    vi.doMock('@/lib/auth', () => ({
      getSession: vi.fn().mockResolvedValue(mockSession),
    }))

    // Mock getUserId
    vi.doMock('@/app/api/auth/oauth/utils', () => ({
      getUserId: vi.fn().mockResolvedValue('user-123'),
    }))

    // Mock logger
    vi.doMock('@/lib/logs/console-logger', () => ({
      createLogger: vi.fn().mockReturnValue({
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      }),
    }))

    // Mock eq function from drizzle-orm
    vi.doMock('drizzle-orm', async () => {
      const actual = await vi.importActual('drizzle-orm')
      return {
        ...(actual as object),
        eq: vi.fn().mockImplementation((field, value) => ({ field, value, operator: 'eq' })),
      }
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  /**
   * Test GET endpoint
   */
  describe('GET /api/tools/custom', () => {
    it('should return tools for authenticated user', async () => {
      // Create mock request
      const req = createMockRequest('GET')

      // Simulate DB returning tools
      mockWhere.mockReturnValueOnce(Promise.resolve(sampleTools))

      // Import handler after mocks are set up
      const { GET } = await import('./route')

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
      const req = createMockRequest('GET')

      // Mock session to return no user
      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue(null),
      }))

      // Import handler after mocks are set up
      const { GET } = await import('./route')

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

      // Import handler after mocks are set up
      const { GET } = await import('./route')

      // Call the handler
      const response = await GET(req)

      // Verify getUserId was called with correct parameters
      const getUserId = (await import('@/app/api/auth/oauth/utils')).getUserId
      expect(getUserId).toHaveBeenCalledWith(expect.any(String), 'workflow-123')

      // Verify DB query filters by user
      expect(mockWhere).toHaveBeenCalled()
    })
  })

  /**
   * Test POST endpoint
   */
  describe('POST /api/tools/custom', () => {
    it('should create new tools when IDs are not provided', async () => {
      // Create test tool data
      const newTool = {
        title: 'New Tool',
        schema: {
          type: 'function',
          function: {
            name: 'newTool',
            description: 'A brand new tool',
            parameters: {
              type: 'object',
              properties: {},
              required: [],
            },
          },
        },
        code: 'return "hello world";',
      }

      // Create mock request with new tool
      const req = createMockRequest('POST', { tools: [newTool] })

      // Import handler after mocks are set up
      const { POST } = await import('./route')

      // Call the handler
      const response = await POST(req)
      const data = await response.json()

      // Verify response
      expect(response.status).toBe(200)
      expect(data).toHaveProperty('success', true)

      // Verify insert was called with correct parameters
      expect(mockInsert).toHaveBeenCalled()
      expect(mockValues).toHaveBeenCalled()
    })

    it('should update existing tools when ID is provided', async () => {
      // Create test tool data with ID
      const updateTool = {
        id: 'tool-1',
        title: 'Updated Weather Tool',
        schema: {
          type: 'function',
          function: {
            name: 'getWeatherUpdate',
            description: 'Get updated weather information',
            parameters: {
              type: 'object',
              properties: {},
              required: [],
            },
          },
        },
        code: 'return { temperature: 75, conditions: "partly cloudy" };',
      }

      // Mock DB to find existing tool
      mockLimit.mockResolvedValueOnce([sampleTools[0]])

      // Create mock request with tool update
      const req = createMockRequest('POST', { tools: [updateTool] })

      // Import handler after mocks are set up
      const { POST } = await import('./route')

      // Call the handler
      const response = await POST(req)
      const data = await response.json()

      // Verify response
      expect(response.status).toBe(200)
      expect(data).toHaveProperty('success', true)

      // Verify update was called with correct parameters
      expect(mockUpdate).toHaveBeenCalled()
      expect(mockSet).toHaveBeenCalled()
      expect(mockWhere).toHaveBeenCalled()
    })

    it('should reject unauthorized requests', async () => {
      // Mock session to return no user
      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue(null),
      }))

      // Create mock request
      const req = createMockRequest('POST', { tools: [] })

      // Import handler after mocks are set up
      const { POST } = await import('./route')

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

      // Create mock request with invalid tool
      const req = createMockRequest('POST', { tools: [invalidTool] })

      // Import handler after mocks are set up
      const { POST } = await import('./route')

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
    it('should delete a tool by ID', async () => {
      // Mock finding existing tool
      mockLimit.mockResolvedValueOnce([sampleTools[0]])

      // Create mock request with ID parameter
      const req = new NextRequest('http://localhost:3000/api/tools/custom?id=tool-1')

      // Import handler after mocks are set up
      const { DELETE } = await import('./route')

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
      const { DELETE } = await import('./route')

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
      const { DELETE } = await import('./route')

      // Call the handler
      const response = await DELETE(req)
      const data = await response.json()

      // Verify response
      expect(response.status).toBe(404)
      expect(data).toHaveProperty('error', 'Tool not found')
    })

    it('should prevent unauthorized deletion', async () => {
      // Mock finding tool that belongs to a different user
      const otherUserTool = { ...sampleTools[0], userId: 'different-user' }
      mockLimit.mockResolvedValueOnce([otherUserTool])

      // Create mock request
      const req = new NextRequest('http://localhost:3000/api/tools/custom?id=tool-1')

      // Import handler after mocks are set up
      const { DELETE } = await import('./route')

      // Call the handler
      const response = await DELETE(req)
      const data = await response.json()

      // Verify response
      expect(response.status).toBe(403)
      expect(data).toHaveProperty('error', 'Unauthorized')
    })

    it('should reject unauthorized requests', async () => {
      // Mock session to return no user
      vi.doMock('@/lib/auth', () => ({
        getSession: vi.fn().mockResolvedValue(null),
      }))

      // Create mock request
      const req = new NextRequest('http://localhost:3000/api/tools/custom?id=tool-1')

      // Import handler after mocks are set up
      const { DELETE } = await import('./route')

      // Call the handler
      const response = await DELETE(req)
      const data = await response.json()

      // Verify response
      expect(response.status).toBe(401)
      expect(data).toHaveProperty('error', 'Unauthorized')
    })
  })
})
