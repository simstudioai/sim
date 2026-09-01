/**
 * @vitest-environment node
 */
import {
  authMockFns,
  createMockRequest,
  dbChainMock,
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetUserEntityPermissions, mockHasWorkspaceInboxAccess } = vi.hoisted(() => ({
  mockGetUserEntityPermissions: vi.fn(),
  mockHasWorkspaceInboxAccess: vi.fn(),
}))

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

import { PATCH } from '@/app/api/workspaces/[id]/inbox/route'

const context = { params: Promise.resolve({ id: 'workspace-1' }) }

describe('Inbox config secret policy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'admin-1' } })
    mockGetUserEntityPermissions.mockResolvedValue('admin')
    mockHasWorkspaceInboxAccess.mockResolvedValue(true)
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
