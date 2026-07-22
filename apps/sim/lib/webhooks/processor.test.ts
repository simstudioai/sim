/**
 * @vitest-environment node
 */

import type { webhook, workflow } from '@sim/db/schema'
import {
  createMockRequest,
  dbChainMock,
  envFlagsMock,
  executionPreprocessingMock,
  executionPreprocessingMockFns,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
  workflowsPersistenceUtilsMock,
  workflowsPersistenceUtilsMockFns,
} from '@sim/testing'
import type { NextRequest } from 'next/server'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ADMISSION_ERROR_CODE,
  ADMISSION_RETRY_AFTER_SECONDS,
} from '@/lib/core/admission/transient-failure'

type WebhookRecord = typeof webhook.$inferSelect
type WorkflowRecord = typeof workflow.$inferSelect
type WebhookLookupRow = {
  webhook: Pick<WebhookRecord, 'id' | 'workflowId' | 'path' | 'createdAt'>
  workflow: Pick<WorkflowRecord, 'id'>
}

const {
  mockGenerateId,
  mockAdmissionRelease,
  mockEnqueue,
  mockGetJobQueue,
  mockReleaseExecutionSlot,
  mockProviderHandler,
  mockShouldExecuteInline,
} = vi.hoisted(() => ({
  mockGenerateId: vi.fn(),
  mockAdmissionRelease: vi.fn(),
  mockEnqueue: vi.fn(),
  mockGetJobQueue: vi.fn(),
  mockReleaseExecutionSlot: vi.fn(),
  mockProviderHandler: { current: {} as Record<string, unknown> },
  mockShouldExecuteInline: vi.fn(),
}))

const mockPreprocessExecution = executionPreprocessingMockFns.mockPreprocessExecution

vi.mock('@sim/db', () => ({ ...dbChainMock, ...schemaMock }))

