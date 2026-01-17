/**
 * Integration tests for webhook trigger API route
 *
 * @vitest-environment node
 */
import { createMockRequest, loggerMock } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** Mock execution dependencies for webhook tests */
function mockExecutionDependencies() {
  vi.mock('@/lib/core/security/encryption', () => ({
    decryptSecret: vi.fn().mockResolvedValue({ decrypted: 'decrypted-value' }),
  }))

  vi.mock('@/lib/logs/execution/trace-spans/trace-spans', () => ({
    buildTraceSpans: vi.fn().mockReturnValue({ traceSpans: [], totalDuration: 100 }),
  }))

  vi.mock('@/lib/workflows/utils', () => ({
    updateWorkflowRunCounts: vi.fn().mockResolvedValue(undefined),
  }))

  vi.mock('@/serializer', () => ({
    Serializer: vi.fn().mockImplementation(() => ({
      serializeWorkflow: vi.fn().mockReturnValue({
        version: '1.0',
        blocks: [
          {
            id: 'starter-id',
            metadata: { id: 'starter', name: 'Start' },
            config: {},
            inputs: {},
            outputs: {},
            position: { x: 100, y: 100 },
            enabled: true,
          },
          {
            id: 'agent-id',
            metadata: { id: 'agent', name: 'Agent 1' },
            config: {},
            inputs: {},
            outputs: {},
            position: { x: 634, y: -167 },
            enabled: true,
          },
        ],
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
      }),
    })),
  }))
}

/** Mock Trigger.dev SDK */
function mockTriggerDevSdk() {
  vi.mock('@trigger.dev/sdk', () => ({
    tasks: { trigger: vi.fn().mockResolvedValue({ id: 'mock-task-id' }) },
    task: vi.fn().mockReturnValue({}),
  }))
}

/**
 * Test data store - isolated per test via beforeEach reset
 * This replaces the global mutable state pattern with local test data
 */
const testData = {
  webhooks: [] as Array<{
    id: string
    provider: string
    path: string
    isActive: boolean
    providerConfig?: Record<string, unknown>
    workflowId: string
    rateLimitCount?: number
    rateLimitPeriod?: number
  }>,
  workflows: [] as Array<{
    id: string
    userId: string
    workspaceId?: string
  }>,
}

const {
  generateRequestHashMock,
  validateSlackSignatureMock,
  handleWhatsAppVerificationMock,
  handleSlackChallengeMock,
  processWhatsAppDeduplicationMock,
  processGenericDeduplicationMock,
  fetchAndProcessAirtablePayloadsMock,
  processWebhookMock,
  executeMock,
} = vi.hoisted(() => ({
  generateRequestHashMock: vi.fn().mockResolvedValue('test-hash-123'),
  validateSlackSignatureMock: vi.fn().mockResolvedValue(true),
  handleWhatsAppVerificationMock: vi.fn().mockResolvedValue(null),
  handleSlackChallengeMock: vi.fn().mockReturnValue(null),
  processWhatsAppDeduplicationMock: vi.fn().mockResolvedValue(null),
  processGenericDeduplicationMock: vi.fn().mockResolvedValue(null),
  fetchAndProcessAirtablePayloadsMock: vi.fn().mockResolvedValue(undefined),
  processWebhookMock: vi.fn().mockResolvedValue(new Response('Webhook processed', { status: 200 })),
  executeMock: vi.fn().mockResolvedValue({
    success: true,
    output: { response: 'Webhook execution success' },
    logs: [],
    metadata: {
      duration: 100,
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString(),
    },
  }),
}))

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
  validateSlackSignature: validateSlackSignatureMock,
}))

vi.mock('@/executor', () => ({
  Executor: vi.fn().mockImplementation(() => ({
    execute: executeMock,
  })),
}))

vi.mock('@/lib/execution/preprocessing', () => ({
  preprocessExecution: vi.fn().mockResolvedValue({
    success: true,
    actorUserId: 'test-user-id',
    workflowRecord: {
      id: 'test-workflow-id',
      userId: 'test-user-id',
      isDeployed: true,
      workspaceId: 'test-workspace-id',
    },
    userSubscription: {
      plan: 'pro',
      status: 'active',
    },
    rateLimitInfo: {
      allowed: true,
      remaining: 100,
      resetAt: new Date(),
    },
  }),
}))

vi.mock('@/lib/logs/execution/logging-session', () => ({
  LoggingSession: vi.fn().mockImplementation(() => ({
    safeStart: vi.fn().mockResolvedValue(undefined),
    safeCompleteWithError: vi.fn().mockResolvedValue(undefined),
  })),
}))

