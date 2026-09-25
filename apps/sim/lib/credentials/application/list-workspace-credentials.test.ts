import type { SessionPrincipal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadWorkspace: vi.fn(),
  resolvePermission: vi.fn(),
  checkWorkspaceAccess: vi.fn(),
  listVisible: vi.fn(),
  listForWorkspacePrincipal: vi.fn(),
  recordAudit: vi.fn(),
}))

vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  loadActiveWorkspaceApplicationContext: mocks.loadWorkspace,
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (permission: string | null, required: string) =>
    permission === 'admin' || permission === 'write' || permission === required,
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  checkWorkspaceAccess: mocks.checkWorkspaceAccess,
}))

vi.mock('@/lib/credentials/queries', () => ({
  listVisibleWorkspaceCredentials: mocks.listVisible,
  listWorkspacePrincipalCredentials: mocks.listForWorkspacePrincipal,
}))

vi.mock('@sim/audit', () => ({ recordAudit: mocks.recordAudit }))

import { listWorkspaceCredentials } from '@/lib/credentials/application/list-workspace-credentials'

const workspaceContext = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}
const input = {
  workspaceId: 'workspace-1',
  sortBy: 'createdAt' as const,
  sortOrder: 'desc' as const,
}

describe('listWorkspaceCredentials', () => {
  beforeEach(() => {
    mocks.loadWorkspace.mockResolvedValue(workspaceContext)
    mocks.resolvePermission.mockResolvedValue('read')
    mocks.checkWorkspaceAccess.mockResolvedValue({ hasAccess: true, canAdmin: false })
    mocks.listVisible.mockResolvedValue({ data: [], nextCursorKeys: null })
    mocks.listForWorkspacePrincipal.mockResolvedValue({ data: [], nextCursorKeys: null })
  })

  it('preserves per-credential visibility for sessions', async () => {
    const principal: SessionPrincipal = {
      kind: 'session',
      userId: 'user-1',
      sessionId: 'session-1',
    }

    await listWorkspaceCredentials.execute({ principal, input })
    expect(mocks.listVisible).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', types: ['oauth', 'service_account'] })
    )
  })

  it('lists shared connections for a workspace key without creator identity', async () => {
    const principal = {
      kind: 'workspace_api_key' as const,
      workspaceId: 'workspace-1',
      keyId: 'key-1',
    }

    await listWorkspaceCredentials.execute({ principal, input })

    expect(mocks.listForWorkspacePrincipal).toHaveBeenCalledOnce()
    expect(mocks.checkWorkspaceAccess).not.toHaveBeenCalled()
    expect(mocks.listVisible).not.toHaveBeenCalled()
  })
})
