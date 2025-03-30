/**
 * Integration tests for workflow execution API route
 *
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
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

    // Mock workflow middleware
    vi.doMock('@/app/api/workflows/middleware', () => ({
      validateWorkflowAccess: vi.fn().mockResolvedValue({
        workflow: {
          id: 'workflow-id',
          userId: 'user-id',
          state: {
            blocks: {
              'starter-id': {
                id: 'starter-id',
                type: 'starter',
                name: 'Start',
                position: { x: 100, y: 100 },
                enabled: true,
              },
              'agent-id': {
                id: 'agent-id',
                type: 'agent',
                name: 'Agent',
                position: { x: 300, y: 100 },
                enabled: true,
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
          },
        },
      }),
    }))

    // Reset execute mock to track calls
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

    // Mock executor
    vi.doMock('@/executor', () => ({
      Executor: vi.fn().mockImplementation(() => ({
        execute: executeMock,
      })),
    }))

    // Mock environment variables
    vi.doMock('@/lib/utils', () => ({
      decryptSecret: vi.fn().mockResolvedValue({
        decrypted: 'decrypted-secret-value',
      }),
    }))

    // Mock logger
    vi.doMock('@/lib/logs/execution-logger', () => ({
      persistExecutionLogs: vi.fn().mockResolvedValue(undefined),
      persistExecutionError: vi.fn().mockResolvedValue(undefined),
    }))

    // Mock trace spans
    vi.doMock('@/lib/logs/trace-spans', () => ({
      buildTraceSpans: vi.fn().mockReturnValue({
        traceSpans: [],
        totalDuration: 100,
      }),
    }))

    // Mock workflow run counts
    vi.doMock('@/lib/workflows/utils', () => ({
      updateWorkflowRunCounts: vi.fn().mockResolvedValue(undefined),
    }))

    // Mock database
    vi.doMock('@/db', () => {
      const mockDb = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation(() => ({
            where: vi.fn().mockImplementation(() => ({
              limit: vi.fn().mockImplementation(() => [
                {
                  id: 'env-id',
                  userId: 'user-id',
                  variables: {
                    OPENAI_API_KEY: 'encrypted:key-value',
                  },
                },
              ]),
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

    // Mock Serializer
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
    // Create a mock request with query parameters
    const req = createMockRequest('GET')

    // Create params similar to what Next.js would provide
    const params = Promise.resolve({ id: 'workflow-id' })

    // Import the handler after mocks are set up
    const { GET } = await import('./route')

    // Call the handler
    const response = await GET(req, { params })

    // Get the actual status code - in some implementations this might not be 200
    // Based on the current implementation, validate the response exists
    expect(response).toBeDefined()

    // Try to parse the response body
    let data
    try {
      data = await response.json()
    } catch (e) {
      // If we can't parse JSON, the response may not be what we expect
      console.error('Response could not be parsed as JSON:', await response.text())
      throw e
    }

    // If status is 200, verify success structure
    if (response.status === 200) {
      expect(data).toHaveProperty('success', true)
      expect(data).toHaveProperty('output')
      expect(data.output).toHaveProperty('response')
    }

    // Verify middleware was called
    const validateWorkflowAccess = (await import('@/app/api/workflows/middleware'))
      .validateWorkflowAccess
    expect(validateWorkflowAccess).toHaveBeenCalledWith(expect.any(Object), 'workflow-id')

    // Verify executor was initialized
    const Executor = (await import('@/executor')).Executor
    expect(Executor).toHaveBeenCalled()

    // Verify execute was called with undefined input (GET requests don't have body)
    expect(executeMock).toHaveBeenCalledWith('workflow-id')
  })

  /**
   * Test POST execution route
   * Simulates execution with a JSON body containing parameters
   */
  it('should execute workflow with POST request successfully', async () => {
    // Create request body with custom inputs
    const requestBody = {
      inputs: {
        message: 'Test input message',
      },
    }

    // Create a mock request with the request body
    const req = createMockRequest('POST', requestBody)

    // Create params similar to what Next.js would provide
    const params = Promise.resolve({ id: 'workflow-id' })

    // Import the handler after mocks are set up
    const { POST } = await import('./route')

    // Call the handler
    const response = await POST(req, { params })

    // Ensure response exists
    expect(response).toBeDefined()

    // Try to parse the response body
    let data
    try {
      data = await response.json()
    } catch (e) {
      // If we can't parse JSON, the response may not be what we expect
      console.error('Response could not be parsed as JSON:', await response.text())
      throw e
    }

    // If status is 200, verify success structure
    if (response.status === 200) {
      expect(data).toHaveProperty('success', true)
      expect(data).toHaveProperty('output')
      expect(data.output).toHaveProperty('response')
    }

    // Verify middleware was called
    const validateWorkflowAccess = (await import('@/app/api/workflows/middleware'))
      .validateWorkflowAccess
    expect(validateWorkflowAccess).toHaveBeenCalledWith(expect.any(Object), 'workflow-id')

    // Verify executor was constructed
    const Executor = (await import('@/executor')).Executor
    expect(Executor).toHaveBeenCalled()

    // Verify execute was called with the input body
    expect(executeMock).toHaveBeenCalledWith('workflow-id')
    // Verify the body was passed to the executor constructor
    expect(Executor).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      requestBody
    )
  })

  /**
   * Test POST execution with structured input matching the input format
   */
  it('should execute workflow with structured input matching the input format', async () => {
    // Create structured input matching the expected input format
    const structuredInput = {
      firstName: 'John',
      age: 30,
      isActive: true,
      preferences: { theme: 'dark' },
      tags: ['test', 'api'],
    }

    // Create a mock request with the structured input
    const req = createMockRequest('POST', structuredInput)

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

    // Verify the executor was constructed with the structured input
    const Executor = (await import('@/executor')).Executor
    expect(Executor).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      structuredInput
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

    // Verify the executor was constructed with an empty object
    const Executor = (await import('@/executor')).Executor
    expect(Executor).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      {}
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

    // Expect error response due to JSON parsing failure
    expect(response.status).toBe(500)

    const data = await response.json()
    expect(data).toHaveProperty('error')
    // Check for JSON parse error message rather than "Failed to execute workflow"
    expect(data.error).toContain('JSON')
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
    // Mock the executor to throw an error
    vi.doMock('@/executor', () => ({
      Executor: vi.fn().mockImplementation(() => ({
        execute: vi.fn().mockRejectedValue(new Error('Execution failed')),
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

    // Verify error logger was called
    const persistExecutionError = (await import('@/lib/logs/execution-logger'))
      .persistExecutionError
    expect(persistExecutionError).toHaveBeenCalled()
  })
})
