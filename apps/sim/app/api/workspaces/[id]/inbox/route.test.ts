import {
  authMockFns,
  createMockRequest,
  dbChainMockFns,
  permissionGroupScopeMock,
  permissionGroupScopeMockFns,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { createRouteContext } from '@sim/testing/helpers/http'
import {
  billingSubscriptionMock,
  billingSubscriptionMockFns,
} from '@sim/testing/mocks/billing-subscription.mock'
import { permissionsMock, permissionsMockFns } from '@sim/testing/mocks/permissions.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const resolveGroupConfigMock = permissionGroupScopeMockFns.mockResolvePermissionGroupConfig

vi.mock('@/lib/billing/core/subscription', () => billingSubscriptionMock)

vi.mock('@/lib/mothership/inbox/lifecycle', () => ({
  disableInbox: vi.fn(),
  enableInbox: vi.fn(),
  updateInboxAddress: vi.fn(),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)

vi.mock('@/lib/permission-groups/config-scope.server', () => permissionGroupScopeMock)

import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'
import { GET, PATCH } from '@/app/api/workspaces/[id]/inbox/route'

const { mockGetUserEntityPermissions } = permissionsMockFns
const { mockHasWorkspaceInboxAccess } = billingSubscriptionMockFns
workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockImplementation(
  (...args: unknown[]) => mockGetUserEntityPermissions(...args)
)
workspaceContextMockFns.mockResolveActiveWorkspaceApplicationContext.mockImplementation(
  async (workspaceId: string) => ({
    workspaceId,
    workspaceOrganizationId: 'org-1',
    allowPersonalApiKeys: true,
  })
)

const context = createRouteContext({ id: 'workspace-1' })

describe('Inbox config secret policy', () => {
  beforeEach(() => {
    resetDbChainMock()
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'admin-1' },
      session: { id: 'session' },
    })
    mockGetUserEntityPermissions.mockResolvedValue('admin')
    mockHasWorkspaceInboxAccess.mockResolvedValue(true)
    resolveGroupConfigMock.mockResolvedValue(null)
  })

  it('updates policy without requiring an inbox lifecycle mutation', async () => {
    queueTableRows(schemaMock.workspace, [
      {
        inboxEnabled: true,
        inboxAddress: 'tasks@example.com',
        inboxProviderId: 'provider-1',
        inboxSecretScope: 'all',
        inboxMountedSecrets: [],
      },
    ])

    const response = await PATCH(
      createMockRequest(
        'PATCH',
        { secretScope: 'selected', mountedSecrets: [' B ', 'A', 'B'] },
        undefined,
        'http://localhost:3000/api/workspaces/workspace-1/inbox'
      ),
      context
    )

    const body = await response.json()
    expect({ status: response.status, body }).toMatchObject({
      status: 200,
      body: {
        enabled: true,
        address: 'tasks@example.com',
        secretScope: 'selected',
        mountedSecrets: ['B', 'A'],
      },
    })
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        inboxSecretScope: 'selected',
        inboxMountedSecrets: ['B', 'A'],
      })
    )
  })
})

const REFUSAL = "The inbox is not available under your organization's permission group"

function patchRequest() {
  return createMockRequest(
    'PATCH',
    { secretScope: 'all' },
    undefined,
    'http://localhost:3000/api/workspaces/workspace-1/inbox'
  )
}

function getRequest() {
  return createMockRequest(
    'GET',
    undefined,
    undefined,
    'http://localhost:3000/api/workspaces/workspace-1/inbox'
  )
}

/** The current inbox config row plus the empty task-status rollup the GET handler joins onto it. */
function queueInboxReadRows() {
  queueTableRows(schemaMock.workspace, [
    {
      inboxEnabled: true,
      inboxAddress: 'tasks@example.com',
      inboxProviderId: 'provider-1',
      inboxSecretScope: 'all',
      inboxMountedSecrets: [],
    },
  ])
  queueTableRows(schemaMock.mothershipInboxTask, [])
}

describe('Inbox inbox.use capability gate', () => {
  beforeEach(() => {
    resetDbChainMock()
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'admin-1' },
      session: { id: 'session' },
    })
    mockGetUserEntityPermissions.mockResolvedValue('admin')
    mockHasWorkspaceInboxAccess.mockResolvedValue(true)
  })

  describe('when the group withholds inbox.use', () => {
    beforeEach(() => {
      resolveGroupConfigMock.mockResolvedValue({
        ...DEFAULT_PERMISSION_GROUP_CONFIG,
        hideInboxTab: true,
      })
    })

    it('refuses to read the inbox config', async () => {
      queueInboxReadRows()

      const response = await GET(getRequest(), context)

      expect(response.status).toBe(403)
      await expect(response.json()).resolves.toEqual({
        error: REFUSAL,
        details: { code: 'PERMISSION_GROUP_CAPABILITY_BLOCKED' },
      })
    })

    it('refuses to update the inbox config, leaving the row untouched', async () => {
      queueInboxReadRows()

      const response = await PATCH(patchRequest(), context)

      expect(response.status).toBe(403)
      await expect(response.json()).resolves.toEqual({
        error: REFUSAL,
        details: { code: 'PERMISSION_GROUP_CAPABILITY_BLOCKED' },
      })
      expect(dbChainMockFns.set).not.toHaveBeenCalled()
    })
  })
})