vi.mock('@sim/utils/id', () => ({
  generateId: mockGenerateId,
  generateShortId: vi.fn(() => 'mock-short-id'),
  isValidUuid: vi.fn((v: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  ),
}))

vi.mock('@/lib/billing/subscriptions/utils', () => ({
  checkEnterprisePlan: vi.fn().mockReturnValue(true),
  checkTeamPlan: vi.fn().mockReturnValue(true),
}))

vi.mock('@/lib/billing/calculations/usage-reservation', () => ({
  releaseExecutionSlot: mockReleaseExecutionSlot,
}))

vi.mock('@/lib/core/async-jobs', () => ({
  getInlineJobQueue: vi.fn(),
  getJobQueue: mockGetJobQueue,
  shouldExecuteInline: mockShouldExecuteInline,
}))

vi.mock('@/lib/core/admission/gate', () => ({
  tryAdmit: vi.fn(() => ({ release: mockAdmissionRelease })),
}))

vi.mock('@/lib/core/config/env-flags', () => envFlagsMock)

vi.mock('@sim/security/compare', () => ({
  safeCompare: vi.fn().mockReturnValue(true),
}))

vi.mock('@/lib/environment/utils', () => ({
  getEffectiveDecryptedEnv: vi.fn().mockResolvedValue({}),
}))

vi.mock('@/lib/execution/preprocessing', () => executionPreprocessingMock)
vi.mock('@/lib/workflows/persistence/utils', () => workflowsPersistenceUtilsMock)

vi.mock('@/lib/webhooks/pending-verification', () => ({
  getPendingWebhookVerification: vi.fn(),
  matchesPendingWebhookVerificationProbe: vi.fn().mockReturnValue(false),
  requiresPendingWebhookVerification: vi.fn().mockReturnValue(false),
}))

vi.mock('@/lib/webhooks/utils', () => ({
  convertSquareBracketsToTwiML: vi.fn((value: string) => value),
}))

vi.mock('@/lib/webhooks/utils.server', () => ({
  handleSlackChallenge: vi.fn().mockReturnValue(null),
  handleWhatsAppVerification: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/webhooks/providers', () => ({
  getProviderHandler: vi.fn(() => mockProviderHandler.current),
}))

vi.mock('@/background/webhook-execution', () => ({
  executeWebhookJob: vi.fn().mockResolvedValue({ success: true }),
}))

vi.mock('@/executor/utils/reference-validation', () => ({
  resolveEnvVarReferences: vi.fn((value: string) => value),
}))

vi.mock('@/triggers/confluence/utils', () => ({
  isConfluencePayloadMatch: vi.fn().mockReturnValue(true),
}))

vi.mock('@/triggers/constants', () => ({
  isPollingWebhookProvider: vi.fn((provider: string) => provider === 'gmail'),
}))

vi.mock('@/triggers/github/utils', () => ({
  isGitHubEventMatch: vi.fn().mockReturnValue(true),
}))

vi.mock('@/triggers/jira/utils', () => ({
  isJiraEventMatch: vi.fn().mockReturnValue(true),
}))

import {
  checkWebhookPreprocessing,
  dispatchResolvedWebhookTarget,
  findAllWebhooksForPath,
  handleWebhookEventFilter,
  processPolledWebhookEvent,
} from '@/lib/webhooks/processor'

afterAll(resetDbChainMock)

function makeWebhookRecord(overrides: Partial<WebhookRecord>): WebhookRecord {
  const now = new Date('2026-01-01T00:00:00.000Z')
  return {
    id: 'webhook-1',
    workflowId: 'workflow-1',
    deploymentVersionId: null,
    blockId: null,
    path: 'incoming/test',
    provider: 'generic',
    providerConfig: {},
    isActive: true,
    failedCount: 0,
    lastFailedAt: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function makeWorkflowRecord(overrides: Partial<WorkflowRecord>): WorkflowRecord {
  const now = new Date('2026-01-01T00:00:00.000Z')
  return {
    id: 'workflow-1',
    userId: 'owner-1',
    workspaceId: 'workspace-1',
    folderId: null,
    sortOrder: 0,
    name: 'Webhook workflow',
    description: null,
    lastSynced: now,
    createdAt: now,
    updatedAt: now,
    isDeployed: true,
    deployedAt: now,
    isPublicApi: false,
    locked: false,
    runCount: 0,
    lastRunAt: null,
    variables: {},
    archivedAt: null,
    ...overrides,
  }
}

const billingAttribution = {
  actorUserId: 'actor-user-1',
  workspaceId: 'workspace-1',
  organizationId: null,
  billedAccountUserId: 'actor-user-1',
  billingEntity: { type: 'user' as const, id: 'actor-user-1' },
  billingPeriod: {
    start: '2026-07-01T00:00:00.000Z',
    end: '2026-08-01T00:00:00.000Z',
  },
  payerSubscription: null,
}

describe('findAllWebhooksForPath cross-tenant collision', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  const makeRow = (workflowId: string, webhookId: string, createdAt: Date) => ({
    webhook: { id: webhookId, workflowId, path: 'shared-path', createdAt },
    workflow: { id: workflowId },
  })

  const queueLookup = (rows: WebhookLookupRow[], claim: Array<{ workflowId: string }> = []) => {
    queueTableRows(schemaMock.webhook, rows)
    queueTableRows(schemaMock.webhookPathClaim, claim)
  }

  it('returns all rows when they belong to a single workflow', async () => {
    queueLookup([
      makeRow('workflow-1', 'wh-a', new Date('2026-01-01')),
      makeRow('workflow-1', 'wh-b', new Date('2026-01-02')),
    ])

    const results = await findAllWebhooksForPath({ requestId: 'req-1', path: 'shared-path' })

    expect(results).toHaveLength(2)
    expect(results.map((r) => r.webhook.id)).toEqual(['wh-a', 'wh-b'])
  })

  it('drops foreign rows when a path collides across workflows, keeping the earliest owner', async () => {
    const victim = makeRow('victim-workflow', 'victim-wh', new Date('2026-01-01'))
    const attacker = makeRow('attacker-workflow', 'attacker-wh', new Date('2026-05-01'))
    queueLookup([attacker, victim])

    const results = await findAllWebhooksForPath({ requestId: 'req-2', path: 'shared-path' })

    expect(results).toHaveLength(1)
    expect(results[0].webhook.id).toBe('victim-wh')
    expect(results[0].webhook.workflowId).toBe('victim-workflow')
  })

  it('prefers the path-claim owner over an earlier-created interloper', async () => {
    const interloper = makeRow('interloper-workflow', 'interloper-wh', new Date('2026-01-01'))
    const claimHolder = makeRow('claim-workflow', 'claim-wh', new Date('2026-05-01'))
    queueLookup([interloper, claimHolder], [{ workflowId: 'claim-workflow' }])

    const results = await findAllWebhooksForPath({ requestId: 'req-6', path: 'shared-path' })

    expect(results).toHaveLength(1)
    expect(results[0].webhook.workflowId).toBe('claim-workflow')
  })

  it('falls back to earliest registration when the claim owner has no deliverable rows', async () => {
    const victim = makeRow('victim-workflow', 'victim-wh', new Date('2026-01-01'))
    const attacker = makeRow('attacker-workflow', 'attacker-wh', new Date('2026-05-01'))
    queueLookup([attacker, victim], [{ workflowId: 'absent-workflow' }])

    const results = await findAllWebhooksForPath({ requestId: 'req-7', path: 'shared-path' })

    expect(results).toHaveLength(1)
    expect(results[0].webhook.workflowId).toBe('victim-workflow')
  })

  it("preserves the owner's full multi-webhook match while dropping a foreign row", async () => {
    const victimA = makeRow('victim-workflow', 'victim-wh-a', new Date('2026-01-01'))
    const victimB = makeRow('victim-workflow', 'victim-wh-b', new Date('2026-01-03'))
    const attacker = makeRow('attacker-workflow', 'attacker-wh', new Date('2026-05-01'))
    queueLookup([victimB, attacker, victimA])

    const results = await findAllWebhooksForPath({ requestId: 'req-5', path: 'shared-path' })

    expect(results).toHaveLength(2)
    expect(results.every((r) => r.webhook.workflowId === 'victim-workflow')).toBe(true)
    expect(results.map((r) => r.webhook.id).sort()).toEqual(['victim-wh-a', 'victim-wh-b'])
  })

  it('returns an empty array when no webhooks match', async () => {
    const results = await findAllWebhooksForPath({ requestId: 'req-3', path: 'missing' })

    expect(results).toEqual([])
  })

  it('returns an empty array when path is not provided', async () => {
    const results = await findAllWebhooksForPath({ requestId: 'req-4' })

    expect(results).toEqual([])
  })
})

describe('handleWebhookEventFilter', () => {
  it('returns an ignore response when a provider event does not match', async () => {
    mockProviderHandler.current = {
      matchEvent: vi.fn().mockResolvedValue(false),
    }

    const response = await handleWebhookEventFilter(
      makeWebhookRecord({ provider: 'gmail' }),
      makeWorkflowRecord({}),
      { event: 'message.received' },
      createMockRequest('POST', { event: 'message.received' }),
      'request-1'
    )

    expect(response?.status).toBe(200)
    await expect(response?.json()).resolves.toMatchObject({
      message: 'Event type does not match trigger configuration. Ignoring.',
    })
  })
})

describe('webhook admission failures', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGenerateId.mockReturnValue('generated-execution-id')
  })

  it.each([
    {
      statusCode: 429,
      code: ADMISSION_ERROR_CODE.RESERVATION_CONCURRENCY,
      cause: undefined,
    },
    {
      statusCode: 503,
      code: ADMISSION_ERROR_CODE.RESERVATION_INFRASTRUCTURE,
      cause: { code: ADMISSION_ERROR_CODE.RESERVATION_INFRASTRUCTURE },
    },
  ])(
    'returns stable retry semantics for transient generic admission $statusCode',
    async ({ statusCode, code, cause }) => {
      mockPreprocessExecution.mockResolvedValueOnce({
        success: false,
        error: {
          message: 'Admission temporarily unavailable',
          statusCode,
          code,
          retryable: true,
          ...(cause ? { cause } : {}),
        },
      })

      const result = await checkWebhookPreprocessing(
        makeWorkflowRecord({}),
        makeWebhookRecord({ path: 'incoming', provider: 'generic' }),
        'request-1'
      )

      expect(result.transientAdmissionFailure).toMatchObject({ statusCode, code })
      expect(result.error?.status).toBe(statusCode)
      expect(result.error?.headers.get('Retry-After')).toBe(String(ADMISSION_RETRY_AFTER_SECONDS))
      await expect(result.error?.json()).resolves.toMatchObject({
        error: 'Admission temporarily unavailable',
        code,
        retryable: true,
        retryAfterSeconds: ADMISSION_RETRY_AFTER_SECONDS,
      })
    }
  )

  it.each([
    { statusCode: 402, retryable: true },
    { statusCode: 403, retryable: true },
    { statusCode: 429, retryable: true, code: 'RATE_LIMIT_EXCEEDED' },
  ])(
    'does not add retry semantics to a $statusCode failure',
    async ({ statusCode, retryable, code }) => {
      mockPreprocessExecution.mockResolvedValueOnce({
        success: false,
        error: {
          message: 'Admission denied',
          statusCode,
          retryable,
          ...(code ? { code } : {}),
        },
      })

      const result = await checkWebhookPreprocessing(
        makeWorkflowRecord({}),
        makeWebhookRecord({ path: 'incoming', provider: 'generic' }),
        'request-1'
      )

      expect(result.transientAdmissionFailure).toBeUndefined()
      expect(result.error?.status).toBe(statusCode)
      expect(result.error?.headers.get('Retry-After')).toBeNull()
      await expect(result.error?.json()).resolves.toEqual({ error: 'Admission denied' })
    }
  )
})

