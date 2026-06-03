/**
 * @vitest-environment node
 */

import {
  createMockRequest,
  executionPreprocessingMock,
  executionPreprocessingMockFns,
  featureFlagsMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGenerateId,
  mockEnqueue,
  mockGetJobQueue,
  mockShouldExecuteInline,
  mockWebhookLookupResult,
} = vi.hoisted(() => ({
  mockGenerateId: vi.fn(),
  mockEnqueue: vi.fn(),
  mockGetJobQueue: vi.fn(),
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

vi.mock('@/lib/core/async-jobs', () => ({
  getInlineJobQueue: vi.fn(),
  getJobQueue: mockGetJobQueue,
  shouldExecuteInline: mockShouldExecuteInline,
}))

vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)

vi.mock('@sim/security/compare', () => ({
  safeCompare: vi.fn().mockReturnValue(true),
}))

vi.mock('@/lib/environment/utils', () => ({
  getEffectiveDecryptedEnv: vi.fn().mockResolvedValue({}),
}))

vi.mock('@/lib/execution/preprocessing', () => executionPreprocessingMock)

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
  getProviderHandler: vi.fn().mockReturnValue({}),
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
  queueWebhookExecution,
} from '@/lib/webhooks/processor'

describe('findAllWebhooksForPath cross-tenant collision', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWebhookLookupResult.rows = []
  })

  const makeRow = (workflowId: string, webhookId: string, createdAt: Date) => ({
    webhook: { id: webhookId, workflowId, path: 'shared-path', createdAt },
    workflow: { id: workflowId },
  })

  it('returns all rows when they belong to a single workflow (credential set fan-out)', async () => {
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

  it("preserves the owner's full credential-set fan-out while dropping a foreign row", async () => {
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

describe('webhook processor execution identity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPreprocessExecution.mockResolvedValue({
      success: true,
      actorUserId: 'actor-user-1',
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
  })
})