vi.mock('@/lib/workspaces/utils', async () => {
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

vi.mock('@/lib/core/rate-limiter', () => ({
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

vi.mock('@/lib/workflows/persistence/utils', () => ({
  loadWorkflowFromNormalizedTables: vi.fn().mockResolvedValue({
    blocks: {},
    edges: [],
    loops: {},
    parallels: {},
    isFromNormalizedTables: true,
  }),
  blockExistsInDeployment: vi.fn().mockResolvedValue(true),
}))

vi.mock('@/lib/webhooks/processor', () => ({
  findAllWebhooksForPath: vi.fn().mockImplementation(async (options: { path: string }) => {
    // Filter webhooks by path from testData
    const matchingWebhooks = testData.webhooks.filter(
      (wh) => wh.path === options.path && wh.isActive
    )

    if (matchingWebhooks.length === 0) {
      return []
    }

    // Return array of {webhook, workflow} objects
    return matchingWebhooks.map((wh) => {
      const matchingWorkflow = testData.workflows.find((w) => w.id === wh.workflowId) || {
        id: wh.workflowId || 'test-workflow-id',
        userId: 'test-user-id',
        workspaceId: 'test-workspace-id',
      }
      return {
        webhook: wh,
        workflow: matchingWorkflow,
      }
    })
  }),
  parseWebhookBody: vi.fn().mockImplementation(async (request: any) => {
    try {
      const cloned = request.clone()
      const rawBody = await cloned.text()
      const body = rawBody ? JSON.parse(rawBody) : {}
      return { body, rawBody }
    } catch {
      return { body: {}, rawBody: '' }
    }
  }),
  handleProviderChallenges: vi.fn().mockResolvedValue(null),
  handleProviderReachabilityTest: vi.fn().mockReturnValue(null),
  verifyProviderAuth: vi
    .fn()
    .mockImplementation(
      async (
        foundWebhook: any,
        _foundWorkflow: any,
        request: any,
        _rawBody: string,
        _requestId: string
      ) => {
        // Implement generic webhook auth verification for tests
        if (foundWebhook.provider === 'generic') {
          const providerConfig = foundWebhook.providerConfig || {}
          if (providerConfig.requireAuth) {
            const configToken = providerConfig.token
            const secretHeaderName = providerConfig.secretHeaderName

            if (configToken) {
              let isTokenValid = false

              if (secretHeaderName) {
                // Custom header auth
                const headerValue = request.headers.get(secretHeaderName.toLowerCase())
                if (headerValue === configToken) {
                  isTokenValid = true
                }
              } else {
                // Bearer token auth
                const authHeader = request.headers.get('authorization')
                if (authHeader?.toLowerCase().startsWith('bearer ')) {
                  const token = authHeader.substring(7)
                  if (token === configToken) {
                    isTokenValid = true
                  }
                }
              }

              if (!isTokenValid) {
                const { NextResponse } = await import('next/server')
                return new NextResponse('Unauthorized - Invalid authentication token', {
                  status: 401,
                })
              }
            } else {
              // Auth required but no token configured
              const { NextResponse } = await import('next/server')
              return new NextResponse('Unauthorized - Authentication required but not configured', {
                status: 401,
              })
            }
          }
        }
        return null
      }
    ),
  checkWebhookPreprocessing: vi.fn().mockResolvedValue(null),
  formatProviderErrorResponse: vi.fn().mockImplementation((_webhook, error, status) => {
    const { NextResponse } = require('next/server')
    return NextResponse.json({ error }, { status })
  }),
  shouldSkipWebhookEvent: vi.fn().mockReturnValue(false),
  handlePreDeploymentVerification: vi.fn().mockReturnValue(null),
  queueWebhookExecution: vi.fn().mockImplementation(async () => {
    // Call processWebhookMock so tests can verify it was called
    processWebhookMock()
    const { NextResponse } = await import('next/server')
    return NextResponse.json({ message: 'Webhook processed' })
  }),
}))

vi.mock('drizzle-orm/postgres-js', () => ({
  drizzle: vi.fn().mockReturnValue({}),
}))

vi.mock('postgres', () => vi.fn().mockReturnValue({}))

vi.mock('@sim/logger', () => loggerMock)

vi.mock('@/lib/core/utils/request', () => ({
  generateRequestId: vi.fn().mockReturnValue('test-request-id'),
}))

process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test'

import { POST } from '@/app/api/webhooks/trigger/[path]/route'

describe('Webhook Trigger API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Reset test data arrays
    testData.webhooks.length = 0
    testData.workflows.length = 0

    mockExecutionDependencies()
    mockTriggerDevSdk()

    // Set up default workflow for tests
    testData.workflows.push({
      id: 'test-workflow-id',
      userId: 'test-user-id',
      workspaceId: 'test-workspace-id',
    })

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

    const response = await POST(req, { params })

    expect(response.status).toBe(404)

    const text = await response.text()
    expect(text).toMatch(/not found/i)
  })

  describe('Generic Webhook Authentication', () => {
    it('should process generic webhook without authentication', async () => {
      testData.webhooks.push({
        id: 'generic-webhook-id',
        provider: 'generic',
        path: 'test-path',
        isActive: true,
        providerConfig: { requireAuth: false },
        workflowId: 'test-workflow-id',
        rateLimitCount: 100,
        rateLimitPeriod: 60,
      })
      testData.workflows.push({
        id: 'test-workflow-id',
        userId: 'test-user-id',
        workspaceId: 'test-workspace-id',
      })

      const req = createMockRequest('POST', { event: 'test', id: 'test-123' })
      const params = Promise.resolve({ path: 'test-path' })

      const response = await POST(req, { params })

      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data.message).toBe('Webhook processed')
    })

    it('should authenticate with Bearer token when no custom header is configured', async () => {
      testData.webhooks.push({
        id: 'generic-webhook-id',
        provider: 'generic',
        path: 'test-path',
        isActive: true,
        providerConfig: { requireAuth: true, token: 'test-token-123' },
        workflowId: 'test-workflow-id',
      })
      testData.workflows.push({
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

      const response = await POST(req, { params })

      expect(response.status).toBe(200)
    })

    it('should authenticate with custom header when configured', async () => {
      testData.webhooks.push({
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
      testData.workflows.push({
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

      const response = await POST(req, { params })

      expect(response.status).toBe(200)
    })

    it('should handle case insensitive Bearer token authentication', async () => {
      testData.webhooks.push({
        id: 'generic-webhook-id',
        provider: 'generic',
        path: 'test-path',
        isActive: true,
        providerConfig: { requireAuth: true, token: 'case-test-token' },
        workflowId: 'test-workflow-id',
      })
      testData.workflows.push({
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

        const response = await POST(req, { params })

        expect(response.status).toBe(200)
      }
    })

    it('should handle case insensitive custom header authentication', async () => {
      testData.webhooks.push({
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
      testData.workflows.push({
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

        const response = await POST(req, { params })

        expect(response.status).toBe(200)
      }
    })

    it('should reject wrong Bearer token', async () => {
      testData.webhooks.push({
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

      const response = await POST(req, { params })

      expect(response.status).toBe(401)
      expect(await response.text()).toContain('Unauthorized - Invalid authentication token')
      expect(processWebhookMock).not.toHaveBeenCalled()
    })

    it('should reject wrong custom header token', async () => {
      testData.webhooks.push({
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

      const response = await POST(req, { params })

      expect(response.status).toBe(401)
      expect(await response.text()).toContain('Unauthorized - Invalid authentication token')
      expect(processWebhookMock).not.toHaveBeenCalled()
    })

    it('should reject missing authentication when required', async () => {
      testData.webhooks.push({
        id: 'generic-webhook-id',
        provider: 'generic',
        path: 'test-path',
        isActive: true,
        providerConfig: { requireAuth: true, token: 'required-token' },
        workflowId: 'test-workflow-id',
      })

      const req = createMockRequest('POST', { event: 'no.auth.test' })
      const params = Promise.resolve({ path: 'test-path' })

      const response = await POST(req, { params })

      expect(response.status).toBe(401)
      expect(await response.text()).toContain('Unauthorized - Invalid authentication token')
      expect(processWebhookMock).not.toHaveBeenCalled()
    })

    it('should reject Bearer token when custom header is configured', async () => {
      testData.webhooks.push({
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
        Authorization: 'Bearer exclusive-token',
      }
      const req = createMockRequest('POST', { event: 'exclusivity.test' }, headers)
      const params = Promise.resolve({ path: 'test-path' })

      const response = await POST(req, { params })

      expect(response.status).toBe(401)
      expect(await response.text()).toContain('Unauthorized - Invalid authentication token')
      expect(processWebhookMock).not.toHaveBeenCalled()
    })

    it('should reject wrong custom header name', async () => {
      testData.webhooks.push({
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
        'X-Wrong-Header': 'correct-token',
      }
      const req = createMockRequest('POST', { event: 'wrong.header.name.test' }, headers)
      const params = Promise.resolve({ path: 'test-path' })

      const response = await POST(req, { params })

      expect(response.status).toBe(401)
      expect(await response.text()).toContain('Unauthorized - Invalid authentication token')
      expect(processWebhookMock).not.toHaveBeenCalled()
    })

    it('should reject when auth is required but no token is configured', async () => {
      testData.webhooks.push({
        id: 'generic-webhook-id',
        provider: 'generic',
        path: 'test-path',
        isActive: true,
        providerConfig: { requireAuth: true },
        workflowId: 'test-workflow-id',
      })
      testData.workflows.push({ id: 'test-workflow-id', userId: 'test-user-id' })

      const headers = {
        'Content-Type': 'application/json',
        Authorization: 'Bearer any-token',
      }
      const req = createMockRequest('POST', { event: 'no.token.config.test' }, headers)
      const params = Promise.resolve({ path: 'test-path' })

      const response = await POST(req, { params })

      expect(response.status).toBe(401)
      expect(await response.text()).toContain(
        'Unauthorized - Authentication required but not configured'
      )
      expect(processWebhookMock).not.toHaveBeenCalled()
    })
  })
})
