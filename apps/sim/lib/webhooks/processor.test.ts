/**
 * @vitest-environment node
 */

import {
  createMockRequest,
  envFlagsMock,
  executionPreprocessingMock,
  executionPreprocessingMockFns,
  workflowsPersistenceUtilsMock,
  workflowsPersistenceUtilsMockFns,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ADMISSION_ERROR_CODE,
  ADMISSION_RETRY_AFTER_SECONDS,
} from '@/lib/core/admission/transient-failure'

const {
  mockGenerateId,
  mockAdmissionRelease,
  mockEnqueue,
  mockGetJobQueue,
  mockGetProviderHandler,
  mockReleaseExecutionSlot,
  mockShouldExecuteInline,
  mockWebhookLookupResult,
} = vi.hoisted(() => ({
  mockGenerateId: vi.fn(),
  mockAdmissionRelease: vi.fn(),
  mockEnqueue: vi.fn(),
  mockGetJobQueue: vi.fn(),
  mockGetProviderHandler: vi.fn().mockReturnValue({}),
  mockReleaseExecutionSlot: vi.fn(),
  mockShouldExecuteInline: vi.fn(),
  mockWebhookLookupResult: { rows: [] as Array<{ webhook: any; workflow: any }> },
}))

const mockPreprocessExecution = executionPreprocessingMockFns.mockPreprocessExecution

vi.mock('@sim/db', () => {
  const selectChain = {
    from: () => selectChain,
    innerJoin: () => selectChain,
    leftJoin: () => selectChain,
    where: () => Promise.resolve(mockWebhookLookupResult.rows),
  }
  return {
    db: { select: () => selectChain },
    webhook: {},
    workflow: {},
    workflowDeploymentVersion: {},
  }
})

