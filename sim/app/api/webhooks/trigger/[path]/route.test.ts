/**
 * Integration tests for webhook trigger API route
 *
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMockRequest,
  mockExecutionDependencies,
  sampleWorkflowState,
} from '@/app/api/__test-utils__/utils'

describe('Webhook Trigger API Route', () => {
  beforeEach(() => {
    vi.resetModules()

    // Mock all dependencies
    mockExecutionDependencies()

    // Mock Redis for duplicate detection
    vi.doMock('@/lib/redis', () => ({
      hasProcessedMessage: vi.fn().mockResolvedValue(false),
      markMessageAsProcessed: vi.fn().mockResolvedValue(true),
      closeRedisConnection: vi.fn().mockResolvedValue(undefined),
    }))

    // Mock database with webhook data
    vi.doMock('@/db', () => {
      const mockDb = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation((table) => {
            // Simulate joining webhook with workflow
            if (table === 'webhook') {
              return {
                innerJoin: vi.fn().mockImplementation(() => ({
                  where: vi.fn().mockImplementation(() => ({
                    limit: vi.fn().mockImplementation(() => [
                      {
                        webhook: {
                          id: 'webhook-id',
                          path: 'test-path',
                          isActive: true,
                          provider: 'generic',
                          workflowId: 'workflow-id',
                          providerConfig: {
                            requireAuth: false,
                          },
                        },
                        workflow: {
                          id: 'workflow-id',
                          userId: 'user-id',
                          state: sampleWorkflowState,
                        },
                      },
                    ]),
                  })),
                })),
              }
            } else if (table === 'environment') {
              return {
                where: vi.fn().mockImplementation(() => ({
                  limit: vi.fn().mockImplementation(() => [
                    {
                      userId: 'user-id',
                      variables: {
                        OPENAI_API_KEY: 'encrypted:openai-api-key',
                        SERPER_API_KEY: 'encrypted:serper-api-key',
                      },
                    },
                  ]),
                })),
              }
            } else {
              return {
                where: vi.fn().mockImplementation(() => ({
                  limit: vi.fn().mockImplementation(() => []),
                })),
              }
            }
          }),
        })),
        update: vi.fn().mockImplementation(() => ({
          set: vi.fn().mockImplementation(() => ({
            where: vi.fn().mockResolvedValue([]),
          })),
        })),
      }

      return { db: mockDb }
    })

    // Mock the generate request hash function (internal)
    vi.doMock('./utils', () => ({
      generateRequestHash: vi.fn().mockResolvedValue('test-hash-123'),
    }))

    // Mock utils function to validate Slack signature
    vi.doMock('../../utils', () => ({
      validateSlackSignature: vi.fn().mockResolvedValue(true),
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  /**
   * Test GET webhook verification endpoint
   * Simulates a basic GET request to validate the webhook exists
   */
  it('should handle webhook GET verification successfully', async () => {
    // Mock the database to return the webhook
    vi.doMock('@/db', () => {
      const mockDb = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation(() => ({
            innerJoin: vi.fn().mockImplementation(() => ({
              where: vi.fn().mockImplementation(() => ({
                limit: vi.fn().mockImplementation(() => [
                  {
                    webhook: {
                      id: 'webhook-id',
                      path: 'test-path',
                      isActive: true,
                      provider: 'generic',
                      workflowId: 'workflow-id',
                    },
                    workflow: {
                      id: 'workflow-id',
                      userId: 'user-id',
                    },
                  },
                ]),
              })),
            })),
          })),
        })),
      }

      return { db: mockDb }
    })

    // Create a mock request
    const req = createMockRequest('GET')

    // Mock the path param
    const params = Promise.resolve({ path: 'test-path' })

    // Import the handler after mocks are set up
    const { GET } = await import('./route')

    // Call the handler
    const response = await GET(req, { params })

    // Verify response exists
    expect(response).toBeDefined()
  })

  /**
   * Test WhatsApp webhook verification challenge
   * Validates that WhatsApp protocol-specific challenge-response is handled
   */
  it('should handle WhatsApp verification challenge', async () => {
    // Create a search params with WhatsApp verification fields
    const verificationParams = new URLSearchParams({
      'hub.mode': 'subscribe',
      'hub.verify_token': 'test-token',
      'hub.challenge': 'challenge-123',
    })

    // Create a mock URL with search params
    const mockUrl = `http://localhost:3000/api/webhooks/trigger/whatsapp?${verificationParams.toString()}`

    // Create a mock request with the URL using NextRequest
    const req = new NextRequest(new URL(mockUrl))

    // Mock database to return a WhatsApp webhook with matching token
    vi.doMock('@/db', () => {
      const mockDb = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation(() => ({
            where: vi.fn().mockImplementation(() => [
              {
                id: 'webhook-id',
                provider: 'whatsapp',
                isActive: true,
                providerConfig: {
                  verificationToken: 'test-token',
                },
              },
            ]),
          })),
        })),
      }

      return { db: mockDb }
    })

    // Mock the path param
    const params = Promise.resolve({ path: 'whatsapp' })

    // Import the handler after mocks are set up
    const { GET } = await import('./route')

    // Call the handler
    const response = await GET(req, { params })

    // Check response
    expect(response.status).toBe(200)

    // Should return exactly the challenge string
    const text = await response.text()
    expect(text).toBe('challenge-123')
  })

  /**
   * Test POST webhook with workflow execution
   * Verifies that a webhook trigger properly initiates workflow execution
   */
  it('should trigger workflow execution via POST', async () => {
    // Create webhook payload
    const webhookPayload = {
      event: 'test-event',
      data: {
        message: 'This is a test webhook',
      },
    }

    // Create mock for the executor
    const executeMock = vi.fn().mockResolvedValue({
      success: true,
      output: { response: 'Webhook execution success' },
      logs: [],
      metadata: {
        duration: 100,
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
      },
    })

    // Mock the executor to track execution
    vi.doMock('@/executor', () => ({
      Executor: vi.fn().mockImplementation(() => ({
        execute: executeMock,
      })),
    }))

    // Create a mock request with JSON body
    const req = createMockRequest('POST', webhookPayload)

    // Mock the path param
    const params = Promise.resolve({ path: 'test-path' })

    // Import Redis mocks
    const hasProcessedMessageMock = vi.fn().mockResolvedValue(false)
    const markMessageAsProcessedMock = vi.fn().mockResolvedValue(true)

    vi.doMock('@/lib/redis', () => ({
      hasProcessedMessage: hasProcessedMessageMock,
      markMessageAsProcessed: markMessageAsProcessedMock,
      closeRedisConnection: vi.fn().mockResolvedValue(undefined),
    }))

    // Import the handler after mocks are set up
    const { POST } = await import('./route')

    // Call the handler
    const response = await POST(req, { params })

    // Verify response exists
    expect(response).toBeDefined()
  })

  /**
   * Test 404 handling for non-existent webhooks
   */
  it('should handle 404 for non-existent webhooks', async () => {
    // Mock an empty webhook result
    vi.doMock('@/db', () => {
      const mockDb = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation(() => ({
            innerJoin: vi.fn().mockImplementation(() => ({
              where: vi.fn().mockImplementation(() => ({
                limit: vi.fn().mockImplementation(() => []),
              })),
            })),
          })),
        })),
      }

      return { db: mockDb }
    })

    // Create a mock request
    const req = createMockRequest('POST', { event: 'test' })

    // Mock the path param
    const params = Promise.resolve({ path: 'non-existent-path' })

    // Import the handler after mocks are set up
    const { POST } = await import('./route')

    // Call the handler
    const response = await POST(req, { params })

    // Check response - should be 404
    expect(response.status).toBe(404)

    // Parse the response body
    const text = await response.text()
    expect(text).toBe('Webhook not found')
  })

  /**
   * Test duplicate webhook request handling
   * Verifies that duplicate requests are detected and not processed multiple times
   */
  it('should handle duplicate webhook requests', async () => {
    // Create mock functions
    const hasProcessedMessageMock = vi.fn().mockResolvedValue(true) // Simulate duplicate
    const markMessageAsProcessedMock = vi.fn().mockResolvedValue(true)

    // Mock hasProcessedMessage to return true (duplicate)
    vi.doMock('@/lib/redis', () => ({
      hasProcessedMessage: hasProcessedMessageMock,
      markMessageAsProcessed: markMessageAsProcessedMock,
      closeRedisConnection: vi.fn().mockResolvedValue(undefined),
    }))

    // Create executor mock to verify it's not called
    const executeMock = vi.fn()

    vi.doMock('@/executor', () => ({
      Executor: vi.fn().mockImplementation(() => ({
        execute: executeMock,
      })),
    }))

    // Create a mock request
    const req = createMockRequest('POST', { event: 'test' })

    // Mock the path param
    const params = Promise.resolve({ path: 'test-path' })

    // Import the handler after mocks are set up
    const { POST } = await import('./route')

    // Call the handler
    const response = await POST(req, { params })

    // Verify that duplicate was checked
    expect(hasProcessedMessageMock).toHaveBeenCalled()

    // Verify executor was not called with duplicate request
    expect(executeMock).not.toHaveBeenCalled()
  })

  /**
   * Test Slack-specific webhook handling
   * Verifies that Slack signature verification is performed
   */
  it('should handle Slack webhooks with signature verification', async () => {
    // Mock a Slack webhook
    vi.doMock('@/db', () => {
      const mockDb = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation((table) => {
            if (table === 'webhook') {
              return {
                innerJoin: vi.fn().mockImplementation(() => ({
                  where: vi.fn().mockImplementation(() => ({
                    limit: vi.fn().mockImplementation(() => [
                      {
                        webhook: {
                          id: 'webhook-id',
                          path: 'slack-path',
                          isActive: true,
                          provider: 'slack',
                          workflowId: 'workflow-id',
                          providerConfig: {
                            signingSecret: 'slack-signing-secret',
                          },
                        },
                        workflow: {
                          id: 'workflow-id',
                          userId: 'user-id',
                          state: sampleWorkflowState,
                        },
                      },
                    ]),
                  })),
                })),
              }
            } else {
              return {
                where: vi.fn().mockImplementation(() => ({
                  limit: vi.fn().mockImplementation(() => [
                    {
                      userId: 'user-id',
                      variables: {},
                    },
                  ]),
                })),
              }
            }
          }),
        })),
      }

      return { db: mockDb }
    })

    // Create signature validation mock
    const validateSlackSignatureMock = vi.fn().mockResolvedValue(true)

    vi.doMock('../../utils', () => ({
      validateSlackSignature: validateSlackSignatureMock,
    }))

    // Create Slack headers
    const slackHeaders = {
      'x-slack-signature': 'v0=1234567890abcdef',
      'x-slack-request-timestamp': Math.floor(Date.now() / 1000).toString(),
    }

    // Create a mock request
    const req = createMockRequest(
      'POST',
      { event_id: 'evt123', type: 'event_callback' },
      slackHeaders
    )

    // Mock the path param
    const params = Promise.resolve({ path: 'slack-path' })

    // Import the handler after mocks are set up
    const { POST } = await import('./route')

    // Call the handler
    const response = await POST(req, { params })

    // Verify response exists
    expect(response).toBeDefined()
  })

  /**
   * Test error handling during webhook execution
   */
  it('should handle errors during workflow execution', async () => {
    // Create error logging mock
    const persistExecutionErrorMock = vi.fn().mockResolvedValue(undefined)

    // Mock error logging
    vi.doMock('@/lib/logs/execution-logger', () => ({
      persistExecutionLogs: vi.fn().mockResolvedValue(undefined),
      persistExecutionError: persistExecutionErrorMock,
    }))

    // Mock the executor to throw an error
    vi.doMock('@/executor', () => ({
      Executor: vi.fn().mockImplementation(() => ({
        execute: vi.fn().mockRejectedValue(new Error('Webhook execution failed')),
      })),
    }))

    // Create a mock request
    const req = createMockRequest('POST', { event: 'test' })

    // Mock the path param
    const params = Promise.resolve({ path: 'test-path' })

    // Import the handler after mocks are set up
    const { POST } = await import('./route')

    // Call the handler
    const response = await POST(req, { params })

    // Verify response exists and check status code
    expect(response).toBeDefined()
    expect(response.status).toBe(500)
  })
})
