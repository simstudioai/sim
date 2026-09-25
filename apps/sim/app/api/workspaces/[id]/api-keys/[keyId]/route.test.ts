import {
  authMockFns,
  createMockRequest,
  permissionGroupScopeMock,
  permissionGroupScopeMockFns,
  resetDbChainMock,
  resetPermissionGroupScopeMock,
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

vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  loadActiveWorkspaceApplicationContext: async (workspaceId: string) => ({
    workspaceId,
    workspaceOrganizationId: 'org',
    allowPersonalApiKeys: true,
    billedAccountUserId: 'billing',
  }),
}))
vi.mock('@sim/platform-authz/workspace', () => ({
  resolveEffectiveWorkspacePermission: (...args: unknown[]) =>
    mockGetUserEntityPermissions(...args),
  permissionSatisfies: (actual: string, required: string) =>
    actual === 'admin' || actual === required || (actual === 'write' && required === 'read'),
}))

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
    resetDbChainMock()
    resetPermissionGroupScopeMock()
    mockGetSession.mockResolvedValue({ user: { id: 'admin-1' }, session: { id: 'session' } })
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
