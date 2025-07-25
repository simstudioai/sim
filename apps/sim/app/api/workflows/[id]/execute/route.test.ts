import { NextRequest } from 'next/server'
/**
 * Integration tests for workflow execution API route
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockRequest } from '@/app/api/__test-utils__/utils'

describe('Workflow Execution API Route', () => {
  let executeMock = vi.fn().mockResolvedValue({
    success: true,
    output: {
      response: 'Test response',
    },
    logs: [],
    metadata: {
      duration: 123,
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString(),
    },
  })

  beforeEach(() => {
    vi.resetModules()

    vi.doMock('@/app/api/workflows/middleware', () => ({
      validateWorkflowAccess: vi.fn().mockResolvedValue({
        workflow: {
          id: 'workflow-id',
          userId: 'user-id',
        },
      }),
    }))

    // Mock authentication
    vi.doMock('@/lib/auth', () => ({
      getSession: vi.fn().mockResolvedValue({
        user: { id: 'user-id' },
      }),
    }))

    // Mock rate limiting
    vi.doMock('@/services/queue', () => ({
      RateLimiter: vi.fn().mockImplementation(() => ({
        checkRateLimit: vi.fn().mockResolvedValue({
          allowed: true,
          remaining: 10,
          resetAt: new Date(),
        }),
      })),
      RateLimitError: class RateLimitError extends Error {
        constructor(
          message: string,
          public statusCode = 429
        ) {
          super(message)
          this.name = 'RateLimitError'
        }
      },
    }))

    // Mock billing usage check
    vi.doMock('@/lib/billing', () => ({
      checkServerSideUsageLimits: vi.fn().mockResolvedValue({
        isExceeded: false,
        currentUsage: 10,
        limit: 100,
      }),
    }))

    // Mock database subscription check
    vi.doMock('@/db/schema', () => ({
      subscription: {
        plan: 'plan',
        referenceId: 'referenceId',
      },
      apiKey: {
        userId: 'userId',
        key: 'key',
      },
      userStats: {
        userId: 'userId',
        totalApiCalls: 'totalApiCalls',
        lastActive: 'lastActive',
      },
      environment: {
        userId: 'userId',
        variables: 'variables',
      },
    }))

    vi.doMock('@/lib/workflows/db-helpers', () => ({
      loadWorkflowFromNormalizedTables: vi.fn().mockResolvedValue({
        blocks: {
          'starter-id': {
            id: 'starter-id',
            type: 'starter',
            name: 'Start',
            position: { x: 100, y: 100 },
            enabled: true,
            subBlocks: {},
            outputs: {},
            data: {},
          },
          'agent-id': {
            id: 'agent-id',
            type: 'agent',
            name: 'Agent',
            position: { x: 300, y: 100 },
            enabled: true,
            subBlocks: {},
            outputs: {},
            data: {},
          },
        },
        edges: [
          {
            id: 'edge-1',
            source: 'starter-id',
            target: 'agent-id',
            sourceHandle: 'source',
            targetHandle: 'target',
          },
        ],
        loops: {},
        parallels: {},
        isFromNormalizedTables: true,
      }),
    }))

    executeMock = vi.fn().mockResolvedValue({
      success: true,
      output: {
        response: 'Test response',
      },
      logs: [],
      metadata: {
        duration: 123,
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
      },
    })

    vi.doMock('@/executor', () => ({
      Executor: vi.fn().mockImplementation(() => ({
        execute: executeMock,
        setEnhancedLogger: vi.fn(),
      })),
    }))

    vi.doMock('@/lib/utils', () => ({
      decryptSecret: vi.fn().mockResolvedValue({
        decrypted: 'decrypted-secret-value',
      }),
      isHosted: vi.fn().mockReturnValue(false),
      getRotatingApiKey: vi.fn().mockReturnValue('rotated-api-key'),
    }))

    vi.doMock('@/lib/logs/enhanced-logging-session', () => ({
      EnhancedLoggingSession: vi.fn().mockImplementation(() => ({
        safeStart: vi.fn().mockResolvedValue(undefined),
        safeComplete: vi.fn().mockResolvedValue(undefined),
        safeCompleteWithError: vi.fn().mockResolvedValue(undefined),
        setupExecutor: vi.fn(),
      })),
    }))

    vi.doMock('@/lib/logs/enhanced-execution-logger', () => ({
      enhancedExecutionLogger: {
        startWorkflowExecution: vi.fn().mockResolvedValue(undefined),
        logBlockExecution: vi.fn().mockResolvedValue(undefined),
        completeWorkflowExecution: vi.fn().mockResolvedValue(undefined),
      },
    }))

    vi.doMock('@/lib/logs/trace-spans', () => ({
      buildTraceSpans: vi.fn().mockReturnValue({
        traceSpans: [],
        totalDuration: 100,
      }),
    }))

    vi.doMock('@/lib/workflows/utils', () => ({
      updateWorkflowRunCounts: vi.fn().mockResolvedValue(undefined),
      workflowHasResponseBlock: vi.fn().mockReturnValue(false),
      createHttpResponseFromBlock: vi.fn().mockReturnValue(new Response('OK')),
    }))

    vi.doMock('@/stores/workflows/server-utils', () => ({
      mergeSubblockState: vi.fn().mockReturnValue({
        'starter-id': {
          id: 'starter-id',
          type: 'starter',
          subBlocks: {},
        },
      }),
    }))

    vi.doMock('@/db', () => {
      const mockDb = {
        select: vi.fn().mockImplementation((columns) => ({
          from: vi.fn().mockImplementation((table) => ({
            where: vi.fn().mockImplementation(() => ({
              limit: vi.fn().mockImplementation(() => {
                // Mock subscription queries
                if (table === 'subscription' || columns?.plan) {
                  return [{ plan: 'free' }]
                }
                // Mock API key queries
                if (table === 'apiKey' || columns?.userId) {
                  return [{ userId: 'user-id' }]
                }
                // Default environment query
                return [
                  {
                    id: 'env-id',
                    userId: 'user-id',
                    variables: {
                      OPENAI_API_KEY: 'encrypted:key-value',
                    },
                  },
                ]
              }),
            })),
          })),
        })),
        update: vi.fn().mockImplementation(() => ({
          set: vi.fn().mockImplementation(() => ({
            where: vi.fn().mockResolvedValue(undefined),
          })),
        })),
      }

      return { db: mockDb }
    })

    vi.doMock('@/serializer', () => ({
      Serializer: vi.fn().mockImplementation(() => ({
        serializeWorkflow: vi.fn().mockReturnValue({
          version: '1.0',
          blocks: [],
          connections: [],
          loops: {},
        }),
      })),
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  /**
   * Test GET execution route
   * Simulates direct execution with URL-based parameters
   */
  it('should execute workflow with GET request successfully', async () => {
    const req = createMockRequest('GET')

    const params = Promise.resolve({ id: 'workflow-id' })

    const { GET } = await import('./route')

    const response = await GET(req, { params })

    expect(response).toBeDefined()

    let data
    try {
      data = await response.json()
    } catch (e) {
      console.error('Response could not be parsed as JSON:', await response.text())
      throw e
    }

    if (response.status === 200) {
      expect(data).toHaveProperty('success', true)
      expect(data).toHaveProperty('output')
      expect(data.output).toHaveProperty('response')
    }

    const validateWorkflowAccess = (await import('@/app/api/workflows/middleware'))
      .validateWorkflowAccess
    expect(validateWorkflowAccess).toHaveBeenCalledWith(expect.any(Object), 'workflow-id')

    const Executor = (await import('@/executor')).Executor
    expect(Executor).toHaveBeenCalled()

    expect(executeMock).toHaveBeenCalledWith('workflow-id')
  })

  /**
   * Test POST execution route
   * Simulates execution with a JSON body containing parameters
   */
  it('should execute workflow with POST request successfully', async () => {
    const requestBody = {
      inputs: {
        message: 'Test input message',
      },
    }

    const req = createMockRequest('POST', requestBody)

    const params = Promise.resolve({ id: 'workflow-id' })

    const { POST } = await import('./route')

    const response = await POST(req, { params })

    expect(response).toBeDefined()

    let data
    try {
      data = await response.json()
    } catch (e) {
      console.error('Response could not be parsed as JSON:', await response.text())
      throw e
    }

    if (response.status === 200) {
      expect(data).toHaveProperty('success', true)
      expect(data).toHaveProperty('output')
      expect(data.output).toHaveProperty('response')
    }

    const validateWorkflowAccess = (await import('@/app/api/workflows/middleware'))
      .validateWorkflowAccess
    expect(validateWorkflowAccess).toHaveBeenCalledWith(expect.any(Object), 'workflow-id')

    const Executor = (await import('@/executor')).Executor
    expect(Executor).toHaveBeenCalled()

    expect(executeMock).toHaveBeenCalledWith('workflow-id')

    expect(Executor).toHaveBeenCalledWith(
      expect.anything(), // serializedWorkflow
      expect.anything(), // processedBlockStates
      expect.anything(), // decryptedEnvVars
      requestBody, // processedInput (direct input, not wrapped)
      expect.anything() // workflowVariables
    )
  })

  /**
   * Test POST execution with structured input matching the input format
   */
  it('should execute workflow with structured input matching the input format', async () => {
    const structuredInput = {
      firstName: 'John',
      age: 30,
      isActive: true,
      preferences: { theme: 'dark' },
      tags: ['test', 'api'],
    }

    const req = createMockRequest('POST', structuredInput)

    const params = Promise.resolve({ id: 'workflow-id' })

    const { POST } = await import('./route')

    const response = await POST(req, { params })

    expect(response).toBeDefined()
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data).toHaveProperty('success', true)

    const Executor = (await import('@/executor')).Executor
    expect(Executor).toHaveBeenCalledWith(
      expect.anything(), // serializedWorkflow
      expect.anything(), // processedBlockStates
      expect.anything(), // decryptedEnvVars
      structuredInput, // processedInput (direct input, not wrapped)
      expect.anything() // workflowVariables
    )
  })

  /**
   * Test POST execution with empty request body
   */
  it('should execute workflow with empty request body', async () => {
    // Create a mock request with empty body
    const req = createMockRequest('POST')

    // Create params similar to what Next.js would provide
    const params = Promise.resolve({ id: 'workflow-id' })

    // Import the handler after mocks are set up
    const { POST } = await import('./route')

    // Call the handler
    const response = await POST(req, { params })

    // Ensure response exists and is successful
    expect(response).toBeDefined()
    expect(response.status).toBe(200)

    // Parse the response body
    const data = await response.json()
    expect(data).toHaveProperty('success', true)

    // Verify the executor was constructed with an empty object - updated to match implementation
    const Executor = (await import('@/executor')).Executor
    expect(Executor).toHaveBeenCalledWith(
      expect.anything(), // serializedWorkflow
      expect.anything(), // processedBlockStates
      expect.anything(), // decryptedEnvVars
      expect.objectContaining({}), // processedInput with empty input
      expect.anything() // workflowVariables
    )
  })

  /**
   * Test POST execution with invalid JSON body
   */
  it('should handle invalid JSON in request body', async () => {
    // Create a mock request with invalid JSON text
    const req = new NextRequest('https://example.com/api/workflows/workflow-id/execute', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: 'this is not valid JSON',
    })

    // Create params similar to what Next.js would provide
    const params = Promise.resolve({ id: 'workflow-id' })

    // Import the handler after mocks are set up
    const { POST } = await import('./route')

    // Call the handler - should throw an error when trying to parse the body
    const response = await POST(req, { params })

    // Updated to expect 400 as per the implementation
    expect(response.status).toBe(400)

    const data = await response.json()
    expect(data).toHaveProperty('error')
    // Check for JSON parse error message
    expect(data.error).toContain('Invalid JSON')
  })

  /**
   * Test handling of incorrect workflow ID
   */
  it('should return 403 for unauthorized workflow access', async () => {
    // Mock the middleware to return an error
    vi.doMock('@/app/api/workflows/middleware', () => ({
      validateWorkflowAccess: vi.fn().mockResolvedValue({
        error: {
          message: 'Unauthorized',
          status: 403,
        },
      }),
    }))

    // Create a mock request
    const req = createMockRequest('GET')

    // Create params with an invalid workflow ID
    const params = Promise.resolve({ id: 'invalid-workflow-id' })

    // Import the handler after mocks are set up
    const { GET } = await import('./route')

    // Call the handler
    const response = await GET(req, { params })

    // Verify status code is 403 Forbidden
    expect(response.status).toBe(403)

    // Parse the response body and verify it contains an error message
    const data = await response.json()
    expect(data).toHaveProperty('error', 'Unauthorized')
  })

  /**
   * Test handling of execution errors
   */
  it('should handle execution errors gracefully', async () => {
    // Mock enhanced execution logger with spy
    const mockCompleteWorkflowExecution = vi.fn().mockResolvedValue({})
    vi.doMock('@/lib/logs/enhanced-execution-logger', () => ({
      enhancedExecutionLogger: {
        completeWorkflowExecution: mockCompleteWorkflowExecution,
      },
    }))

    // Mock EnhancedLoggingSession with spy
    const mockSafeCompleteWithError = vi.fn().mockResolvedValue({})
    vi.doMock('@/lib/logs/enhanced-logging-session', () => ({
      EnhancedLoggingSession: vi.fn().mockImplementation(() => ({
        safeStart: vi.fn().mockResolvedValue({}),
        safeComplete: vi.fn().mockResolvedValue({}),
        safeCompleteWithError: mockSafeCompleteWithError,
        setupExecutor: vi.fn(),
      })),
    }))

    // Mock the executor to throw an error
    vi.doMock('@/executor', () => ({
      Executor: vi.fn().mockImplementation(() => ({
        execute: vi.fn().mockRejectedValue(new Error('Execution failed')),
        setEnhancedLogger: vi.fn(),
      })),
    }))

    // Create a mock request
    const req = createMockRequest('GET')

    // Create params
    const params = Promise.resolve({ id: 'workflow-id' })

    // Import the handler after mocks are set up
    const { GET } = await import('./route')

    // Call the handler
    const response = await GET(req, { params })

    // Verify status code is 500 Internal Server Error
    expect(response.status).toBe(500)

    // Parse the response body and verify it contains an error message
    const data = await response.json()
    expect(data).toHaveProperty('error')
    expect(data.error).toContain('Execution failed')

    // Verify enhanced logger was called for error completion via EnhancedLoggingSession
    expect(mockSafeCompleteWithError).toHaveBeenCalled()
  })

  /**
   * Test that workflow variables are properly passed to the Executor
   */
  it('should pass workflow variables to the Executor', async () => {
    // Create mock variables for the workflow
    const workflowVariables = {
      variable1: { id: 'var1', name: 'variable1', type: 'string', value: '"test value"' },
      variable2: { id: 'var2', name: 'variable2', type: 'boolean', value: 'true' },
    }

    // Mock workflow with variables
    vi.doMock('@/app/api/workflows/middleware', () => ({
      validateWorkflowAccess: vi.fn().mockResolvedValue({
        workflow: {
          id: 'workflow-with-vars-id',
          userId: 'user-id',
          variables: workflowVariables,
        },
      }),
    }))

    // Mock normalized tables helper for this specific test
    vi.doMock('@/lib/workflows/db-helpers', () => ({
      loadWorkflowFromNormalizedTables: vi.fn().mockResolvedValue({
        blocks: {
          'starter-id': {
            id: 'starter-id',
            type: 'starter',
            name: 'Start',
            position: { x: 100, y: 100 },
            enabled: true,
            subBlocks: {},
            outputs: {},
            data: {},
          },
          'agent-id': {
            id: 'agent-id',
            type: 'agent',
            name: 'Agent',
            position: { x: 300, y: 100 },
            enabled: true,
            subBlocks: {},
            outputs: {},
            data: {},
          },
        },
        edges: [
          {
            id: 'edge-1',
            source: 'starter-id',
            target: 'agent-id',
            sourceHandle: 'source',
            targetHandle: 'target',
          },
        ],
        loops: {},
        parallels: {},
        isFromNormalizedTables: true,
      }),
    }))

    // Create a constructor mock to capture the arguments
    const executorConstructorMock = vi.fn().mockImplementation(() => ({
      execute: vi.fn().mockResolvedValue({
        success: true,
        output: { response: 'Execution completed with variables' },
        logs: [],
        metadata: {
          duration: 100,
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
        },
      }),
    }))

    // Override the executor mock
    vi.doMock('@/executor', () => ({
      Executor: executorConstructorMock,
    }))

    // Create a mock request
    const req = createMockRequest('POST', { testInput: 'value' })

    // Create params similar to what Next.js would provide
    const params = Promise.resolve({ id: 'workflow-with-vars-id' })

    // Import the handler after mocks are set up
    const { POST } = await import('./route')

    // Call the handler
    await POST(req, { params })

    // Verify the Executor was constructed with workflow variables
    expect(executorConstructorMock).toHaveBeenCalled()

    // Check that the 5th parameter (workflow variables) was passed
    const executorCalls = executorConstructorMock.mock.calls
    expect(executorCalls.length).toBeGreaterThan(0)

    // Each call to the constructor should have at least 5 parameters
    const lastCall = executorCalls[executorCalls.length - 1]
    expect(lastCall.length).toBeGreaterThanOrEqual(5)

    // The 5th parameter should be the workflow variables
    expect(lastCall[4]).toEqual(workflowVariables)
  })
})
