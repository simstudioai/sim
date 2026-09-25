import {
  authMockFns,
  createMockRequest,
  permissionGroupScopeMock,
  permissionGroupScopeMockFns,
  resetDbChainMock,
} from '@sim/testing'
import { createRouteContext } from '@sim/testing/helpers/http'
import {
  billingSubscriptionMock,
  billingSubscriptionMockFns,
} from '@sim/testing/mocks/billing-subscription.mock'
import { permissionsMock, permissionsMockFns } from '@sim/testing/mocks/permissions.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const resolveGroupConfigMock = permissionGroupScopeMockFns.mockResolvePermissionGroupConfig

vi.mock('@/lib/billing/core/subscription', () => billingSubscriptionMock)

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

vi.mock('@/lib/permission-groups/config-scope.server', () => permissionGroupScopeMock)

import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'
import {
  DELETE as DELETE_SENDER,
  GET as GET_SENDERS,
  POST as POST_SENDER,
} from '@/app/api/workspaces/[id]/inbox/senders/route'
import { GET as GET_TASKS } from '@/app/api/workspaces/[id]/inbox/tasks/route'

const { mockGetUserEntityPermissions } = permissionsMockFns
const { mockHasWorkspaceInboxAccess } = billingSubscriptionMockFns

const context = createRouteContext({ id: 'workspace-1' })
const REFUSAL = "The inbox is not available under your organization's permission group"
const BLOCKED = { code: 'PERMISSION_GROUP_CAPABILITY_BLOCKED' }
const BASE_URL = 'http://localhost:3000/api/workspaces/workspace-1/inbox'

/**
 * The inbox surface spreads one capability over three route files and six
 * handlers. Asserted together because a refusal that drifts on one of them is
 * invisible to a test that only reads `/inbox` — which is how the sibling
 * handlers came to omit `details.code` in the first place.
 */
describe('inbox.use refusals converge across the sibling routes', () => {
  beforeEach(() => {
    resetDbChainMock()
    authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'admin-1' } })
    mockGetUserEntityPermissions.mockResolvedValue('admin')
    mockHasWorkspaceInboxAccess.mockResolvedValue(true)
    resolveGroupConfigMock.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      hideInboxTab: true,
    })
  })

  it.each([
    [
      'GET /inbox/tasks',
      () => GET_TASKS(createMockRequest('GET', undefined, undefined, `${BASE_URL}/tasks`), context),
    ],
    [
      'GET /inbox/senders',
      () =>
        GET_SENDERS(createMockRequest('GET', undefined, undefined, `${BASE_URL}/senders`), context),
    ],
    [
      'POST /inbox/senders',
      () =>
        POST_SENDER(
          createMockRequest(
            'POST',
            { email: 'someone@example.com' },
            undefined,
            `${BASE_URL}/senders`
          ),
          context
        ),
    ],
    [
      'DELETE /inbox/senders',
      () =>
        DELETE_SENDER(
          createMockRequest('DELETE', { senderId: 'sender-1' }, undefined, `${BASE_URL}/senders`),
          context
        ),
    ],
  ])('%s returns the structured capability refusal', async (_name, call) => {
    const response = await call()

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: REFUSAL, details: BLOCKED })
  })
})
