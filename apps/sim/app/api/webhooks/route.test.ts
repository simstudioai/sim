/**
 * @vitest-environment node
 */
import { webhook, workflow } from '@sim/db/schema'
import {
  auditMock,
  authMockFns,
  createMockRequest,
  dbChainMockFns,
  posthogServerMock,
  queueTableRows,
  resetDbChainMock,
  telemetryMock,
  workflowAuthzMockFns,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  configurePolling: vi.fn(),
  createExternalWebhookSubscription: vi.fn(),
  findConflictingWebhookPathOwner: vi.fn(),
  getProviderHandler: vi.fn(),
  resolveEnvVarsInObject: vi.fn(),
  shouldRecreateExternalWebhookSubscription: vi.fn(),
}))

vi.mock('@sim/audit', () => auditMock)
vi.mock('@/lib/core/telemetry', () => telemetryMock)
vi.mock('@/lib/posthog/server', () => posthogServerMock)
vi.mock('@/lib/webhooks/env-resolver', () => ({
  resolveEnvVarsInObject: mocks.resolveEnvVarsInObject,
}))
vi.mock('@/lib/webhooks/provider-subscriptions', () => ({
  cleanupExternalWebhook: vi.fn(),
  createExternalWebhookSubscription: mocks.createExternalWebhookSubscription,
  shouldRecreateExternalWebhookSubscription: mocks.shouldRecreateExternalWebhookSubscription,
}))
vi.mock('@/lib/webhooks/providers', () => ({
  getProviderHandler: mocks.getProviderHandler,
}))
vi.mock('@/lib/webhooks/utils.server', () => ({
  findConflictingWebhookPathOwner: mocks.findConflictingWebhookPathOwner,
}))

import { POST } from '@/app/api/webhooks/route'

describe('POST /api/webhooks polling configuration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'actor-1', name: 'Actor', email: 'actor@example.com' },
      session: { id: 'session-1' },
    })
    workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
      allowed: true,
      status: 200,
      workflow: { id: 'workflow-1' },
      workspacePermission: 'write',
    })
    workflowAuthzMockFns.mockAssertWorkflowMutable.mockResolvedValue(undefined)
    mocks.findConflictingWebhookPathOwner.mockResolvedValue(null)
    mocks.resolveEnvVarsInObject.mockImplementation(async (config) => config)
    mocks.shouldRecreateExternalWebhookSubscription.mockReturnValue(false)
    mocks.createExternalWebhookSubscription.mockResolvedValue({
      updatedProviderConfig: {
        host: '{{IMAP_HOST}}',
        username: '{{IMAP_USERNAME}}',
        password: '{{IMAP_PASSWORD}}',
      },
      externalSubscriptionCreated: false,
    })
    mocks.configurePolling.mockResolvedValue(true)
    mocks.getProviderHandler.mockReturnValue({ configurePolling: mocks.configurePolling })
  })

  it('passes the authenticated actor and canonical workflow workspace to legacy polling setup', async () => {
    const savedWebhook = {
      id: 'webhook-1',
      workflowId: 'workflow-1',
      blockId: 'block-1',
      path: 'imap-hook',
      provider: 'imap',
      deploymentVersionId: 'deployment-1',
      providerConfig: {
        host: '{{IMAP_HOST}}',
        username: '{{IMAP_USERNAME}}',
        password: '{{IMAP_PASSWORD}}',
      },
      isActive: true,
    }
    queueTableRows(workflow, [
      { id: 'workflow-1', userId: 'owner-1', workspaceId: 'canonical-workspace' },
    ])
    queueTableRows(webhook, [])
    dbChainMockFns.returning.mockResolvedValueOnce([savedWebhook])

    const response = await POST(
      createMockRequest(
        'POST',
        {
          workflowId: 'workflow-1',
          blockId: 'block-1',
          path: 'imap-hook',
          provider: 'imap',
          providerConfig: savedWebhook.providerConfig,
        },
        {},
        'http://localhost:3000/api/webhooks'
      )
    )

    expect(response.status).toBe(201)
    expect(mocks.configurePolling).toHaveBeenCalledWith({
      webhook: savedWebhook,
      requestId: 'mock-request-id',
      userId: 'actor-1',
      workspaceId: 'canonical-workspace',
      deploymentVersionId: 'deployment-1',
    })
  })
})
