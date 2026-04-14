/**
 * @vitest-environment node
 */

import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGenerateId,
  mockPreprocessExecution,
  mockEnqueue,
  mockGetJobQueue,
  mockShouldExecuteInline,
} = vi.hoisted(() => ({
  mockGenerateId: vi.fn(),
  mockPreprocessExecution: vi.fn(),
  mockEnqueue: vi.fn(),
  mockGetJobQueue: vi.fn(),
  mockShouldExecuteInline: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {},
  webhook: {},
  workflow: {},
  workflowDeploymentVersion: {},
}))

vi.mock('@sim/db/schema', () => ({
  credentialSet: {},
  subscription: {},
}))

vi.mock('@sim/logger', () => ({
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn(),
  eq: vi.fn(),
  isNull: vi.fn(),
  or: vi.fn(),
}))

vi.mock('@/lib/core/utils/uuid', () => ({
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

vi.mock('@/lib/core/config/feature-flags', () => ({
  isProd: false,
}))

vi.mock('@/lib/core/security/encryption', () => ({
  safeCompare: vi.fn().mockReturnValue(true),
}))

vi.mock('@/lib/environment/utils', () => ({
  getEffectiveDecryptedEnv: vi.fn().mockResolvedValue({}),
}))

vi.mock('@/lib/execution/preprocessing', () => ({
  preprocessExecution: mockPreprocessExecution,
}))

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

vi.mock('@/triggers/hubspot/utils', () => ({
  isHubSpotContactEventMatch: vi.fn().mockReturnValue(true),
}))

vi.mock('@/triggers/jira/utils', () => ({
  isJiraEventMatch: vi.fn().mockReturnValue(true),
}))

import { checkWebhookPreprocessing, queueWebhookExecution } from '@/lib/webhooks/processor'

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