vi.mock('drizzle-orm', () => ({
  and: vi.fn(),
  eq: vi.fn(),
  isNull: vi.fn(),
  or: vi.fn(),
}))

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
  getProviderHandler: mockGetProviderHandler,
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
  findAllWebhooksForPath,
  handleWebhookEventFilter,
  processPolledWebhookEvent,
  queueWebhookExecution,
} from '@/lib/webhooks/processor'

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
    mockWebhookLookupResult.rows = []
  })

  const makeRow = (workflowId: string, webhookId: string, createdAt: Date) => ({
    webhook: { id: webhookId, workflowId, path: 'shared-path', createdAt },
    workflow: { id: workflowId },
  })

  it('returns all rows when they belong to a single workflow', async () => {
    mockWebhookLookupResult.rows = [
      makeRow('workflow-1', 'wh-a', new Date('2026-01-01')),
      makeRow('workflow-1', 'wh-b', new Date('2026-01-02')),
    ]

    const results = await findAllWebhooksForPath({ requestId: 'req-1', path: 'shared-path' })

    expect(results).toHaveLength(2)
    expect(results.map((r) => r.webhook.id)).toEqual(['wh-a', 'wh-b'])
  })

  it('drops foreign rows when a path collides across workflows, keeping the earliest owner', async () => {
    const victim = makeRow('victim-workflow', 'victim-wh', new Date('2026-01-01'))
    const attacker = makeRow('attacker-workflow', 'attacker-wh', new Date('2026-05-01'))
    mockWebhookLookupResult.rows = [attacker, victim]

    const results = await findAllWebhooksForPath({ requestId: 'req-2', path: 'shared-path' })

    expect(results).toHaveLength(1)
    expect(results[0].webhook.id).toBe('victim-wh')
    expect(results[0].webhook.workflowId).toBe('victim-workflow')
  })

  it("preserves the owner's full multi-webhook match while dropping a foreign row", async () => {
    const victimA = makeRow('victim-workflow', 'victim-wh-a', new Date('2026-01-01'))
    const victimB = makeRow('victim-workflow', 'victim-wh-b', new Date('2026-01-03'))
    const attacker = makeRow('attacker-workflow', 'attacker-wh', new Date('2026-05-01'))
    mockWebhookLookupResult.rows = [victimB, attacker, victimA]

    const results = await findAllWebhooksForPath({ requestId: 'req-5', path: 'shared-path' })

    expect(results).toHaveLength(2)
    expect(results.every((r) => r.webhook.workflowId === 'victim-workflow')).toBe(true)
    expect(results.map((r) => r.webhook.id).sort()).toEqual(['victim-wh-a', 'victim-wh-b'])
  })

  it('returns an empty array when no webhooks match', async () => {
    mockWebhookLookupResult.rows = []

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
    mockGetProviderHandler.mockReturnValueOnce({
      matchEvent: vi.fn().mockResolvedValue(false),
    })

    const response = await handleWebhookEventFilter(
      { id: 'webhook-1', provider: 'gmail', providerConfig: {} },
      { id: 'workflow-1' },
      { event: 'message.received' },
      createMockRequest('POST', { event: 'message.received' }) as any,
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
        { id: 'workflow-1', userId: 'owner-1', workspaceId: 'workspace-1' },
        { id: 'webhook-1', path: 'incoming', provider: 'generic' },
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
        { id: 'workflow-1', userId: 'owner-1', workspaceId: 'workspace-1' },
        { id: 'webhook-1', path: 'incoming', provider: 'generic' },
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
    mockShouldExecuteInline.mockReturnValue(false)
    mockGenerateId.mockReturnValue('generated-execution-id')
  })

  it('reuses preprocessing execution identity when queueing a polling webhook', async () => {
    const preprocessingResult = await checkWebhookPreprocessing(
      {
        id: 'workflow-1',
        userId: 'owner-1',
        workspaceId: 'workspace-1',
      },
      {
        id: 'webhook-1',
        path: 'incoming/gmail',
        provider: 'gmail',
      },
      'request-1'
    )

    expect(preprocessingResult).toMatchObject({
      error: null,
      actorUserId: 'actor-user-1',
      executionId: 'generated-execution-id',
      correlation: {
        executionId: 'generated-execution-id',
        requestId: 'request-1',
        source: 'webhook',
        workflowId: 'workflow-1',
        webhookId: 'webhook-1',
        path: 'incoming/gmail',
        provider: 'gmail',
        triggerType: 'webhook',
      },
    })

    await queueWebhookExecution(
      {
        id: 'webhook-1',
        path: 'incoming/gmail',
        provider: 'gmail',
        providerConfig: {},
        blockId: 'block-1',
      },
      {
        id: 'workflow-1',
        workspaceId: 'workspace-1',
      },
      { event: 'message.received' },
      createMockRequest('POST', { event: 'message.received' }) as any,
      {
        requestId: 'request-1',
        path: 'incoming/gmail',
        actorUserId: preprocessingResult.actorUserId,
        billingAttribution: preprocessingResult.billingAttribution,
        executionId: preprocessingResult.executionId,
        correlation: preprocessingResult.correlation,
      }
    )

    expect(mockGenerateId).toHaveBeenCalledTimes(1)
    expect(mockEnqueue).toHaveBeenCalledWith(
      'webhook-execution',
      expect.objectContaining({
        workflowId: 'workflow-1',
        provider: 'gmail',
      }),
      expect.objectContaining({
        metadata: expect.objectContaining({
          workflowId: 'workflow-1',
          workspaceId: 'workspace-1',
          userId: 'actor-user-1',
          correlation: preprocessingResult.correlation,
        }),
      })
    )
    expect(mockReleaseExecutionSlot).not.toHaveBeenCalled()
  })

  it('releases the reservation when enqueue fails before ownership transfer', async () => {
    mockEnqueue.mockRejectedValueOnce(new Error('queue unavailable'))

    const response = await queueWebhookExecution(
      {
        id: 'webhook-1',
        path: 'incoming/gmail',
        provider: 'gmail',
        providerConfig: {},
        blockId: 'block-1',
      },
      {
        id: 'workflow-1',
        workspaceId: 'workspace-1',
      },
      { event: 'message.received' },
      createMockRequest('POST', { event: 'message.received' }) as any,
      {
        requestId: 'request-1',
        path: 'incoming/gmail',
        actorUserId: 'actor-user-1',
        billingAttribution,
        executionId: 'reserved-execution-id',
      }
    )

    expect(response.status).toBe(500)
    expect(mockReleaseExecutionSlot).toHaveBeenCalledOnce()
    expect(mockReleaseExecutionSlot).toHaveBeenCalledWith('reserved-execution-id')
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
      foundWebhook as any,
      foundWorkflow as any,
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
      foundWebhook as any,
      foundWorkflow as any,
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
      foundWebhook as any,
      foundWorkflow as any,
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
})
