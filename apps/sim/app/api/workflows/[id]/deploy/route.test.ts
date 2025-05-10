/**
 * Integration tests for workflow deployment API route
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockRequest } from '@/app/api/__test-utils__/utils'

describe('Workflow Deployment API Route', () => {
  beforeEach(() => {
    vi.resetModules()

    // Mock utils
    vi.doMock('@/lib/utils', () => ({
      generateApiKey: vi.fn().mockReturnValue('sim_testkeygenerated12345'),
    }))

    // Mock UUID generation
    vi.doMock('uuid', () => ({
      v4: vi.fn().mockReturnValue('mock-uuid-1234'),
    }))

    // Mock crypto for request ID
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn().mockReturnValue('mock-request-id'),
    })

    // Mock logger
    vi.doMock('@/lib/logs/console-logger', () => ({
      createLogger: vi.fn().mockReturnValue({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      }),
    }))

    // Mock the middleware to pass validation
    vi.doMock('../../middleware', () => ({
      validateWorkflowAccess: vi.fn().mockResolvedValue({
        workflow: {
          id: 'workflow-id',
          userId: 'user-id',
        },
      }),
    }))

    // Mock the response utils
    vi.doMock('../../utils', () => ({
      createSuccessResponse: vi.fn().mockImplementation((data) => {
        return new Response(JSON.stringify(data), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
      createErrorResponse: vi.fn().mockImplementation((message, status = 500) => {
        return new Response(JSON.stringify({ error: message }), {
          status,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  /**
   * Test GET deployment status
   */
  it('should fetch deployment info successfully', async () => {
    // Mock the database with proper workflow data
    vi.doMock('@/db', () => ({
      db: {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([
                {
                  isDeployed: false,
                  deployedAt: null,
                  userId: 'user-id',
                },
              ]),
            }),
          }),
        }),
      },
    }))

    // Create a mock request
    const req = createMockRequest('GET')

    // Create params similar to what Next.js would provide
    const params = Promise.resolve({ id: 'workflow-id' })

    // Import the handler after mocks are set up
    const { GET } = await import('./route')

    // Call the handler
    const response = await GET(req, { params })

    // Check response
    expect(response.status).toBe(200)

    // Parse the response body
    const data = await response.json()

    // Verify response structure
    expect(data).toHaveProperty('isDeployed', false)
    expect(data).toHaveProperty('apiKey', null)
    expect(data).toHaveProperty('deployedAt', null)
  })

  /**
   * Test POST deployment with no existing API key
   * This should generate a new API key
   */
  it('should create new API key when deploying workflow for user with no API key', async () => {
    // Mock DB for this test
    const mockInsert = vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue(undefined),
    })

    const mockUpdate = vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: 'workflow-id' }]),
      }),
    })

    vi.doMock('@/db', () => ({
      db: {
        select: vi
          .fn()
          .mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([
                  {
                    userId: 'user-id',
                  },
                ]),
              }),
            }),
          })
          .mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([]), // No existing API key
              }),
            }),
          }),
        insert: mockInsert,
        update: mockUpdate,
      },
    }))

    // Create a mock request
    const req = createMockRequest('POST')

    // Create params
    const params = Promise.resolve({ id: 'workflow-id' })

    // Import required modules after mocks are set up
    const { POST } = await import('./route')

    // Call the handler
    const response = await POST(req, { params })

    // Check response
    expect(response.status).toBe(200)

    // Parse the response body
    const data = await response.json()

    // Verify API key was generated
    expect(data).toHaveProperty('apiKey', 'sim_testkeygenerated12345')
    expect(data).toHaveProperty('isDeployed', true)
    expect(data).toHaveProperty('deployedAt')

    // Verify database calls
    expect(mockInsert).toHaveBeenCalled()
    expect(mockUpdate).toHaveBeenCalled()
  })

  /**
   * Test POST deployment with existing API key
   * This should use the existing API key
   */
  it('should use existing API key when deploying workflow', async () => {
    // Mock DB for this test
    const mockInsert = vi.fn()

    const mockUpdate = vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: 'workflow-id' }]),
      }),
    })

    vi.doMock('@/db', () => ({
      db: {
        select: vi
          .fn()
          .mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([
                  {
                    userId: 'user-id',
                  },
                ]),
              }),
            }),
          })
          .mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([
                  {
                    key: 'sim_existingtestapikey12345',
                  },
                ]), // Existing API key
              }),
            }),
          }),
        insert: mockInsert,
        update: mockUpdate,
      },
    }))

    // Create a mock request
    const req = createMockRequest('POST')

    // Create params
    const params = Promise.resolve({ id: 'workflow-id' })

    // Import required modules after mocks are set up
    const { POST } = await import('./route')

    // Call the handler
    const response = await POST(req, { params })

    // Check response
    expect(response.status).toBe(200)

    // Parse the response body
    const data = await response.json()

    // Verify existing API key was used
    expect(data).toHaveProperty('apiKey', 'sim_existingtestapikey12345')
    expect(data).toHaveProperty('isDeployed', true)

    // Verify database calls - should NOT have inserted a new API key
    expect(mockInsert).not.toHaveBeenCalled()
    expect(mockUpdate).toHaveBeenCalled()
  })

  /**
   * Test DELETE undeployment
   */
  it('should undeploy workflow successfully', async () => {
    // Mock the DB for this test
    const mockUpdate = vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: 'workflow-id' }]),
      }),
    })

    vi.doMock('@/db', () => ({
      db: {
        update: mockUpdate,
      },
    }))

    // Create a mock request
    const req = createMockRequest('DELETE')

    // Create params
    const params = Promise.resolve({ id: 'workflow-id' })

    // Import the handler after mocks are set up
    const { DELETE } = await import('./route')

    // Call the handler
    const response = await DELETE(req, { params })

    // Check response
    expect(response.status).toBe(200)

    // Parse the response body
    const data = await response.json()

    // Verify response structure
    expect(data).toHaveProperty('isDeployed', false)
    expect(data).toHaveProperty('deployedAt', null)
    expect(data).toHaveProperty('apiKey', null)

    // Verify database calls
    expect(mockUpdate).toHaveBeenCalled()
  })

  /**
   * Test error handling
   */
  it('should handle errors when workflow is not found', async () => {
    // Mock middleware to simulate an error
    vi.doMock('../../middleware', () => ({
      validateWorkflowAccess: vi.fn().mockResolvedValue({
        error: {
          message: 'Workflow not found',
          status: 404,
        },
      }),
    }))

    // Create a mock request
    const req = createMockRequest('POST')

    // Create params with an invalid ID
    const params = Promise.resolve({ id: 'invalid-id' })

    // Import the handler after mocks are set up
    const { POST } = await import('./route')

    // Call the handler
    const response = await POST(req, { params })

    // Check response
    expect(response.status).toBe(404)

    // Parse the response body
    const data = await response.json()

    // Verify error message
    expect(data).toHaveProperty('error', 'Workflow not found')
  })

  /**
   * Test unauthorized access
   */
  it('should handle unauthorized access to workflow', async () => {
    // Mock middleware to simulate unauthorized access
    vi.doMock('../../middleware', () => ({
      validateWorkflowAccess: vi.fn().mockResolvedValue({
        error: {
          message: 'Unauthorized access',
          status: 403,
        },
      }),
    }))

    // Create a mock request
    const req = createMockRequest('POST')

    // Create params
    const params = Promise.resolve({ id: 'workflow-id' })

    // Import the handler after mocks are set up
    const { POST } = await import('./route')

    // Call the handler
    const response = await POST(req, { params })

    // Check response
    expect(response.status).toBe(403)

    // Parse the response body
    const data = await response.json()

    // Verify error message
    expect(data).toHaveProperty('error', 'Unauthorized access')
  })
})
