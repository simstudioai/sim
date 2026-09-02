/**
 * @vitest-environment node
 */
import { webhook, workflow } from '@sim/db/schema'
import {
  auditMock,
  authMockFns,
  createMockRequest,
  dbChainMockFns,
  flattenMockConditions,
  permissionGroupScopeMock,
  permissionGroupScopeMockFns,
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
vi.mock('@/lib/permission-groups/config-scope.server', () => permissionGroupScopeMock)
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

import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'
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
      {
        id: 'workflow-1',
        userId: 'owner-1',
        workspaceId: 'canonical-workspace',
        deploymentVersionId: 'deployment-1',
      },
    ])
    queueTableRows(webhook, [])
    dbChainMockFns.returning.mockImplementationOnce(async () => {
      const insertedValues = dbChainMockFns.values.mock.calls.at(-1)?.[0] as {
        deploymentVersionId?: string | null
      }
      return [
        {
          ...savedWebhook,
          deploymentVersionId: insertedValues.deploymentVersionId ?? null,
        },
      ]
    })

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
    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({ deploymentVersionId: 'deployment-1' })
    )
    expect(mocks.configurePolling).toHaveBeenCalledWith({
      webhook: savedWebhook,
      requestId: 'mock-request-id',
      userId: 'actor-1',
      workspaceId: 'canonical-workspace',
      deploymentVersionId: 'deployment-1',
    })
  })

  it('updates only the current-deployment IMAP webhook before polling setup', async () => {
    const existingWebhook = {
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
      {
        id: 'workflow-1',
        userId: 'owner-1',
        workspaceId: 'canonical-workspace',
        deploymentVersionId: 'deployment-1',
      },
    ])
    queueTableRows(webhook, [{ id: existingWebhook.id }])
    queueTableRows(webhook, [existingWebhook])
    dbChainMockFns.returning.mockImplementationOnce(async () => {
      const updatedValues = dbChainMockFns.set.mock.calls.at(-1)?.[0] as {
        deploymentVersionId?: string | null
      }
      return [
        {
          ...existingWebhook,
          deploymentVersionId: updatedValues.deploymentVersionId ?? null,
        },
      ]
    })

    const response = await POST(
      createMockRequest(
        'POST',
        {
          workflowId: 'workflow-1',
          blockId: 'block-1',
          path: 'imap-hook',
          provider: 'imap',
          providerConfig: existingWebhook.providerConfig,
        },
        {},
        'http://localhost:3000/api/webhooks'
      )
    )

    const repairedWebhook = {
      ...existingWebhook,
      deploymentVersionId: 'deployment-1',
    }
    expect(response.status).toBe(200)
    const pathLookupConditions = dbChainMockFns.where.mock.calls
      .map(([condition]) => flattenMockConditions(condition))
      .find((conditions) =>
        conditions.some((condition) => condition.type === 'eq' && condition.right === 'imap-hook')
      )
    expect(pathLookupConditions).toContainEqual({
      type: 'eq',
      left: 'webhook.deploymentVersionId',
      right: 'deployment-1',
    })
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ deploymentVersionId: 'deployment-1' })
    )
    expect(mocks.configurePolling).toHaveBeenCalledWith({
      webhook: repairedWebhook,
      requestId: 'mock-request-id',
      userId: 'actor-1',
      workspaceId: 'canonical-workspace',
      deploymentVersionId: 'deployment-1',
    })
  })

  it('creates an active IMAP webhook instead of rebinding a historical row', async () => {
    const savedWebhook = {
      id: 'webhook-active',
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
      {
        id: 'workflow-1',
        userId: 'owner-1',
        workspaceId: 'canonical-workspace',
        deploymentVersionId: 'deployment-1',
      },
    ])
    // A historical row may exist, but the current-deployment lookup correctly returns none.
    queueTableRows(webhook, [])
    dbChainMockFns.returning.mockImplementationOnce(async () => {
      const insertedValues = dbChainMockFns.values.mock.calls.at(-1)?.[0] as {
        deploymentVersionId?: string | null
      }
      return [
        {
          ...savedWebhook,
          deploymentVersionId: insertedValues.deploymentVersionId ?? null,
        },
      ]
    })

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
    expect(dbChainMockFns.set).not.toHaveBeenCalled()
    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({ deploymentVersionId: 'deployment-1' })
    )
    expect(mocks.configurePolling).toHaveBeenCalledWith({
      webhook: savedWebhook,
      requestId: 'mock-request-id',
      userId: 'actor-1',
      workspaceId: 'canonical-workspace',
      deploymentVersionId: 'deployment-1',
    })
  })

  it('restores the previous IMAP deployment binding when polling setup fails', async () => {
    const existingWebhook = {
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
      {
        id: 'workflow-1',
        userId: 'owner-1',
        workspaceId: 'canonical-workspace',
        deploymentVersionId: 'deployment-1',
      },
    ])
    queueTableRows(webhook, [{ id: existingWebhook.id }])
    queueTableRows(webhook, [existingWebhook])
    dbChainMockFns.returning.mockImplementationOnce(async () => {
      const updatedValues = dbChainMockFns.set.mock.calls.at(-1)?.[0] as {
        deploymentVersionId?: string | null
      }
      return [
        {
          ...existingWebhook,
          deploymentVersionId: updatedValues.deploymentVersionId ?? null,
        },
      ]
    })
    mocks.configurePolling.mockResolvedValue(false)

    const response = await POST(
      createMockRequest(
        'POST',
        {
          workflowId: 'workflow-1',
          blockId: 'block-1',
          path: 'imap-hook',
          provider: 'imap',
          providerConfig: existingWebhook.providerConfig,
        },
        {},
        'http://localhost:3000/api/webhooks'
      )
    )

    expect(response.status).toBe(500)
    expect(dbChainMockFns.set).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ deploymentVersionId: 'deployment-1' })
    )
    expect(dbChainMockFns.set).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ deploymentVersionId: 'deployment-1' })
    )
  })
})