describe('webhook processor execution identity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPreprocessExecution.mockResolvedValue({
      success: true,
      actorUserId: 'actor-user-1',
      billingAttribution,
    })
    mockEnqueue.mockResolvedValue('job-1')
    mockGetJobQueue.mockResolvedValue({ enqueue: mockEnqueue })
    mockProviderHandler.current = {}
    mockShouldExecuteInline.mockReturnValue(false)
    mockGenerateId.mockReturnValue('generated-execution-id')
    workflowsPersistenceUtilsMockFns.mockBlockExistsInDeployment.mockResolvedValue(true)
  })

  it('normalizes nullable persisted metadata in preprocessing correlation', async () => {
    const result = await checkWebhookPreprocessing(
      makeWorkflowRecord({ workspaceId: null }),
      makeWebhookRecord({ path: null, provider: null }),
      'request-1'
    )

    expect(mockPreprocessExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: undefined,
        triggerData: {
          correlation: expect.objectContaining({
            path: undefined,
            provider: undefined,
          }),
        },
      })
    )
    expect(result.correlation?.path).toBeUndefined()
    expect(result.correlation?.provider).toBeUndefined()
  })

  it('reuses preprocessing execution identity when queueing a polling webhook', async () => {
    const expectedCorrelation = {
      executionId: 'generated-execution-id',
      requestId: 'request-1',
      source: 'webhook',
      workflowId: 'workflow-1',
      webhookId: 'webhook-1',
      path: 'incoming/gmail',
      provider: 'gmail',
      triggerType: 'webhook',
    }

    const result = await dispatchResolvedWebhookTarget(
      makeWebhookRecord({
        path: 'incoming/gmail',
        provider: 'gmail',
        deploymentVersionId: 'deployment-admitted',
      }),
      makeWorkflowRecord({}),
      { event: 'message.received' },
      createMockRequest('POST', { event: 'message.received' }) as NextRequest,
      {
        requestId: 'request-1',
        path: 'incoming/gmail',
      }
    )

    expect(result.outcome).toBe('queued')
    expect(mockGenerateId).toHaveBeenCalledTimes(1)
    expect(mockEnqueue).toHaveBeenCalledWith(
      'webhook-execution',
      expect.objectContaining({
        workflowId: 'workflow-1',
        provider: 'gmail',
        deploymentVersionId: 'deployment-admitted',
      }),
      expect.objectContaining({
        metadata: expect.objectContaining({
          workflowId: 'workflow-1',
          workspaceId: 'workspace-1',
          userId: 'actor-user-1',
          correlation: expectedCorrelation,
        }),
      })
    )
    expect(mockReleaseExecutionSlot).not.toHaveBeenCalled()
  })

  it('releases the reservation when enqueue fails before ownership transfer', async () => {
    mockEnqueue.mockRejectedValueOnce(new Error('queue unavailable'))

    const result = await dispatchResolvedWebhookTarget(
      makeWebhookRecord({
        path: 'incoming/gmail',
        provider: 'gmail',
        blockId: 'block-1',
      }),
      makeWorkflowRecord({}),
      { event: 'message.received' },
      createMockRequest('POST', { event: 'message.received' }),
      {
        requestId: 'request-1',
        path: 'incoming/gmail',
      }
    )

    expect(result.response.status).toBe(500)
    expect(mockReleaseExecutionSlot).toHaveBeenCalledOnce()
    expect(mockReleaseExecutionSlot).toHaveBeenCalledWith('generated-execution-id')
  })
})

