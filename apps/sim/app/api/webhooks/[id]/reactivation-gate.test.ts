/**
 * @vitest-environment node
 */
import { webhook } from '@sim/db/schema'
import {
  auditMock,
  createMockRequest,
  hybridAuthMockFns,
  permissionGroupScopeMock,
  permissionGroupScopeMockFns,
  posthogServerMock,
  queueTableRows,
  resetDbChainMock,
  telemetryMock,
  workflowAuthzMockFns,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/audit', () => auditMock)
vi.mock('@/lib/permission-groups/config-scope.server', () => permissionGroupScopeMock)
vi.mock('@/lib/core/telemetry', () => telemetryMock)
vi.mock('@/lib/posthog/server', () => posthogServerMock)
vi.mock('@/lib/webhooks/provider-subscriptions', () => ({ cleanupExternalWebhook: vi.fn() }))

import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'
import { PATCH } from '@/app/api/webhooks/[id]/route'

const ACTOR_ID = 'actor-1'

function reactivate() {
  return PATCH(createMockRequest('PATCH', { isActive: true }), {
    params: Promise.resolve({ id: 'webhook-1' }),
  })
}

/** The single joined read the PATCH handler issues. */
function queueDormantWebhook(): void {
  queueTableRows(webhook, [
    {
      webhook: { id: 'webhook-1', isActive: false, failedCount: 0 },
      workflow: { id: 'workflow-1', userId: ACTOR_ID, workspaceId: 'workspace-1' },
    },
  ])
}

/**
 * `triggers.webhook` is withheld from the actor's group. Flipping a dormant
 * webhook back on is the act the key names, so a session belonging to that
 * person must be refused — and an executor delegation carrying the same id
 * must not be, since it holds the actor's role and none of their capabilities.
 */
describe('the subject the webhook reactivation gate is decided about', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
      allowed: true,
      status: 200,
      workflow: { id: 'workflow-1' },
      workspacePermission: 'write',
    })
    workflowAuthzMockFns.mockAssertWorkflowMutable.mockResolvedValue(undefined)
    permissionGroupScopeMockFns.mockResolvePermissionGroupConfig.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      disableWebhookTriggers: true,
    })
  })

  it('refuses the actor’s own session', async () => {
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: ACTOR_ID,
      authType: 'session',
    })
    queueDormantWebhook()

    const response = await reactivate()

    expect(response.status).toBe(403)
  })

  it('lets an internal executor JWT through without consulting that group', async () => {
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: ACTOR_ID,
      authType: 'internal_jwt',
    })
    queueDormantWebhook()

    const response = await reactivate()

    expect(response.status).toBe(200)
    expect(permissionGroupScopeMockFns.mockResolvePermissionGroupConfig).not.toHaveBeenCalled()
  })
})