describe('POST /api/webhooks triggers.webhook gate', () => {
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
    permissionGroupScopeMockFns.mockResolvePermissionGroupConfig.mockResolvedValue(null)
    mocks.findConflictingWebhookPathOwner.mockResolvedValue(null)
    mocks.resolveEnvVarsInObject.mockImplementation(async (config) => config)
    mocks.shouldRecreateExternalWebhookSubscription.mockReturnValue(false)
    mocks.getProviderHandler.mockReturnValue({})
    mocks.createExternalWebhookSubscription.mockResolvedValue({
      updatedProviderConfig: {},
      externalSubscriptionCreated: false,
    })
  })

  function upsertRequest() {
    return createMockRequest('POST', {
      workflowId: 'workflow-1',
      path: 'inbound-orders',
      provider: 'generic',
      providerConfig: {},
    })
  }

  /** The reads the create path makes, in the order the handler issues them. */
  function queueCreatePathRows(): void {
    queueTableRows(workflow, [{ id: 'workflow-1', userId: 'actor-1', workspaceId: 'workspace-1' }])
    queueTableRows(webhook, [])
  }

  /**
   * Making a workflow reachable from an inbound webhook is the only external
   * exposure with no deploy-tab equivalent, so the group key has to stop it at
   * creation or it is not withheld at all.
   */
  it('refuses to create a webhook when the group withholds webhook triggers', async () => {
    permissionGroupScopeMockFns.mockResolvePermissionGroupConfig.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      disableWebhookTriggers: true,
    })
    queueCreatePathRows()

    const response = await POST(upsertRequest())

    expect(response.status).toBe(403)
    expect(mocks.createExternalWebhookSubscription).not.toHaveBeenCalled()
  })

  it('creates the webhook when no group withholds the capability', async () => {
    queueCreatePathRows()

    const response = await POST(upsertRequest())

    expect(response.status).not.toBe(403)
    expect(mocks.createExternalWebhookSubscription).toHaveBeenCalledTimes(1)
  })

  /** The reads the update path makes: the path claim, then the existing row. */
  function queueUpdatePathRows(isActive: boolean): void {
    queueTableRows(workflow, [{ id: 'workflow-1', userId: 'actor-1', workspaceId: 'workspace-1' }])
    queueTableRows(webhook, [{ id: 'webhook-1' }])
    queueTableRows(webhook, [
      {
        id: 'webhook-1',
        workflowId: 'workflow-1',
        blockId: 'block-1',
        path: 'inbound-orders',
        provider: 'generic',
        providerConfig: {},
        isActive,
      },
    ])
    dbChainMockFns.returning.mockImplementationOnce(async () => [
      { id: 'webhook-1', workflowId: 'workflow-1', path: 'inbound-orders', isActive: true },
    ])
  }

  /**
   * The upsert always writes `isActive: true`, so re-saving a dormant webhook is
   * the same transition `PATCH /api/webhooks/[id]` gates — a workflow becoming
   * reachable again — and has to be refused on the same terms.
   */
  it('refuses to reactivate a dormant webhook when the group withholds webhook triggers', async () => {
    permissionGroupScopeMockFns.mockResolvePermissionGroupConfig.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      disableWebhookTriggers: true,
    })
    queueUpdatePathRows(false)

    const response = await POST(upsertRequest())

    expect(response.status).toBe(403)
    expect(dbChainMockFns.set).not.toHaveBeenCalled()
  })

  /**
   * An already-active webhook is already reachable, so re-saving its config adds
   * no exposure. Refusing it would strand a member unable to repair a live
   * integration — the same reason inbound delivery is never gated.
   */
  it('still lets an already-active webhook be reconfigured under the same group', async () => {
    permissionGroupScopeMockFns.mockResolvePermissionGroupConfig.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      disableWebhookTriggers: true,
    })
    queueUpdatePathRows(true)

    const response = await POST(upsertRequest())

    expect(response.status).toBe(200)
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ isActive: true, provider: 'generic' })
    )
  })

  it('reactivates a dormant webhook when no group withholds the capability', async () => {
    queueUpdatePathRows(false)

    const response = await POST(upsertRequest())

    expect(response.status).toBe(200)
    expect(dbChainMockFns.set).toHaveBeenCalledWith(expect.objectContaining({ isActive: true }))
  })
})
