/**
 * Integration tests for webhook trigger API route
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMockRequest,
  globalMockData,
  mockExecutionDependencies,
  mockTriggerDevSdk,
} from '@/app/api/__test-utils__/utils'

vi.mock('@trigger.dev/sdk', () => ({
  tasks: {
    trigger: vi.fn().mockResolvedValue({ id: 'mock-task-id' }),
  },
  task: vi.fn().mockReturnValue({}),
}))

vi.mock('@/background/webhook-execution', () => ({
  executeWebhookJob: vi.fn().mockResolvedValue({
    success: true,
    workflowId: 'test-workflow-id',
    executionId: 'test-exec-id',
    output: {},
    executedAt: new Date().toISOString(),
  }),
}))

vi.mock('@/background/logs-webhook-delivery', () => ({
  logsWebhookDelivery: {},
}))

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

vi.mock('@/lib/redis', () => ({
  hasProcessedMessage: hasProcessedMessageMock,
  markMessageAsProcessed: markMessageAsProcessedMock,
  closeRedisConnection: closeRedisConnectionMock,
  acquireLock: acquireLockMock,
}))

vi.mock('@/lib/webhooks/utils', () => ({
  handleWhatsAppVerification: handleWhatsAppVerificationMock,
  handleSlackChallenge: handleSlackChallengeMock,
  verifyProviderWebhook: vi.fn().mockReturnValue(null),
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

process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test'

vi.mock('drizzle-orm/postgres-js', () => ({
  drizzle: vi.fn().mockReturnValue({}),
}))

vi.mock('postgres', () => vi.fn().mockReturnValue({}))

describe('Webhook Trigger API Route', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    globalMockData.webhooks.length = 0
    globalMockData.workflows.length = 0
    globalMockData.schedules.length = 0

    mockExecutionDependencies()
    mockTriggerDevSdk()

    globalMockData.workflows.push({
      id: 'test-workflow-id',
      userId: 'test-user-id',
      workspaceId: 'test-workspace-id',
    })

    vi.doMock('@/lib/workspaces/utils', async () => {
      const actual = await vi.importActual('@/lib/workspaces/utils')
      return {
        ...(actual as Record<string, unknown>),
        getWorkspaceBilledAccountUserId: vi
          .fn()
          .mockImplementation(async (workspaceId: string | null | undefined) =>
            workspaceId ? 'test-user-id' : null
          ),
      }
    })

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
      blockExistsInDeployment: vi.fn().mockResolvedValue(true),
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

  it('should handle 404 for non-existent webhooks', async () => {
    const req = createMockRequest('POST', { event: 'test' })

    const params = Promise.resolve({ path: 'non-existent-path' })

    const { POST } = await import('@/app/api/webhooks/trigger/[path]/route')

    const response = await POST(req, { params })

    expect(response.status).toBe(404)

    const text = await response.text()
    expect(text).toMatch(/not found/i)
  })

  describe('Generic Webhook Authentication', () => {
    beforeEach(() => {
      vi.doMock('@/lib/billing/core/subscription', () => ({
        getHighestPrioritySubscription: vi.fn().mockResolvedValue({
          plan: 'pro',
          status: 'active',
        }),
      }))

      vi.doMock('@/lib/billing', () => ({
        checkServerSideUsageLimits: vi.fn().mockResolvedValue(null),
      }))
    })

    it('should process generic webhook without authentication', async () => {
      globalMockData.webhooks.push({
        id: 'generic-webhook-id',
        provider: 'generic',
        path: 'test-path',
        isActive: true,
        providerConfig: { requireAuth: false },
        workflowId: 'test-workflow-id',
        rateLimitCount: 100,
        rateLimitPeriod: 60,
      })
      globalMockData.workflows.push({
        id: 'test-workflow-id',
        userId: 'test-user-id',
        workspaceId: 'test-workspace-id',
      })

      const req = createMockRequest('POST', { event: 'test', id: 'test-123' })
      const params = Promise.resolve({ path: 'test-path' })

      const { POST } = await import('@/app/api/webhooks/trigger/[path]/route')
      const response = await POST(req, { params })

      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data.message).toBe('Webhook processed')
    })

    /**
     * Test generic webhook with Bearer token authentication
     */
    it('should authenticate with Bearer token when no custom header is configured', async () => {
      globalMockData.webhooks.push({
        id: 'generic-webhook-id',
        provider: 'generic',
        path: 'test-path',
        isActive: true,
        providerConfig: { requireAuth: true, token: 'test-token-123' },
        workflowId: 'test-workflow-id',
      })
      globalMockData.workflows.push({
        id: 'test-workflow-id',
        userId: 'test-user-id',
        workspaceId: 'test-workspace-id',
      })

      const headers = {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-token-123',
      }
      const req = createMockRequest('POST', { event: 'bearer.test' }, headers)
      const params = Promise.resolve({ path: 'test-path' })

      const { POST } = await import('@/app/api/webhooks/trigger/[path]/route')
      const response = await POST(req, { params })

      expect(response.status).toBe(200)
    })

    it('should authenticate with custom header when configured', async () => {
      globalMockData.webhooks.push({
        id: 'generic-webhook-id',
        provider: 'generic',
        path: 'test-path',
        isActive: true,
        providerConfig: {
          requireAuth: true,
          token: 'secret-token-456',
          secretHeaderName: 'X-Custom-Auth',
        },
        workflowId: 'test-workflow-id',
      })
      globalMockData.workflows.push({
        id: 'test-workflow-id',
        userId: 'test-user-id',
        workspaceId: 'test-workspace-id',
      })

      const headers = {
        'Content-Type': 'application/json',
        'X-Custom-Auth': 'secret-token-456',
      }
      const req = createMockRequest('POST', { event: 'custom.header.test' }, headers)
      const params = Promise.resolve({ path: 'test-path' })

      const { POST } = await import('@/app/api/webhooks/trigger/[path]/route')
      const response = await POST(req, { params })

      expect(response.status).toBe(200)
    })

    it('should handle case insensitive Bearer token authentication', async () => {
      globalMockData.webhooks.push({
        id: 'generic-webhook-id',
        provider: 'generic',
        path: 'test-path',
        isActive: true,
        providerConfig: { requireAuth: true, token: 'case-test-token' },
        workflowId: 'test-workflow-id',
      })
      globalMockData.workflows.push({
        id: 'test-workflow-id',
        userId: 'test-user-id',
        workspaceId: 'test-workspace-id',
      })

      vi.doMock('@trigger.dev/sdk', () => ({
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

        expect(response.status).toBe(200)
      }
    })

    it('should handle case insensitive custom header authentication', async () => {
      globalMockData.webhooks.push({
        id: 'generic-webhook-id',
        provider: 'generic',
        path: 'test-path',
        isActive: true,
        providerConfig: {
          requireAuth: true,
          token: 'custom-token-789',
          secretHeaderName: 'X-Secret-Key',
        },
        workflowId: 'test-workflow-id',
      })
      globalMockData.workflows.push({
        id: 'test-workflow-id',
        userId: 'test-user-id',
        workspaceId: 'test-workspace-id',
      })

      vi.doMock('@trigger.dev/sdk', () => ({
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

        expect(response.status).toBe(200)
      }
    })

    it('should reject wrong Bearer token', async () => {
      globalMockData.webhooks.push({
        id: 'generic-webhook-id',
        provider: 'generic',
        path: 'test-path',
        isActive: true,
        providerConfig: { requireAuth: true, token: 'correct-token' },
        workflowId: 'test-workflow-id',
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

    it('should reject wrong custom header token', async () => {
      globalMockData.webhooks.push({
        id: 'generic-webhook-id',
        provider: 'generic',
        path: 'test-path',
        isActive: true,
        providerConfig: {
          requireAuth: true,
          token: 'correct-custom-token',
          secretHeaderName: 'X-Auth-Key',
        },
        workflowId: 'test-workflow-id',
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

    it('should reject missing authentication when required', async () => {
      globalMockData.webhooks.push({
        id: 'generic-webhook-id',
        provider: 'generic',
        path: 'test-path',
        isActive: true,
        providerConfig: { requireAuth: true, token: 'required-token' },
        workflowId: 'test-workflow-id',
      })

      const req = createMockRequest('POST', { event: 'no.auth.test' })
      const params = Promise.resolve({ path: 'test-path' })

      const { POST } = await import('@/app/api/webhooks/trigger/[path]/route')
      const response = await POST(req, { params })

      expect(response.status).toBe(401)
      expect(await response.text()).toContain('Unauthorized - Invalid authentication token')
      expect(processWebhookMock).not.toHaveBeenCalled()
    })

    it('should reject Bearer token when custom header is configured', async () => {
      globalMockData.webhooks.push({
        id: 'generic-webhook-id',
        provider: 'generic',
        path: 'test-path',
        isActive: true,
        providerConfig: {
          requireAuth: true,
          token: 'exclusive-token',
          secretHeaderName: 'X-Only-Header',
        },
        workflowId: 'test-workflow-id',
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

    it('should reject wrong custom header name', async () => {
      globalMockData.webhooks.push({
        id: 'generic-webhook-id',
        provider: 'generic',
        path: 'test-path',
        isActive: true,
        providerConfig: {
          requireAuth: true,
          token: 'correct-token',
          secretHeaderName: 'X-Expected-Header',
        },
        workflowId: 'test-workflow-id',
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

    it('should reject when auth is required but no token is configured', async () => {
      globalMockData.webhooks.push({
        id: 'generic-webhook-id',
        provider: 'generic',
        path: 'test-path',
        isActive: true,
        providerConfig: { requireAuth: true },
        workflowId: 'test-workflow-id',
      })
      globalMockData.workflows.push({ id: 'test-workflow-id', userId: 'test-user-id' })

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
