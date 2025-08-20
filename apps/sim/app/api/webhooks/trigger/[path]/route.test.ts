import { NextRequest } from 'next/server'
/**
 * Integration tests for webhook trigger API route
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockRequest, mockExecutionDependencies } from '@/app/api/__test-utils__/utils'

const hasProcessedMessageMock = vi.fn().mockResolvedValue(false)
const markMessageAsProcessedMock = vi.fn().mockResolvedValue(true)
const closeRedisConnectionMock = vi.fn().mockResolvedValue(undefined)
const acquireLockMock = vi.fn().mockResolvedValue(true)
const generateRequestHashMock = vi.fn().mockResolvedValue('test-hash-123')
const validateSlackSignatureMock = vi.fn().mockResolvedValue(true)
const handleWhatsAppVerificationMock = vi.fn().mockResolvedValue(null)
const handleSlackChallengeMock = vi.fn().mockReturnValue(null)
const processWhatsAppDeduplicationMock = vi.fn().mockResolvedValue(null)
const processGenericDeduplicationMock = vi.fn().mockResolvedValue(null)
const fetchAndProcessAirtablePayloadsMock = vi.fn().mockResolvedValue(undefined)
const processWebhookMock = vi
  .fn()
  .mockResolvedValue(new Response('Webhook processed', { status: 200 }))
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

const webhookMock = {
  id: 'webhook-id-column',
  path: 'path-column',
  workflowId: 'workflow-id-column',
  isActive: 'is-active-column',
  provider: 'provider-column',
}
const workflowMock = { id: 'workflow-id-column' }

vi.mock('@/lib/redis', () => ({
  hasProcessedMessage: hasProcessedMessageMock,
  markMessageAsProcessed: markMessageAsProcessedMock,
  closeRedisConnection: closeRedisConnectionMock,
  acquireLock: acquireLockMock,
}))

vi.mock('@/lib/webhooks/utils', () => ({
  handleWhatsAppVerification: handleWhatsAppVerificationMock,
  handleSlackChallenge: handleSlackChallengeMock,
  processWhatsAppDeduplication: processWhatsAppDeduplicationMock,
  processGenericDeduplication: processGenericDeduplicationMock,
  fetchAndProcessAirtablePayloads: fetchAndProcessAirtablePayloadsMock,
  processWebhook: processWebhookMock,
}))

vi.mock('@/app/api/webhooks/utils', () => ({
  generateRequestHash: generateRequestHashMock,
}))

vi.mock('@/app/api/webhooks/utils', () => ({
  validateSlackSignature: validateSlackSignatureMock,
}))

vi.mock('@/executor', () => ({
  Executor: vi.fn().mockImplementation(() => ({
    execute: executeMock,
  })),
}))

vi.mock('@/db', () => {
  const dbMock = {
    select: vi.fn().mockImplementation((columns) => ({
      from: vi.fn().mockImplementation((table) => ({
        innerJoin: vi.fn().mockImplementation(() => ({
          where: vi.fn().mockImplementation(() => ({
            limit: vi.fn().mockImplementation(() => {
              // Return empty array by default (no webhook found)
              return []
            }),
          })),
        })),
        where: vi.fn().mockImplementation(() => ({
          limit: vi.fn().mockImplementation(() => {
            // For non-webhook queries
            return []
          }),
        })),
      })),
    })),
    update: vi.fn().mockImplementation(() => ({
      set: vi.fn().mockImplementation(() => ({
        where: vi.fn().mockResolvedValue([]),
      })),
    })),
  }

  return {
    db: dbMock,
    webhook: webhookMock,
    workflow: workflowMock,
  }
})

describe('Webhook Trigger API Route', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.resetAllMocks()

    mockExecutionDependencies()

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

    vi.doMock('@/lib/workflows/db-helpers', () => ({
      loadWorkflowFromNormalizedTables: vi.fn().mockResolvedValue({
        blocks: {},
        edges: [],
        loops: {},
        parallels: {},
        isFromNormalizedTables: true,
      }),
    }))

    hasProcessedMessageMock.mockResolvedValue(false)
    markMessageAsProcessedMock.mockResolvedValue(true)
    acquireLockMock.mockResolvedValue(true)
    handleWhatsAppVerificationMock.mockResolvedValue(null)
    processGenericDeduplicationMock.mockResolvedValue(null)
    processWebhookMock.mockResolvedValue(new Response('Webhook processed', { status: 200 }))

    if ((global as any).crypto?.randomUUID) {
      vi.spyOn(crypto, 'randomUUID').mockRestore()
    }

    vi.spyOn(crypto, 'randomUUID').mockReturnValue('mock-uuid-12345')
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  /**
   * Test WhatsApp webhook verification challenge
   * Validates that WhatsApp protocol-specific challenge-response is handled
   */
  it('should handle WhatsApp verification challenge', async () => {
    // Set up WhatsApp challenge response
    handleWhatsAppVerificationMock.mockResolvedValue(
      new Response('challenge-123', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      })
    )

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
    const { db } = await import('@/db')
    const whereMock = vi.fn().mockReturnValue([
      {
        id: 'webhook-id',
        provider: 'whatsapp',
        isActive: true,
        providerConfig: {
          verificationToken: 'test-token',
        },
      },
    ])

    // @ts-ignore - mocking the query chain
    db.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: whereMock,
      }),
    })

    // Mock the path param
    const params = Promise.resolve({ path: 'whatsapp' })

    // Import the handler after mocks are set up
    const { GET } = await import('@/app/api/webhooks/trigger/[path]/route')

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
  // TODO: Fix failing test - returns 500 instead of 200
  // it('should trigger workflow execution via POST', async () => { ... })

  /**
   * Test 404 handling for non-existent webhooks
   */
  it('should handle 404 for non-existent webhooks', async () => {
    // Configure DB mock to return empty result (no webhook found)
    const { db } = await import('@/db')
    const limitMock = vi.fn().mockReturnValue([])
    const whereMock = vi.fn().mockReturnValue({ limit: limitMock })
    const innerJoinMock = vi.fn().mockReturnValue({ where: whereMock })
    const fromMock = vi.fn().mockReturnValue({ innerJoin: innerJoinMock })

    // @ts-ignore - mocking the query chain
    db.select.mockReturnValue({ from: fromMock })

    // Create a mock request
    const req = createMockRequest('POST', { event: 'test' })

    // Mock the path param
    const params = Promise.resolve({ path: 'non-existent-path' })

    // Import the handler after mocks are set up
    const { POST } = await import('@/app/api/webhooks/trigger/[path]/route')

    // Call the handler
    const response = await POST(req, { params })

    // Check response - expect 404 since our implementation returns 404 when webhook is not found
    expect(response.status).toBe(404)

    // Parse the response body
    const text = await response.text()
    expect(text).toMatch(/not found/i) // Response should contain "not found" message
  })

  describe('Generic Webhook Authentication', () => {
    const setupGenericWebhook = async (config: Record<string, any>) => {
      const { db } = await import('@/db')
      const limitMock = vi.fn().mockReturnValue([
        {
          webhook: {
            id: 'generic-webhook-id',
            provider: 'generic',
            path: 'test-path',
            isActive: true,
            providerConfig: config,
            workflowId: 'test-workflow-id',
          },
          workflow: {
            id: 'test-workflow-id',
            userId: 'test-user-id',
            name: 'Test Workflow',
          },
        },
      ])
      const whereMock = vi.fn().mockReturnValue({ limit: limitMock })
      const innerJoinMock = vi.fn().mockReturnValue({ where: whereMock })
      const fromMock = vi.fn().mockReturnValue({ innerJoin: innerJoinMock })

      const subscriptionLimitMock = vi.fn().mockReturnValue([{ plan: 'pro' }])
      const subscriptionWhereMock = vi.fn().mockReturnValue({ limit: subscriptionLimitMock })
      const subscriptionFromMock = vi.fn().mockReturnValue({ where: subscriptionWhereMock })

      // @ts-ignore - mocking the query chain
      db.select.mockImplementation((columns: any) => {
        if (columns.plan) {
          return { from: subscriptionFromMock }
        }
        return { from: fromMock }
      })
    }

    /**
     * Test generic webhook without authentication (default behavior)
     */
    it('should process generic webhook without authentication', async () => {
      await setupGenericWebhook({ requireAuth: false })

      const req = createMockRequest('POST', { event: 'test', id: 'test-123' })
      const params = Promise.resolve({ path: 'test-path' })

      vi.doMock('@trigger.dev/sdk/v3', () => ({
        tasks: {
          trigger: vi.fn().mockResolvedValue({ id: 'mock-task-id' }),
        },
      }))

      const { POST } = await import('@/app/api/webhooks/trigger/[path]/route')
      const response = await POST(req, { params })

      // Authentication passed if we don't get 401
      expect(response.status).not.toBe(401)
    })

    /**
     * Test generic webhook with Bearer token authentication (no custom header)
     */
    it('should authenticate with Bearer token when no custom header is configured', async () => {
      await setupGenericWebhook({
        requireAuth: true,
        token: 'test-token-123',
        // No secretHeaderName - should default to Bearer
      })

      const headers = {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-token-123',
      }
      const req = createMockRequest('POST', { event: 'bearer.test' }, headers)
      const params = Promise.resolve({ path: 'test-path' })

      vi.doMock('@trigger.dev/sdk/v3', () => ({
        tasks: {
          trigger: vi.fn().mockResolvedValue({ id: 'mock-task-id' }),
        },
      }))

      const { POST } = await import('@/app/api/webhooks/trigger/[path]/route')
      const response = await POST(req, { params })

      // Authentication passed if we don't get 401
      expect(response.status).not.toBe(401)
    })

    /**
     * Test generic webhook with custom header authentication
     */
    it('should authenticate with custom header when configured', async () => {
      await setupGenericWebhook({
        requireAuth: true,
        token: 'secret-token-456',
        secretHeaderName: 'X-Custom-Auth',
      })

      const headers = {
        'Content-Type': 'application/json',
        'X-Custom-Auth': 'secret-token-456',
      }
      const req = createMockRequest('POST', { event: 'custom.header.test' }, headers)
      const params = Promise.resolve({ path: 'test-path' })

      vi.doMock('@trigger.dev/sdk/v3', () => ({
        tasks: {
          trigger: vi.fn().mockResolvedValue({ id: 'mock-task-id' }),
        },
      }))

      const { POST } = await import('@/app/api/webhooks/trigger/[path]/route')
      const response = await POST(req, { params })

      // Authentication passed if we don't get 401
      expect(response.status).not.toBe(401)
    })

    /**
     * Test case insensitive Bearer token authentication
     */
    it('should handle case insensitive Bearer token authentication', async () => {
      await setupGenericWebhook({
        requireAuth: true,
        token: 'case-test-token',
      })

      vi.doMock('@trigger.dev/sdk/v3', () => ({
        tasks: {
          trigger: vi.fn().mockResolvedValue({ id: 'mock-task-id' }),
        },
      }))

      const testCases = [
        'Bearer case-test-token',
        'bearer case-test-token',
        'BEARER case-test-token',
        'BeArEr case-test-token',
      ]

      for (const authHeader of testCases) {
        const headers = {
          'Content-Type': 'application/json',
          Authorization: authHeader,
        }
        const req = createMockRequest('POST', { event: 'case.test' }, headers)
        const params = Promise.resolve({ path: 'test-path' })

        const { POST } = await import('@/app/api/webhooks/trigger/[path]/route')
        const response = await POST(req, { params })

        // Authentication passed if we don't get 401
        expect(response.status).not.toBe(401)
      }
    })

    /**
     * Test case insensitive custom header authentication
     */
    it('should handle case insensitive custom header authentication', async () => {
      await setupGenericWebhook({
        requireAuth: true,
        token: 'custom-token-789',
        secretHeaderName: 'X-Secret-Key',
      })

      vi.doMock('@trigger.dev/sdk/v3', () => ({
        tasks: {
          trigger: vi.fn().mockResolvedValue({ id: 'mock-task-id' }),
        },
      }))

      const testCases = ['X-Secret-Key', 'x-secret-key', 'X-SECRET-KEY', 'x-Secret-Key']

      for (const headerName of testCases) {
        const headers = {
          'Content-Type': 'application/json',
          [headerName]: 'custom-token-789',
        }
        const req = createMockRequest('POST', { event: 'custom.case.test' }, headers)
        const params = Promise.resolve({ path: 'test-path' })

        const { POST } = await import('@/app/api/webhooks/trigger/[path]/route')
        const response = await POST(req, { params })

        // Authentication passed if we don't get 401
        expect(response.status).not.toBe(401)
      }
    })

    /**
     * Test rejection of wrong Bearer token
     */
    it('should reject wrong Bearer token', async () => {
      await setupGenericWebhook({
        requireAuth: true,
        token: 'correct-token',
      })

      const headers = {
        'Content-Type': 'application/json',
        Authorization: 'Bearer wrong-token',
      }
      const req = createMockRequest('POST', { event: 'wrong.token.test' }, headers)
      const params = Promise.resolve({ path: 'test-path' })

      const { POST } = await import('@/app/api/webhooks/trigger/[path]/route')
      const response = await POST(req, { params })

      expect(response.status).toBe(401)
      expect(await response.text()).toContain('Unauthorized - Invalid authentication token')
      expect(processWebhookMock).not.toHaveBeenCalled()
    })

    /**
     * Test rejection of wrong custom header token
     */
    it('should reject wrong custom header token', async () => {
      await setupGenericWebhook({
        requireAuth: true,
        token: 'correct-custom-token',
        secretHeaderName: 'X-Auth-Key',
      })

      const headers = {
        'Content-Type': 'application/json',
        'X-Auth-Key': 'wrong-custom-token',
      }
      const req = createMockRequest('POST', { event: 'wrong.custom.test' }, headers)
      const params = Promise.resolve({ path: 'test-path' })

      const { POST } = await import('@/app/api/webhooks/trigger/[path]/route')
      const response = await POST(req, { params })

      expect(response.status).toBe(401)
      expect(await response.text()).toContain('Unauthorized - Invalid authentication token')
      expect(processWebhookMock).not.toHaveBeenCalled()
    })

    /**
     * Test rejection of missing authentication
     */
    it('should reject missing authentication when required', async () => {
      await setupGenericWebhook({
        requireAuth: true,
        token: 'required-token',
      })

      const req = createMockRequest('POST', { event: 'no.auth.test' })
      const params = Promise.resolve({ path: 'test-path' })

      const { POST } = await import('@/app/api/webhooks/trigger/[path]/route')
      const response = await POST(req, { params })

      expect(response.status).toBe(401)
      expect(await response.text()).toContain('Unauthorized - Invalid authentication token')
      expect(processWebhookMock).not.toHaveBeenCalled()
    })

    /**
     * Test exclusivity - Bearer token should be rejected when custom header is configured
     */
    it('should reject Bearer token when custom header is configured', async () => {
      await setupGenericWebhook({
        requireAuth: true,
        token: 'exclusive-token',
        secretHeaderName: 'X-Only-Header',
      })

      const headers = {
        'Content-Type': 'application/json',
        Authorization: 'Bearer exclusive-token', // Correct token but wrong header type
      }
      const req = createMockRequest('POST', { event: 'exclusivity.test' }, headers)
      const params = Promise.resolve({ path: 'test-path' })

      const { POST } = await import('@/app/api/webhooks/trigger/[path]/route')
      const response = await POST(req, { params })

      expect(response.status).toBe(401)
      expect(await response.text()).toContain('Unauthorized - Invalid authentication token')
      expect(processWebhookMock).not.toHaveBeenCalled()
    })

    /**
     * Test wrong custom header name is rejected
     */
    it('should reject wrong custom header name', async () => {
      await setupGenericWebhook({
        requireAuth: true,
        token: 'correct-token',
        secretHeaderName: 'X-Expected-Header',
      })

      const headers = {
        'Content-Type': 'application/json',
        'X-Wrong-Header': 'correct-token', // Correct token but wrong header name
      }
      const req = createMockRequest('POST', { event: 'wrong.header.name.test' }, headers)
      const params = Promise.resolve({ path: 'test-path' })

      const { POST } = await import('@/app/api/webhooks/trigger/[path]/route')
      const response = await POST(req, { params })

      expect(response.status).toBe(401)
      expect(await response.text()).toContain('Unauthorized - Invalid authentication token')
      expect(processWebhookMock).not.toHaveBeenCalled()
    })

    /**
     * Test authentication required but no token configured
     */
    it('should reject when auth is required but no token is configured', async () => {
      await setupGenericWebhook({
        requireAuth: true,
        // No token configured
      })

      const headers = {
        'Content-Type': 'application/json',
        Authorization: 'Bearer any-token',
      }
      const req = createMockRequest('POST', { event: 'no.token.config.test' }, headers)
      const params = Promise.resolve({ path: 'test-path' })

      const { POST } = await import('@/app/api/webhooks/trigger/[path]/route')
      const response = await POST(req, { params })

      expect(response.status).toBe(401)
      expect(await response.text()).toContain(
        'Unauthorized - Authentication required but not configured'
      )
      expect(processWebhookMock).not.toHaveBeenCalled()
    })
  })
})
