/**
 * @vitest-environment node
 */
import {
  authMockFns,
  createMockRequest,
  permissionGroupScopeMock,
  permissionGroupScopeMockFns,
  queueTableRows,
  resetDbChainMock,
  resetPermissionGroupScopeMock,
  schemaMock,
} from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/permission-groups/config-scope.server', () => permissionGroupScopeMock)

const { mockGetUserEntityPermissions } = vi.hoisted(() => ({
  mockGetUserEntityPermissions: vi.fn(),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getUserEntityPermissions: mockGetUserEntityPermissions,
}))

vi.mock('@sim/audit', () => ({
  AuditAction: { API_KEY_UPDATED: 'api_key.updated', API_KEY_REVOKED: 'api_key.revoked' },
  AuditResourceType: { API_KEY: 'api_key' },
  recordAudit: vi.fn(),
}))

vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: vi.fn() }))

import { capabilityRefusal } from '@/lib/permission-groups/capabilities'
import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'
import { DELETE, PUT } from '@/app/api/workspaces/[id]/api-keys/[keyId]/route'

const mockGetSession = authMockFns.mockGetSession

const context = { params: Promise.resolve({ id: 'workspace-1', keyId: 'key-1' }) }

function renameRequest() {
  return createMockRequest(
    'PUT',
    { name: 'Renamed key' },
    {},
    'http://localhost:3000/api/workspaces/workspace-1/api-keys/key-1'
  )
}

describe('workspace API key by id', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    resetPermissionGroupScopeMock()
    mockGetSession.mockResolvedValue({ user: { id: 'admin-1' } })
    mockGetUserEntityPermissions.mockResolvedValue('admin')
  })

  afterAll(() => {
    resetDbChainMock()
  })

  /**
   * A rename is "managing API keys" like the list and the mint are, and grants
   * no access of its own — but neither does the list, and leaving the rename
   * open also answers whether a key id exists to a caller the same group
   * refuses the listing.
   */
  it('refuses a rename when the group withholds API key management', async () => {
    permissionGroupScopeMockFns.mockResolvePermissionGroupConfig.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      hideApiKeysTab: true,
    })

    const response = await PUT(renameRequest(), context)

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: capabilityRefusal('api_keys.manage'),
    })
  })

  it('renames when no group withholds API key management', async () => {
    queueTableRows(schemaMock.apiKey, [{ id: 'key-1', name: 'Old name' }])
    queueTableRows(schemaMock.apiKey, [])
    queueTableRows(schemaMock.apiKey, [
      {
        id: 'key-1',
        name: 'Renamed key',
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
        updatedAt: new Date('2026-07-02T00:00:00.000Z'),
      },
    ])

    const response = await PUT(renameRequest(), context)

    expect(response.status).toBe(200)
  })

  /**
   * Revocation stays ungated on purpose: withholding key management must never
   * withhold the one act that removes a leaked credential.
   */
  it('revokes even when the group withholds API key management', async () => {
    permissionGroupScopeMockFns.mockResolvePermissionGroupConfig.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      hideApiKeysTab: true,
    })
    const response = await DELETE(createMockRequest('DELETE'), context)

    expect(response.status).not.toBe(403)
    await expect(response.json()).resolves.not.toEqual({
      error: capabilityRefusal('api_keys.manage'),
    })
  })
})