describe('polled webhook reservation ownership', () => {
  const foundWebhook = {
    id: 'webhook-1',
    workflowId: 'workflow-1',
    path: 'incoming/gmail',
    provider: 'gmail',
    providerConfig: {},
    blockId: 'block-1',
  }
  const foundWorkflow = {
    id: 'workflow-1',
    userId: 'owner-1',
    workspaceId: 'workspace-1',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockGenerateId.mockReturnValue('generated-execution-id')
    mockPreprocessExecution.mockResolvedValue({
      success: true,
      actorUserId: 'actor-user-1',
      billingAttribution,
    })
    mockEnqueue.mockResolvedValue('job-1')
    mockGetJobQueue.mockResolvedValue({ enqueue: mockEnqueue })
    mockShouldExecuteInline.mockReturnValue(false)
    workflowsPersistenceUtilsMockFns.mockBlockExistsInDeployment.mockResolvedValue(true)
  })

  it('checks for a missing trigger block before reserving a slot', async () => {
    workflowsPersistenceUtilsMockFns.mockBlockExistsInDeployment.mockResolvedValueOnce(false)

    const result = await processPolledWebhookEvent(
      makeWebhookRecord(foundWebhook),
      makeWorkflowRecord(foundWorkflow),
      { event: 'message.received' },
      'request-1'
    )

    expect(result).toMatchObject({
      success: false,
      statusCode: 404,
      error: 'Trigger block not found in deployment',
    })
    expect(mockPreprocessExecution).not.toHaveBeenCalled()
    expect(mockReleaseExecutionSlot).not.toHaveBeenCalled()
  })

  it('releases the reservation when polled webhook enqueue fails', async () => {
    mockEnqueue.mockRejectedValueOnce(new Error('queue unavailable'))

    const result = await processPolledWebhookEvent(
      makeWebhookRecord(foundWebhook),
      makeWorkflowRecord(foundWorkflow),
      { event: 'message.received' },
      'request-1'
    )

    expect(result).toMatchObject({
      success: false,
      statusCode: 500,
      error: 'Internal server error',
    })
    expect(mockReleaseExecutionSlot).toHaveBeenCalledWith('generated-execution-id')
  })

  it('propagates transient admission status without enqueueing or inline retry', async () => {
    mockPreprocessExecution.mockResolvedValueOnce({
      success: false,
      error: {
        message: 'Usage admission unavailable',
        statusCode: 503,
        code: ADMISSION_ERROR_CODE.RESERVATION_INFRASTRUCTURE,
        retryable: true,
        cause: { code: ADMISSION_ERROR_CODE.RESERVATION_INFRASTRUCTURE },
      },
    })

    const result = await processPolledWebhookEvent(
      makeWebhookRecord(foundWebhook),
      makeWorkflowRecord(foundWorkflow),
      { event: 'message.received' },
      'request-1'
    )

    expect(result).toMatchObject({
      success: false,
      statusCode: 503,
      error: 'Usage admission unavailable',
      code: ADMISSION_ERROR_CODE.RESERVATION_INFRASTRUCTURE,
      retryable: true,
      retryAfterSeconds: ADMISSION_RETRY_AFTER_SECONDS,
    })
    expect(mockPreprocessExecution).toHaveBeenCalledOnce()
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('routes queue-mode providers through the durable job backend', async () => {
    mockProviderHandler.current = { executionMode: 'queue' }

    const result = await dispatchResolvedWebhookTarget(
      makeWebhookRecord({
        id: 'webhook-2',
        path: 'tiktok',
        provider: 'tiktok',
      }),
      makeWorkflowRecord({
        id: 'workflow-2',
        workspaceId: 'workspace-2',
      }),
      { event: 'post.publish.complete' },
      createMockRequest('POST', { event: 'post.publish.complete' }) as NextRequest,
      {
        requestId: 'request-2',
      }
    )

    expect(result.outcome).toBe('queued')
    expect(result.response.status).toBe(200)
    expect(mockEnqueue).toHaveBeenCalledWith(
      'webhook-execution',
      expect.objectContaining({
        provider: 'tiktok',
        workflowId: 'workflow-2',
      }),
      expect.any(Object)
    )
  })
})
