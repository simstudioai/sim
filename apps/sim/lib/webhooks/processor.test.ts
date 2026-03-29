/**
 * @vitest-environment node
 */

import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockUuidV4,
  mockPreprocessExecution,
  mockEnqueue,
  mockEnqueueWorkspaceDispatch,
  mockGetJobQueue,
  mockShouldExecuteInline,
} = vi.hoisted(() => ({
  mockUuidV4: vi.fn(),
  mockPreprocessExecution: vi.fn(),
  mockEnqueue: vi.fn(),
  mockEnqueueWorkspaceDispatch: vi.fn(),
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

vi.mock('uuid', () => ({
  v4: mockUuidV4,
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

vi.mock('@/lib/core/bullmq', () => ({
  isBullMQEnabled: vi.fn().mockReturnValue(true),
  createBullMQJobData: vi.fn((payload: unknown, metadata?: unknown) => ({ payload, metadata })),
}))

vi.mock('@/lib/core/workspace-dispatch', () => ({
  enqueueWorkspaceDispatch: mockEnqueueWorkspaceDispatch,
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
  validateAttioSignature: vi.fn().mockReturnValue(true),
  validateCalcomSignature: vi.fn().mockReturnValue(true),
  validateCirclebackSignature: vi.fn().mockReturnValue(true),
  validateFirefliesSignature: vi.fn().mockReturnValue(true),
  validateGitHubSignature: vi.fn().mockReturnValue(true),
  validateJiraSignature: vi.fn().mockReturnValue(true),
  validateLinearSignature: vi.fn().mockReturnValue(true),
  validateMicrosoftTeamsSignature: vi.fn().mockReturnValue(true),
  validateTwilioSignature: vi.fn().mockResolvedValue(true),
  validateTypeformSignature: vi.fn().mockReturnValue(true),
  verifyProviderWebhook: vi.fn().mockReturnValue(null),
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
    mockEnqueueWorkspaceDispatch.mockResolvedValue('job-1')
    mockGetJobQueue.mockResolvedValue({ enqueue: mockEnqueue })
    mockShouldExecuteInline.mockReturnValue(false)
    mockUuidV4.mockReturnValue('generated-execution-id')
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

    expect(mockUuidV4).toHaveBeenCalledTimes(1)
    expect(mockEnqueueWorkspaceDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'generated-execution-id',
        workspaceId: 'workspace-1',
        lane: 'runtime',
        queueName: 'webhook-execution',
        metadata: expect.objectContaining({
          workflowId: 'workflow-1',
          userId: 'actor-user-1',
          correlation: preprocessingResult.correlation,
        }),
      })
    )
  })
})
