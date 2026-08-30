/**
 * @vitest-environment node
 */

import { webhook, workflow } from '@sim/db/schema'
import { createMockRequest, queueTableRows, resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  authorizeWorkflow: vi.fn(),
  assertWorkflowMutable: vi.fn(),
  getUserPermissionConfig: vi.fn(),
  createExternalWebhookSubscription: vi.fn(),
  findConflictingWebhookPathOwner: vi.fn(),
  resolveEnvVarsInObject: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
  getSession: mocks.getSession,
}))

vi.mock('@sim/platform-authz/workflow', () => ({
  authorizeWorkflowByWorkspacePermission: mocks.authorizeWorkflow,
  assertWorkflowMutable: mocks.assertWorkflowMutable,
  WorkflowLockedError: class WorkflowLockedError extends Error {
    status = 423
  },
}))

vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfig: mocks.getUserPermissionConfig,
}))

vi.mock('@/lib/webhooks/provider-subscriptions', () => ({
  createExternalWebhookSubscription: mocks.createExternalWebhookSubscription,
  cleanupExternalWebhook: vi.fn(),
  shouldRecreateExternalWebhookSubscription: () => false,
}))

vi.mock('@/lib/webhooks/providers', () => ({ getProviderHandler: () => undefined }))
vi.mock('@/lib/webhooks/utils', () => ({ mergeNonUserFields: vi.fn() }))
vi.mock('@/lib/webhooks/utils.server', () => ({
  findConflictingWebhookPathOwner: mocks.findConflictingWebhookPathOwner,
}))
vi.mock('@/lib/webhooks/env-resolver', () => ({
  resolveEnvVarsInObject: mocks.resolveEnvVarsInObject,
}))
vi.mock('@/lib/workspaces/utils', () => ({ listAccessibleWorkspaceRowsForUser: vi.fn() }))
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: vi.fn() }))

import { POST } from '@/app/api/webhooks/route'

const WORKFLOW_ID = 'workflow-1'
const WORKSPACE_ID = 'workspace-1'

function upsertRequest() {
  return createMockRequest('POST', {
    workflowId: WORKFLOW_ID,
    path: 'inbound-orders',
    provider: 'generic',
    providerConfig: {},
  })
}

/** The reads the create path makes, in the order the handler issues them. */
function queueCreatePathRows(): void {
  queueTableRows(workflow, [{ id: WORKFLOW_ID, userId: 'user-1', workspaceId: WORKSPACE_ID }])
  queueTableRows(webhook, [])
}

describe('POST /api/webhooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.getSession.mockResolvedValue({ user: { id: 'user-1' } })
    mocks.authorizeWorkflow.mockResolvedValue({ allowed: true })
    mocks.assertWorkflowMutable.mockResolvedValue(undefined)
    mocks.getUserPermissionConfig.mockResolvedValue(null)
    mocks.findConflictingWebhookPathOwner.mockResolvedValue(null)
    mocks.resolveEnvVarsInObject.mockImplementation(async (config: unknown) => config)
    mocks.createExternalWebhookSubscription.mockResolvedValue({
      updatedProviderConfig: {},
      externalSubscriptionCreated: false,
    })
  })

  afterAll(resetDbChainMock)

  /**
   * Making a workflow reachable from an inbound webhook is the only external
   * exposure with no deploy-tab equivalent, so the group key has to stop it at
   * creation or it is not withheld at all.
   */
  it('refuses to create a webhook when the group withholds webhook triggers', async () => {
    mocks.getUserPermissionConfig.mockResolvedValue({ disableWebhookTriggers: true })
    queueCreatePathRows()

    const response = await POST(upsertRequest())

    expect(response.status).toBe(403)
    // Refused before the provider is told to start delivering.
    expect(mocks.createExternalWebhookSubscription).not.toHaveBeenCalled()
  })

  it('creates the webhook when no group withholds the capability', async () => {
    queueCreatePathRows()

    const response = await POST(upsertRequest())

    expect(response.status).not.toBe(403)
    expect(mocks.createExternalWebhookSubscription).toHaveBeenCalledTimes(1)
  })
})
