/**
 * @vitest-environment node
 */
import {
  authMockFns,
  createMockRequest,
  dbChainMock,
  dbChainMockFns,
  permissionGroupScopeMock,
  permissionGroupScopeMockFns,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetUserEntityPermissions, mockHasWorkspaceInboxAccess } = vi.hoisted(() => ({
  mockGetUserEntityPermissions: vi.fn(),
  mockHasWorkspaceInboxAccess: vi.fn(),
}))

const resolveGroupConfigMock = permissionGroupScopeMockFns.mockResolvePermissionGroupConfig

vi.mock('@sim/db', () => ({ ...dbChainMock, ...schemaMock }))

vi.mock('@/lib/billing/core/subscription', () => ({
  hasWorkspaceInboxAccess: mockHasWorkspaceInboxAccess,
}))

vi.mock('@/lib/mothership/inbox/lifecycle', () => ({
  disableInbox: vi.fn(),
  enableInbox: vi.fn(),
  updateInboxAddress: vi.fn(),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getUserEntityPermissions: mockGetUserEntityPermissions,
}))

vi.mock('@/lib/permission-groups/config-scope.server', () => permissionGroupScopeMock)

import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'
import { GET, PATCH } from '@/app/api/workspaces/[id]/inbox/route'

const context = { params: Promise.resolve({ id: 'workspace-1' }) }

describe('Inbox config secret policy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'admin-1' } })
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
    vi.clearAllMocks()
    resetDbChainMock()
    authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'admin-1' } })
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
      await expect(response.json()).resolves.toEqual({ error: REFUSAL })
    })

    it('refuses to update the inbox config, leaving the row untouched', async () => {
      queueInboxReadRows()

      const response = await PATCH(patchRequest(), context)

      expect(response.status).toBe(403)
      await expect(response.json()).resolves.toEqual({ error: REFUSAL })
      expect(dbChainMockFns.set).not.toHaveBeenCalled()
    })
  })

  describe('when a group governs the user but withholds nothing', () => {
    beforeEach(() => {
      resolveGroupConfigMock.mockResolvedValue(DEFAULT_PERMISSION_GROUP_CONFIG)
    })

    it('reads the inbox config', async () => {
      queueInboxReadRows()

      const response = await GET(getRequest(), context)

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toMatchObject({
        enabled: true,
        address: 'tasks@example.com',
      })
    })

    it('updates the inbox config', async () => {
      queueInboxReadRows()

      const response = await PATCH(patchRequest(), context)

      expect(response.status).toBe(200)
      expect(dbChainMockFns.set).toHaveBeenCalled()
    })
  })

  /** A personal workspace, or any non-enterprise organization, is governed by no group. */
  describe('when no permission group governs the user', () => {
    beforeEach(() => {
      resolveGroupConfigMock.mockResolvedValue(null)
    })

    it('reads the inbox config', async () => {
      queueInboxReadRows()

      const response = await GET(getRequest(), context)

      expect(response.status).toBe(200)
    })

    it('updates the inbox config', async () => {
      queueInboxReadRows()

      const response = await PATCH(patchRequest(), context)

      expect(response.status).toBe(200)
      expect(dbChainMockFns.set).toHaveBeenCalled()
    })
  })
})
