/**
 * @vitest-environment node
 */
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
    vi.clearAllMocks()
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

    expect(mocks.listForWorkspacePrincipal).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      types: ['oauth', 'service_account'],
      providerId: undefined,
      search: undefined,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    })
    expect(mocks.checkWorkspaceAccess).not.toHaveBeenCalled()
    expect(mocks.listVisible).not.toHaveBeenCalled()
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  it('preserves human per-credential visibility for personal keys', async () => {
    const principal = {
      kind: 'personal_api_key' as const,
      userId: 'user-1',
      keyId: 'key-1',
    }

    await listWorkspaceCredentials.execute({ principal, input: { ...input, type: 'oauth' } })

    expect(mocks.resolvePermission).toHaveBeenCalledWith('user-1', 'workspace-1', null, undefined, {
      forUpdate: undefined,
    })
    expect(mocks.listVisible).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', types: ['oauth'] })
    )
  })

  it('rejects personal keys disabled by canonical workspace policy', async () => {
    mocks.loadWorkspace.mockResolvedValue({ ...workspaceContext, allowPersonalApiKeys: false })

    await expect(
      listWorkspaceCredentials.execute({
        principal: {
          kind: 'personal_api_key',
          userId: 'user-1',
          keyId: 'key-1',
        },
        input,
      })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mocks.resolvePermission).not.toHaveBeenCalled()
    expect(mocks.listVisible).not.toHaveBeenCalled()
  })

  it('propagates repository failures without projecting secret details', async () => {
    const failure = new Error('encrypted column read failed')
    mocks.listForWorkspacePrincipal.mockRejectedValueOnce(failure)

    await expect(
      listWorkspaceCredentials.execute({
        principal: {
          kind: 'workspace_api_key',
          workspaceId: 'workspace-1',
          keyId: 'key-1',
        },
        input,
      })
    ).rejects.toBe(failure)
  })
})
